// Only the maintenance trigger's generic status notices share a tray entry.
export function maintenanceStatusAlert(
  type: string | undefined,
  reportId: string | null | undefined,
  title: string | undefined,
  message: string | undefined,
) {
  if (type !== 'status_update' || !reportId || title !== 'Maintenance Status Updated') return;

  const phase = message?.match(/\. Status: ([^.\r\n]+)\.$/)?.[1]?.trim();
  if (!phase) return;

  return {
    identifier: `maintenance-status:${reportId}:${phase.toLowerCase()}`,
    title: `${phase} · ${reportId}`,
  };
}
