type Item = {
  id: string;
  title: string;
  status: string;
  linkedRepairId?: string | null;
  repaired?: boolean;
  isRepaired?: boolean;
  verified?: boolean;
  verifiedAt?: string | null;
};

type Report = {
  id: string;
  status: string;
  items: Item[];
  parentReportId?: string | null;
  linkedRepairId?: string | null;
  isVerified?: boolean;
  isRepaired?: boolean;
  allChildRepairsDone?: boolean;
  issue?: { component?: string; parentTaskId?: string; taskId?: string } | null;
};

const key = (value?: string | null) => value?.trim().toLowerCase();

// Completed is the desktop's approved terminal state; For Verification is not.
export function isRepairDone(report?: Pick<Report, 'status'>): boolean {
  return ['completed', 'verified'].includes(key(report?.status) || '');
}

export function isRepairAwaitingVerification(report?: Pick<Report, 'status'>): boolean {
  return key(report?.status) === 'for verification';
}

export function isChecklistItemComplete(item: Item): boolean {
  return item.status === 'Completed' && (!item.linkedRepairId || item.repaired === true);
}

/** Reconcile before worker filtering, including repairs assigned to another worker. */
export function synchronizeMaintenanceRepairs<T extends Report>(reports: T[]): T[] {
  const byId = new Map(reports.map(report => [key(report.id), report]));
  for (const report of reports) {
    const children = reports.filter(child => child !== report && (
      key(child.parentReportId) === key(report.id) ||
      key(report.linkedRepairId) === key(child.id) ||
      report.items.some(item => key(item.linkedRepairId) === key(child.id))
    ));
    for (const item of report.items) {
      const child = item.linkedRepairId ? byId.get(key(item.linkedRepairId)) : children.find(candidate => {
        const taskId = candidate.issue?.parentTaskId || candidate.issue?.taskId;
        return taskId ? String(taskId) === item.id : Boolean(candidate.issue?.component && key(candidate.issue.component) === key(item.title));
      });
      if (!item.linkedRepairId && child) item.linkedRepairId = child.id;
      if (!item.linkedRepairId) continue;
      const done = isRepairDone(child);
      item.status = done ? 'Completed' : isRepairAwaitingVerification(child) ? 'For Verification' : 'Under Repair';
      item.repaired = done;
      item.isRepaired = done;
      item.verified = done;
      if (!done) item.verifiedAt = null;
    }
    const linkedIds = [report.linkedRepairId, ...report.items.map(item => item.linkedRepairId)].filter(Boolean);
    const hasRepairs = children.length > 0 || linkedIds.length > 0;
    const allDone = hasRepairs && children.every(isRepairDone) && linkedIds.every(id => isRepairDone(byId.get(key(id))));
    const submittedOrDone = (child?: Report) => isRepairDone(child) || isRepairAwaitingVerification(child);
    const allSubmitted = hasRepairs && children.every(submittedOrDone) && linkedIds.every(id => submittedOrDone(byId.get(key(id))));
    report.allChildRepairsDone = allDone;
    if ((hasRepairs && !allSubmitted) || report.items.some(item => item.status === 'Under Repair')) {
      report.status = 'Under Repair';
      report.isVerified = false;
      report.isRepaired = false;
    } else if (report.items.some(item => item.status === 'Needs Repair')) {
      report.status = 'Needs Repair';
      report.isVerified = false;
      report.isRepaired = false;
    } else if (hasRepairs && allSubmitted && !allDone) {
      report.status = report.status === 'For Verification' && report.items.every(item => isChecklistItemComplete(item) || item.status === 'For Verification')
        ? 'For Verification' : 'In Progress';
      report.isVerified = false;
      report.isRepaired = false;
    } else if (hasRepairs && allDone) {
      const checklistDone = report.items.length > 0 && report.items.every(isChecklistItemComplete);
      report.isRepaired = checklistDone;
      if (checklistDone && !isRepairDone(report) && report.status !== 'For Verification') report.status = 'In Progress';
    }
  }
  return reports;
}
