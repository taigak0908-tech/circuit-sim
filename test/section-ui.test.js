const { test, assert } = require('./harness');
const { deriveCar } = require('../js/physics');
const { buildTrackFromPath } = require('../js/track');
const { centerLine, lineOIO, lineLate, lineInside, lineCustom, defaultParams, runLineN, cornerStats } = require('../js/lines');
const SR = require('../js/section-render');
const { course, toLatLngs, SHAPE } = require('./fixtures/courses');

const GRB = { mass: 1550, ps: 308, mu: 1.10, wf: 59, h: 0.50, rs: 56, L: 2.625, tf: 1.530, tr: 1.540, cda: 0.78, cla: 0.10, rollGrad: 3.2, pitchGrad: 1.6, drive: 'AWD' };

/* section-ui.js の compute と同じ手順で 6 本を作る（fast は my と同じ） */
function results(tr) {
  const car = deriveCar(GRB), vE = 60 / 3.6;
  const run = line => { const r = runLineN(tr, car, vE, line); return { line: r.line, sim: r.sim, stats: cornerStats(tr, r.sim) }; };
  const R = { center: run(centerLine(tr)), oio: run(lineOIO(tr)), late: run(lineLate(tr)), inside: run(lineInside(tr)), my: run(lineCustom(tr, defaultParams(tr, 'late'))) };
  R.fast = R.my;
  return R;
}

test('判定: 最速と中央の差・最も縮んだコーナーを文にする（−は U+2212）', () => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), { W: 6, mode: 'full' });
  assert.ok(!tr.error && tr.corners.length >= 1);
  const R = results(tr);
  const info = SR.verdictInfo(R, tr);
  assert.ok(!info.straight);
  assert.ok(Math.abs(info.delta - (R.fast.sim.time - R.center.sim.time)) < 1e-12);
  const html = SR.verdictHtml(info);
  assert.ok(html.includes(R.fast.sim.time.toFixed(2)));
  if (info.worst) {
    assert.ok(info.worst.d < 0);
    assert.ok(html.includes(info.worst.label) && html.includes('−' + Math.abs(info.worst.d).toFixed(2) + '秒'), html);
  }
  /* 表: コーナー行 + 合計行、非表示の系列は列に出ない */
  const t = SR.tableHtml(tr, R, ['center', 'fast'], 'fast', 0);
  assert.equal((t.match(/<tr data-c=/g) || []).length, tr.corners.length);
  assert.ok(t.includes('区間合計') && t.includes('基準') && !t.includes('全インベタ'));
});

test('判定: コーナー0個は「ほぼ直線」、差が負なら −X.XX秒の形', () => {
  const trS = { corners: [] };
  const mk = time => ({ sim: { time }, stats: [] });
  const s = SR.verdictInfo({ fast: mk(10), center: mk(10.3) }, trS);
  assert.ok(s.straight && SR.verdictHtml(s).includes('ほぼ直線のため、ラインによる差はありません。区間タイム'));
  const tr2 = { corners: [{ no: 1, dir: 'R', rMin: 38, angDeg: 90 }, { no: 3, dir: 'L', rMin: 22, angDeg: 100 }] };
  const mk2 = (time, a, b) => ({ sim: { time }, stats: [{ tCorner: a }, { tCorner: b }] });
  const info = SR.verdictInfo({ center: mk2(20, 3, 4), fast: mk2(19.66, 2.9, 3.39) }, tr2);
  assert.equal(info.worst.label, '③左R22');
  const html = SR.verdictHtml(info);
  assert.ok(html.includes('最速は中央より <strong>−0.34秒</strong>') && html.includes('③左R22') && html.includes('−0.61秒'), html);
});

test('タイム差: 同じ位置 i 同士で中央との差を取る（中央自身は全部0・最後の値は区間タイムの差）', () => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), { W: 6, mode: 'full' });
  const R = results(tr);
  const ds = SR.deltaSeries(R, 'center', ['center', 'oio', 'my']);
  assert.ok(ds.center.every(d => d === 0));
  for (const id of ['oio', 'my']) {
    assert.equal(ds[id].length, tr.N);
    assert.ok(Math.abs(ds[id][tr.N - 1] - (R[id].sim.time - R.center.sim.time)) < 1e-12);
    assert.ok(Math.abs(ds[id][100] - (R[id].sim.t[100] - R.center.sim.t[100])) < 1e-12);
  }
  /* グラフ・ツールチップが落ちずに作れる */
  const p = SR.deltaPlot(600, 190, tr, R, ['center', 'fast'], 'fast');
  assert.ok(p.html.includes('id="delta-x"') && p.html.includes('id="delta-d-fast"') && !p.html.includes('NaN'));
  assert.ok(SR.deltaTipHtml(tr, R, ['fast'], 'fast', 50).includes('距離 50 m'));
});

test('位置の文: コーナー内は「③左R22 の 40% 地点」、外は「区間 1,234 m 地点」', () => {
  const tr = { corners: [{ no: 3, dir: 'L', rMin: 22, angDeg: 90, i0: 100, i1: 200 }], st: Float64Array.from({ length: 2000 }, (_, i) => i) };
  assert.equal(SR.posText(tr, 140), '③左R22 の 40% 地点');
  assert.equal(SR.posText(tr, 100), '③左R22 の 0% 地点');
  assert.equal(SR.posText(tr, 1234), '区間 1,234 m 地点');
  assert.equal(SR.posText(tr, 50), '区間 50 m 地点');
});

test('荷重カード・G-G図: 全位置で NaN を出さず、4輪の荷重・タイヤ使用率が入る', () => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), { W: 6, mode: 'full' });
  const R = results(tr), car = deriveCar(GRB);
  for (const i of [0, 60, tr.N >> 1, tr.N - 1]) {
    const h = SR.stateHtml(car, R.fast.sim, i);
    assert.ok(!h.includes('NaN') && h.includes('4輪の荷重') && h.includes('フロント') && h.includes('リア'), 'i=' + i);
  }
  const gg = SR.ggPlot(300, 230, car, R.fast.sim, '#000');
  assert.ok(!gg.html.includes('NaN') && gg.html.includes('id="ggdot"'));
  const d = SR.ggDot(gg, R.fast.sim, 60);
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
});
