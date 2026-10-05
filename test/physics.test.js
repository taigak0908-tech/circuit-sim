const { test, assert } = require('./harness');
const { loadEngine } = require('./load-engine');
const { timeOf } = require('./regress-common');
const rec = require('./fixtures/regress.json');

test('切り出し後も15個の区間タイムが変わらない', () => {
  const E = loadEngine();
  assert.equal(Object.keys(rec).length, 15);
  for (const k in rec) assert.ok(Math.abs(timeOf(E, k) - rec[k]) < 0.001, k);
});
