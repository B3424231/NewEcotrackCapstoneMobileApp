const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleObject = { exports: {} };
const js = ts.transpileModule(fs.readFileSync('src/services/maintenance-rpc.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(js, { module: moduleObject, exports: moduleObject.exports, Date, Math });
const service = moduleObject.exports;
const version = '2026-09-30T09:30:00.123456+00:00';
const context = { expectedUpdated: version, operationId: 'repair-operation-1' };
const task = { id: 'task-1', title: 'Filter', description: '', status: 'Completed' };
function client(result = { data: { success: true, updated: version, status: 'For Verification' }, error: null }) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return result; } };
}

test('an absent original version fails before issuing any write or read', async () => {
  const db = client();
  assert.equal((await service.updateMaintenanceReportRpc(db, 'MR-1', { items: [task], operationId: 'operation' })).success, false);
  assert.equal(db.calls.length, 0);
});

test('null legacy versions are explicit and timestamp precision is preserved', async () => {
  const db = client();
  await service.updateMaintenanceReportRpc(db, 'MR-1', { ...context, items: [task] });
  await service.updateMaintenanceReportRpc(db, 'MR-2', { ...context, expectedUpdated: null, items: [task] });
  assert.equal(db.calls[0].args.p_expected_updated, version);
  assert.equal(db.calls[1].args.p_expected_updated, null);
});

test('approval, ownership and audit fields never become client RPC authority', async () => {
  const db = client();
  await service.updateMaintenanceReportRpc(db, 'MR-1', {
    ...context, workerName: 'Administrator', verificationRemarks: 'approved', existingTimeline: [{ title: 'Forged' }],
    items: [{ ...task, repaired: true, verified: true, linkedRepairId: 'OTHER-REPAIR', photoUris: ['https://example.invalid/proof.jpg'] }],
  });
  const args = db.calls[0].args;
  assert.equal(db.calls[0].name, 'ecotrack_update_maintenance_report');
  assert.equal(args.p_tasks[0].verified, undefined);
  assert.equal(args.p_tasks[0].repaired, undefined);
  assert.equal(args.p_tasks[0].linkedRepairId, undefined);
  assert.equal(args.workerName, undefined);
  assert.equal(args.existingTimeline, undefined);
  assert.equal(args.p_tasks[0].photoUris[0], 'https://example.invalid/proof.jpg');
});

test('repair submission is one RPC with the original snapshot and retry identity', async () => {
  const db = client({ data: { success: true, updated: version, updatedParentId: 'MR-1', parentStatus: 'For Verification' }, error: null });
  const result = await service.submitRepairRpc(db, 'REP-1', context);
  assert.equal(result.updatedParentId, 'MR-1');
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].name, 'ecotrack_submit_repair');
  assert.equal(db.calls[0].args.p_expected_updated, version);
  assert.equal(db.calls[0].args.p_operation_id, context.operationId);
});

test('item saves use the quiet endpoint without forwarding an automatically derived submission status',async()=>{
  const db=client({data:{success:true,updated:version,status:'In Progress'},error:null});
  const result=await service.updateMaintenanceReportRpc(db,'MR-1',{...context,saveMode:'item',status:'For Verification',items:[task]});
  assert.equal(result.status,'In Progress');assert.equal(db.calls[0].name,'ecotrack_save_maintenance_item');
  assert.equal(db.calls[0].args.p_status,undefined);assert.equal(db.calls[0].args.p_tasks[0].status,'Completed');
});

test('ambiguous transport failures preserve retry parameters for the next attempt', async () => {
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (calls.length === 1) throw Error('connection interrupted after commit');
    return { data: { success: true, updated: version }, error: null };
  } };
  assert.equal((await service.submitRepairRpc(db, 'REP-1', context)).success, false);
  assert.equal((await service.submitRepairRpc(db, 'REP-1', context)).success, true);
  assert.deepEqual(calls[0], calls[1]);
});

test('screen retry identities survive interleaved edits and ignore local display timestamps', () => {
  const track = service.createMaintenanceMutationTracker();
  const first = track('MR-1', version, { items: [{ ...task, updatedAt: 'local-first' }] });
  const otherEdit = track('MR-1', version, { items: [{ ...task, remarks: 'different work' }] });
  const retry = track('MR-1', version, { items: [{ ...task, updatedAt: 'local-retry' }] });
  const newerVersion = track('MR-1', '2026-10-01T00:00:00Z', { items: [task] });
  assert.equal(first.operationId, retry.operationId);
  assert.notEqual(first.operationId, otherEdit.operationId);
  assert.notEqual(first.operationId, newerVersion.operationId);
  assert.equal(retry.expectedUpdated, version);
});

test('version conflicts request a refresh and never fall back to table updates', async () => {
  const db = client({ data: null, error: { code: '40001', message: 'stale' } });
  const result = await service.updateMaintenanceReportRpc(db, 'MR-1', { ...context, items: [task] });
  assert.equal(result.success, false);
  assert.match(result.error, /Refresh/);
  assert.equal(db.calls.length, 1);
});

test('an undeployed secure endpoint fails closed', async () => {
  const db = client({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
  const result = await service.submitRepairRpc(db, 'REP-1', context);
  assert.equal(result.success, false);
  assert.match(result.error, /not deployed/);
  assert.equal(db.calls.length, 1);
});

test('empty or unconfirmed RPC responses are never reported as saved', async () => {
  for (const data of [null, {}, { success: true }, { success: false, updated: version }]) {
    const result = await service.submitRepairRpc(client({ data, error: null }), 'REP-1', context);
    assert.equal(result.success, false);
  }
});
