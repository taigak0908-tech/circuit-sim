/* 切り出し前の基準タイムを記録する（5車種 × 3コーナー = 15個）。
   使い方: node test/regress-record.js  → test/fixtures/regress.json を上書き */
const fs = require('fs');
const path = require('path');
const { loadEngine } = require('./load-engine');
const { timeOf, CARS, CORNERS } = require('./regress-common');

/* node --test の自動探索で実行されても基準値を上書きしない */
if (process.env.NODE_TEST_CONTEXT) process.exit(0);

const E = loadEngine();
const out = {};
for (const c of CARS) for (const k of CORNERS) out[c + '-' + k] = timeOf(E, c + '-' + k);
const file = path.join(__dirname, 'fixtures', 'regress.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(out).length + ' 個を ' + path.relative(process.cwd(), file) + ' に保存');
