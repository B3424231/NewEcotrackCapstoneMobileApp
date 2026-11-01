import type { LiveMaintenanceItem } from './supabase';

export type MaintenanceMutationContext = {
  /** Exact database timestamp from the screen snapshot, never a display date. */
  expectedUpdated: string | null;
  /** Reuse for retries of the same operation; create a new value after an edit. */
  operationId: string;
};

export type MaintenanceMutationResult = {
  success: boolean;
  error?: string;
  updated?: string;
  status?: string;
  updatedParentId?: string;
  parentStatus?: string;
  parentUpdated?: string;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: any;
    error: { message: string; code?: string } | null;
  }>;
};

export type MaintenanceUpdateParams = Partial<MaintenanceMutationContext> & {
  /** Item progress is quiet; final saves intentionally publish an update. */
  saveMode?: 'item' | 'submit';
  status?: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' | 'For Verification';
  items?: LiveMaintenanceItem[];
  workerName?: string;
  location?: string;
  airconId?: string;
  airconType?: string;
  verificationRemarks?: string;
  existingTimeline?: any[];
  customTimelineTitle?: string;
};

// This is a retry identifier, never an authentication token or an authorization check.
export function createMaintenanceOperationId(): string {
  return `maintenance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Keep one tracker for the screen lifetime so failed/interleaved saves can retry. */
export function createMaintenanceMutationTracker() {
  const attempts = new Map<string, string>();
  return (reportId: string, expectedUpdated: string | null | undefined, changes: unknown) => {
    const signature = JSON.stringify([reportId, expectedUpdated, changes], (key, value) =>
      ['updatedAt', 'updated', 'verifiedAt'].includes(key) ? undefined : value);
    let operationId = attempts.get(signature);
    if (!operationId) {
      operationId = createMaintenanceOperationId();
      attempts.set(signature, operationId);
    }
    return { expectedUpdated, operationId };
  };
}

function contextError(context: Partial<MaintenanceMutationContext>): string | null {
  if (context.expectedUpdated === undefined || (context.expectedUpdated !== null &&
    (typeof context.expectedUpdated !== 'string' || !Number.isFinite(Date.parse(context.expectedUpdated))))) {
    return 'Refresh this report before saving. Its original database version is missing.';
  }
  if (!context.operationId || context.operationId.length > 128) return 'A maintenance operation ID is required.';
  return null;
}

async function mutate(client: RpcClient, rpc: string, args: Record<string, unknown>): Promise<MaintenanceMutationResult> {
  try {
    const { data, error } = await client.rpc(rpc, args);
    if (error) {
      if (error.code === '40001') return { success: false, error: 'This report changed. Refresh and review the latest checklist before saving.' };
      if (error.code === 'PGRST202' || error.code === '42883') return { success: false, error: 'Secure maintenance saving is not deployed yet. Contact your administrator.' };
      return { success: false, error: error.message };
    }
    if (!data || data.success !== true || typeof data.updated !== 'string') {
      return { success: false, error: 'The server did not confirm the maintenance update. Retry the same operation.' };
    }
    return data as MaintenanceMutationResult;
  } catch (error: any) {
    return { success: false, error: error?.message || 'The maintenance update could not be confirmed. Retry the same operation.' };
  }
}

export async function updateMaintenanceReportRpc(
  client: RpcClient,
  reportId: string,
  params: MaintenanceUpdateParams,
): Promise<MaintenanceMutationResult> {
  const error = contextError(params);
  if (error) return { success: false, error };
  if (!reportId.trim()) return { success: false, error: 'A report ID is required.' };
  // Ownership, approval flags, relationships and audit attribution are server owned.
  // Do not forward names, client timelines or verification fields as authority.
  const tasks = params.items?.map(item => ({
    id: String(item.id),
    status: item.status,
    notes: item.remarks || '',
    problemDescription: item.problemDescription || '',
    photoUri: item.photoUri || item.photoUris?.[0] || null,
    photoUris: item.photoUris || (item.photoUri ? [item.photoUri] : []),
  })) ?? null;
  if (params.saveMode === 'item') return mutate(client, 'ecotrack_save_maintenance_item', {
    p_report_id: reportId,
    p_expected_updated: params.expectedUpdated,
    p_operation_id: params.operationId,
    p_tasks: tasks,
  });
  return mutate(client, 'ecotrack_update_maintenance_report', {
    p_report_id: reportId,
    p_expected_updated: params.expectedUpdated,
    p_operation_id: params.operationId,
    p_status: params.status ?? null,
    p_tasks: tasks,
  });
}

export async function submitRepairRpc(
  client: RpcClient,
  repairId: string,
  context: Partial<MaintenanceMutationContext>,
): Promise<MaintenanceMutationResult> {
  const error = contextError(context);
  if (error) return { success: false, error };
  if (!repairId.trim()) return { success: false, error: 'A repair ID is required.' };
  return mutate(client, 'ecotrack_submit_repair', {
    p_repair_id: repairId,
    p_expected_updated: context.expectedUpdated,
    p_operation_id: context.operationId,
  });
}
