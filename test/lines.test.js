const { test, assert } = require('./harness');
const { deriveCar } = require('../js/physics');
const { buildTrackFromPath } = require('../js/track');
const { solveLineN, finishLineN, centerLine, lineOIO, runLineN, pinsFromParams, defaultParams, lineLate, lineInside, lineCustom, cornerStats, searchFastest, searchFastestSync } = require('../js/lines');
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

/* ---- Task 5: 型ライン・自分のライン・コーナー別集計 ---- */
const innerOf = (tr, c) => (c.dir === 'L' ? tr.bLo : tr.bHi);

test('インベタは各コーナーの i0..i1 で |n - 内側境界| < 0.05', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  assert.ok(tr.corners.length >= 2);
  const line = lineInside(tr);
  inRange(tr, line.n, 'inside');
  for (const c of tr.corners) {
    const inner = innerOf(tr, c);
    for (let i = c.i0; i <= c.i1; i++) assert.ok(Math.abs(line.n[i] - inner) < 0.05, 'corner ' + c.no + ' i=' + i + ' n=' + line.n[i] + ' inner=' + inner);
  }
});

test('コーナーが先頭(i0=0)・末尾(i1=N-1)にあってもピン生成で例外が出ない', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const N = tr.N;
  const variants = [
    [{ no: 1, dir: 'L', i0: 0, i1: 20, s0: 0, s1: 20 * tr.ds, rMin: 30, angDeg: 90 }],
    [{ no: 1, dir: 'R', i0: N - 21, i1: N - 1, s0: 0, s1: 0, rMin: 30, angDeg: 90 }],
    [{ no: 1, dir: 'L', i0: 0, i1: N - 1, s0: 0, s1: 0, rMin: 30, angDeg: 90 }],
    [],
  ];
  for (const corners of variants) {
    const t2 = Object.assign({}, tr, { corners });
    const pins = pinsFromParams(t2, defaultParams(t2, 'late'));
    assert.equal(pins.length, N);
    const line = lineLate(t2);
    inRange(t2, line.n, 'edge');
  }
  /* コーナー0個は全部 NaN */
  const none = pinsFromParams(Object.assign({}, tr, { corners: [] }), []);
  assert.ok(none.every(Number.isNaN));
  /* params が不足していればそのコーナーはピン無し */
  const short = pinsFromParams(tr, []);
  assert.ok(short.every(Number.isNaN));
});

test('cornerStats の tCorner の合計 ≤ sim.time（各コーナーの vMin は正）', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const car = deriveCar(GRB);
  const r = runLineN(tr, car, V_ENTRY, lineLate(tr));
  const st = cornerStats(tr, r.sim);
  assert.equal(st.length, tr.corners.length);
  let sum = 0;
  st.forEach((x, c) => {
    const k = tr.corners[c];
    assert.ok(x.vMin > 0 && x.tCorner > 0, 'corner ' + c);
    assert.equal(x.vMin, Math.min(...Array.from(r.sim.v.slice(k.i0, k.i1 + 1))));
    sum += x.tCorner;
  });
  assert.ok(sum <= r.sim.time + 1e-9, 'sum ' + sum + ' / time ' + r.sim.time);
});

test('late の apex ピンは i0+0.65*(i1-i0) に内側いっぱい、入口 i0..i0+10m は外側', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const pins = pinsFromParams(tr, defaultParams(tr, 'late'));
  assert.equal(pins.length, tr.N);
  for (const c of tr.corners) {
    const ia = Math.round(c.i0 + 0.65 * (c.i1 - c.i0));
    const inner = innerOf(tr, c), outer = c.dir === 'L' ? tr.bHi : tr.bLo;
    assert.ok(Math.abs(pins[ia] - inner) < 1e-9, 'apex corner ' + c.no + ' pin=' + pins[ia]);
    const iEnd = Math.min(c.i0 + Math.round(10 / tr.ds), ia - 2);
    for (let i = c.i0; i <= iEnd; i++) assert.ok(Math.abs(pins[i] - outer) < 1e-9, 'hold corner ' + c.no + ' i=' + i);
  }
  /* 自車線（bHi=0）では右コーナーの内側は 0（中心） */
  const lane = sTrack({ W: 3, mode: 'lane' });
  const pl = pinsFromParams(lane, [{ apex: 0.5, inside: 1, hold: 0 }, { apex: 0.5, inside: 1, hold: 0 }]);
  const R = lane.corners[1];
  assert.ok(Math.abs(pl[Math.round((R.i0 + R.i1) / 2)] - 0) < 1e-9);
  /* lineCustom は pinsFromParams を通して解く */
  const lc = lineCustom(tr, defaultParams(tr, 'late'));
  assert.equal(lc.n.length, tr.N);
  inRange(tr, lc.n, 'custom');
});

test('最速のタイムは 中央/OIO/late/inside のどれより短いか等しい（S字・GRB）', () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const car = deriveCar(GRB);
  const best = searchFastestSync(tr, car, V_ENTRY);
  assert.equal(best.params.length, tr.corners.length);
  const others = { center: centerLine(tr), oio: lineOIO(tr), late: lineLate(tr), inside: lineInside(tr) };
  for (const k in others) {
    const t = runLineN(tr, car, V_ENTRY, others[k]).sim.time;
    assert.ok(best.time <= t + 1e-9, k + ': best ' + best.time + ' / ' + t);
  }
  /* time は params から再計算したタイムと一致する */
  assert.ok(Math.abs(runLineN(tr, car, V_ENTRY, lineCustom(tr, best.params)).sim.time - best.time) < 1e-9);
  /* コーナー0個は即返る */
  const none = searchFastestSync(Object.assign({}, tr, { corners: [] }), car, V_ENTRY);
  assert.deepEqual(none.params, []);
  assert.ok(none.time > 0);
});

test('AbortController で中断すると {aborted:true}', async () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const car = deriveCar(GRB);
  /* 開始前に中断済み */
  const ac0 = new AbortController(); ac0.abort();
  assert.deepEqual(await searchFastest(tr, car, V_ENTRY, { signal: ac0.signal }), { aborted: true });
  /* 1コーナー目を終えた時点で中断 → それ以上は進まない */
  const ac = new AbortController();
  let calls = 0;
  const r = await searchFastest(tr, car, V_ENTRY, { signal: ac.signal, onProgress: (done) => { calls++; if (done === 1) ac.abort(); } });
  assert.deepEqual(r, { aborted: true });
  assert.ok(calls <= 2, 'onProgress calls ' + calls);
});

test('onProgress が最後に (total,total) で呼ばれ、結果は同期版と一致する', async () => {
  const tr = sTrack({ W: 6, mode: 'full' });
  const car = deriveCar(GRB);
  const C = tr.corners.length;
  const log = [];
  const r = await searchFastest(tr, car, V_ENTRY, { onProgress: (done, total) => log.push([done, total]) });
  assert.deepEqual(log[log.length - 1], [2 * C, 2 * C]);
  assert.equal(log.length, 2 * C);
  for (let i = 1; i < log.length; i++) assert.ok(log[i][0] > log[i - 1][0], 'monotonic');
  const sync = searchFastestSync(tr, car, V_ENTRY);
  assert.ok(Math.abs(r.time - sync.time) < 1e-9);
  assert.deepEqual(r.params, sync.params);
  /* opts 省略・コーナー0個でも動く */
  const none = await searchFastest(Object.assign({}, tr, { corners: [] }), car, V_ENTRY);
  assert.deepEqual(none.params, []);
});
