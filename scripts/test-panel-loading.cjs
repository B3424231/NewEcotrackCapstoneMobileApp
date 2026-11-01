const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function helper() {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/services/query-utils.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout, AbortController });
  return module.exports;
}
test('count-aware pagination skips terminal empty reads but handles server-shortened pages', async () => {
  const { fetchAccessibleRows } = helper(); let reads = 0;
  const rows = [{id:'1'}, {id:'2'}, {id:'3'}];
  const client = { from() { let after = ''; const q = { select() { return q; }, order() { return q; }, limit() { return q; }, gt(_key, value) { after = value; return q; }, then(resolve, reject) { reads++; const remaining = rows.filter(row => row.id > after); return Promise.resolve({ data: remaining.slice(0, 1), count: remaining.length, error: null }).then(resolve, reject); } }; return q; } };
  const result = await fetchAccessibleRows(client, 'nodes');
  assert.equal(result.data.length, 3); assert.equal(reads, 3);
});
test('scoped hung reads settle as failures, release retry, and ignore late results', async () => {
  const { createReadScope } = helper(); const client = {}; let release;
  const scope = createReadScope(10);
  await assert.rejects(scope.run(client, 'rooms', () => new Promise(resolve => { release = resolve; })), /timed out/i);
  assert.throws(() => scope.assertSuccessful());
  release({data:['late']});
  const fresh = createReadScope(10);
  assert.deepEqual(await fresh.run(client, 'rooms', async () => ({data:['fresh']})), {data:['fresh']});
});
