/* テスト用の薄いハーネス。Node では node:test / node:assert に委譲し、
   ブラウザ（test.html）では結果を <ul id="results"> に書く。
   ブラウザでは async のテストも待ち、1 本ずつ順番に走らせる（fetch の差し替えなど、テスト同士が干渉しないように）。 */
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
  const count = { pass: 0, fail: 0 };
  let chain = Promise.resolve();
  const test = (name, fn) => {
    chain = chain.then(async () => {
      const li = document.createElement('li');
      try { await fn(); li.textContent = '✅ ' + name; count.pass++; }
      catch (e) { li.textContent = '❌ ' + name + ' — ' + e.message; li.className = 'ng'; count.fail++; }
      list().appendChild(li);
    });
  };
  /* 登録済みのテストがすべて終わるのを待つ。{pass, fail} を返す */
  const done = () => chain.then(() => count);
  window.TestHarness = { test, assert, done };
}
