const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/services/maintenance-status.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { synchronizeMaintenanceRepairs: sync, isChecklistItemComplete: complete } = exportsObject;
assert.equal(exportsObject.getMaintenancePhase({status:'In Progress',items:[{id:'1',title:'Check',status:'Completed'}]}),'Ready to submit');
assert.equal(exportsObject.getMaintenancePhase({status:'For Verification',items:[]}),'For Verification');
assert.notEqual(exportsObject.getMaintenancePhase({status:'In Progress',items:[]}),'Ready to submit');
const task = (id, repair) => ({ id: String(id), title: `Step ${id}`, status: 'Completed', repaired: true, isRepaired: true, linkedRepairId: repair });
const parent = () => ({ id: 'MR-2026-001', status: 'Completed', isVerified: true, items: [task(1, 'REP-4324'), task(2, 'REP-8996'), task(3, 'REP-3464'), task(4), task(5), task(6)] });
const repair = (id, status) => ({ id, status, parentReportId: 'MR-2026-001', items: [] });

let report = parent();
const children = [repair('REP-4324', 'Verified'), repair('REP-8996', 'In Progress'), repair('REP-3464', 'In Progress')];
sync([report, ...children]);
assert.equal(report.items.filter(complete).length, 4);
assert.equal(report.status, 'Under Repair');
assert.equal(report.allChildRepairsDone, false);
assert.equal(report.isVerified, false);
assert.equal(report.items[0].status, 'Completed');
assert.equal(report.items[0].repaired, true);
for (const item of report.items.slice(1, 3)) {
  assert.equal(item.status, 'Under Repair');
  assert.equal(item.repaired, false);
  assert.equal(complete(item), false);
}

children[1].status = 'For Verification';
sync([report, ...children]);
assert.equal(report.items.filter(complete).length, 4);
assert.equal(report.items[1].status, 'For Verification');
assert.equal(report.items[1].verified, false);
assert.equal(report.items[2].status, 'Under Repair');
assert.equal(report.status, 'Under Repair');
children[2].status = 'For Verification';
sync([report, ...children]);
assert.equal(report.status, 'In Progress');
assert.equal(report.allChildRepairsDone, false);
assert.equal(report.isVerified, false);
assert.equal(report.items.filter(complete).length, 4);
children[1].status = 'In Progress';
sync([report, ...children]);
assert.equal(report.items[1].status, 'Under Repair');
assert.equal(report.status, 'Under Repair');
children[1].status = children[2].status = 'Completed';
sync([report, ...children]);
assert.equal(report.items.filter(complete).length, 6);
assert.equal(report.allChildRepairsDone, true);
assert.equal(report.status, 'In Progress');

report = parent();
sync([report]); // Missing child rows cannot confirm completion.
assert.equal(report.items.filter(complete).length, 3);
assert.equal(report.status, 'Under Repair');

report = { id: 'MR-2026-001', status: 'Completed', items: [task(1)] };
const unlinked = repair('REP-4324', 'In Progress');
sync([report, unlinked]); // Parent-only relationship still blocks completion.
assert.equal(report.status, 'Under Repair');
unlinked.issue = { parentTaskId: '1' };
sync([report, unlinked]);
assert.equal(report.items[0].linkedRepairId, 'REP-4324');
assert.equal(report.items[0].status, 'Under Repair');
unlinked.status = 'Completed';
report.items[0].linkedRepairId = ' rep-4324 ';
sync([report, unlinked]);
assert.equal(complete(report.items[0]), true);
for (const status of ['Under Repair', 'Needs Repair', 'In Progress', 'For Verification']) {
  assert.equal(complete({ ...task(1), status }), false);
}
report = { id: 'MR-2026-001', status: 'Under Repair', items: [task(1, 'REP-4324'), { ...task(2), status: 'Not Started' }] };
sync([report, repair('REP-4324', 'For Verification')]);
assert.equal(report.items[0].status, 'For Verification');
assert.equal(report.status, 'In Progress');
console.log('Maintenance status regression scenarios passed.');
