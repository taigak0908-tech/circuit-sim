const { test, assert } = require('./harness');
const { deriveCar } = require('../js/physics');
const { buildTrackFromPath } = require('../js/track');
const { solveLineN, finishLineN, centerLine, lineOIO, runLineN } = require('../js/lines');
const { course, toLatLngs, SHAPE } = require('./fixtures/courses');

/* index.html の CAR_PRESETS.grb.v（スバル インプレッサ WRX STI）からコピー */
const GRB = { mass: 1550, ps: 308, mu: 1.10, wf: 59, h: 0.50, rs: 56, L: 2.625, tf: 1.530, tr: 1.540, cda: 0.78, cla: 0.10, rollGrad: 3.2, pitchGrad: 1.6, drive: 'AWD' };
const V_ENTRY = 60 / 3.6;
const EPS = 1e-6;

const sTrack = (opt) => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), opt);
  assert.ok(!tr.error, 'error: ' + tr.error);
  return tr;
};
const allFree = (N) => new Float64Array(N).fill(NaN);
const inRange = (tr, n, msg) => {
  for (let i = 0; i < tr.N; i++) assert.ok(n[i] >= tr.bLo - EPS && n[i] <= tr.bHi + EPS && Number.isFinite(n[i]), msg + ' i=' + i + ' n=' + n[i]);
};

test('ピン無しの解は全点が [bLo-1e-6, bHi+1e-6] に収まる（S字・W=6・full）', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const t0 = Date.now();
  const line = solveLineN(tr, allFree(tr.N));
  assert.ok(Date.now() - t0 < 1000, '1秒以内に終わる');
  assert.equal(line.n.length, tr.N);
  inRange(tr, line.n, 'full');
  /* 範囲を実際に使っている（曲率最小なので壁に当たる点がある） */
  assert.ok(Math.max(...line.n) > tr.bHi - 0.05 || Math.min(...line.n) < tr.bLo + 0.05);
});

test('ピンを置いた点はピン値±0.01', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const pins = allFree(tr.N);
  const at = { 20: 1.0, 60: -1.5, 100: 0.5, 140: -0.8 };
  for (const i in at) pins[i] = at[i];
  const line = solveLineN(tr, pins);
  inRange(tr, line.n, 'pins');
  for (const i in at) assert.ok(Math.abs(line.n[i] - at[i]) < 0.01, 'i=' + i + ' n=' + line.n[i]);
  /* 範囲外のピンは範囲に丸められる */
  const p2 = allFree(tr.N); p2[60] = 99;
  const l2 = solveLineN(tr, p2);
  assert.ok(Math.abs(l2.n[60] - tr.bHi) < 0.01, 'clamp n=' + l2.n[60]);
});

test('自車線 W=3（範囲 [-0.5,0]）でも収束し範囲内', () => {
  const tr = sTrack({ W: 3, mode: 'lane' });
  assert.equal(tr.bLo, -0.5);
  assert.equal(tr.bHi, 0);
  const line = solveLineN(tr, allFree(tr.N));
  inRange(tr, line.n, 'lane');
  assert.ok(Number.isFinite(line.length) && line.length > tr.total * 0.95);
});

test('OIO の区間タイムは中央より短い（GRB・vEntry 60km/h）', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const car = deriveCar(GRB);
  const mid = runLineN(tr, car, V_ENTRY, centerLine(tr));
  const oio = runLineN(tr, car, V_ENTRY, lineOIO(tr));
  assert.ok(mid.sim.time > 0 && oio.sim.time > 0);
  assert.ok(oio.sim.time < mid.sim.time, 'OIO ' + oio.sim.time + ' / 中央 ' + mid.sim.time);
});

test('centerLine は n=0 で中心線そのもの、finishLineN は距離と曲率を返す', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const c = centerLine(tr);
  for (let i = 0; i < tr.N; i++) assert.ok(c.n[i] === 0 && c.px[i] === tr.cx[i] && c.py[i] === tr.cy[i]);
  assert.ok(Math.abs(c.length - tr.total) < 1, 'length ' + c.length);
  assert.equal(c.kap.length, tr.N);
  assert.ok(c.iApex === undefined);
  /* S字の中央線: 左コーナーの曲率は正、右は負 */
  const [L, R] = tr.corners;
  assert.ok(c.kap[Math.round((L.i0 + L.i1) / 2)] > 0.02 && c.kap[Math.round((R.i0 + R.i1) / 2)] < -0.02);
  assert.ok(finishLineN(tr, new Float64Array(tr.N)).length === c.length);
});
