/* テスト用の薄いハーネス。Node では node:test / node:assert に委譲し、
   ブラウザでは結果を <ul id="results"> に書く。 */
if (typeof window === 'undefined') {
  const nodeTest = require('node:test');
  module.exports = { test: nodeTest.test, assert: require('node:assert/strict') };
} else {
  const list = () => document.getElementById('results');
  const fail = msg => { throw new Error(msg); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = {
    ok: (v, msg) => { if (!v) fail(msg || 'ok でない: ' + v); },
    equal: (a, b, msg) => { if (a !== b) fail(msg || a + ' !== ' + b); },
    deepEqual: (a, b, msg) => { if (!same(a, b)) fail(msg || JSON.stringify(a) + ' != ' + JSON.stringify(b)); }
  };
  const test = (name, fn) => {
    const li = document.createElement('li');
    try { fn(); li.textContent = '✅ ' + name; }
    catch (e) { li.textContent = '❌ ' + name + ' — ' + e.message; }
    list().appendChild(li);
  };
  window.TestHarness = { test, assert };
}
