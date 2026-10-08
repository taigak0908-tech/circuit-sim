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
  /* 黄色い板: 最速と中央の差（−は U+2212） */
  const plate = SR.plateHtml(info);
  assert.ok(plate.includes('最速は中央より') && plate.includes('<span class="plate-n">' + SR.sgn(info.delta, 2) + '</span>'), plate);
  if (info.worst) {
    assert.ok(info.worst.d < 0);
    assert.ok(html.includes(info.worst.label) && html.includes('−' + Math.abs(info.worst.d).toFixed(2) + '秒'), html);
  }
  /* 表: コーナー行 + 合計行、非表示の系列は列に出ない */
  const t = SR.tableHtml(tr, R, ['center', 'fast'], 'fast', 0);
  assert.equal((t.match(/<tr data-c=/g) || []).length, tr.corners.length);
  assert.ok(t.includes('区間合計') && t.includes('基準') && !t.includes('全インベタ'));
  /* 各コーナー行に 1コーナー比較へのリンク（そのコーナーの R・角度・区間の幅・入口の中央ラインの速度） */
  const links = t.match(/<a class="btn-sm"[^>]*href="[^"]+"/g) || [];
  assert.equal(links.length, tr.corners.length);
  tr.corners.forEach((k, c) => assert.ok(links[c].includes('href="' + SR.cornerLinkUrl(k, R.center.sim.v[k.i0], tr.W) + '"'), links[c]));
  assert.ok(t.includes('半径 5〜200 m・幅 3〜16 m・入口速度 20〜220 km/h'));
  /* 行頭はひし形の番号＋「右 R38 90°」。選んだ行（selCorner=0）は pick */
  tr.corners.forEach(k => assert.ok(t.includes('<span class="dia"><span>' + k.no + '</span></span><span>' + (k.dir === 'L' ? '左' : '右') + ' R' + Math.round(k.rMin) + ' ' + Math.round(k.angDeg) + '°</span>')));
  assert.ok(t.includes('<tr data-c="0" class="pick" aria-current="true">'));
  /* スマホ幅（compact）: 系列の選択によらず「最低・最速・自分」の3列＋リンク。行数・リンクは同じ */
  const tc = SR.tableHtml(tr, R, ['center', 'inside'], 'center', -1, true);
  assert.equal((tc.match(/<tr data-c=/g) || []).length, tr.corners.length);
  assert.equal((tc.match(/<a class="btn-sm"[^>]*href="[^"]+"/g) || []).length, tr.corners.length);
  assert.ok(tc.includes('最低 km/h') && tc.includes('最速 s') && tc.includes('自分 s') && !tc.includes('全インベタ') && !tc.includes('class="pick"'));
  assert.ok(tc.includes('<td class="t">' + R.fast.sim.time.toFixed(2) + '</td>') && tc.includes(R.my.sim.time.toFixed(2)));
  const c0 = R.fast.stats[0];
  assert.ok(tc.includes('<td>' + (c0.vMin * 3.6).toFixed(1) + '</td><td>' + c0.tCorner.toFixed(2) + '</td><td>' + R.my.stats[0].tCorner.toFixed(2) + '</td>'));
});

test('凡例: 末尾に型ラインの説明（参考値・基準は最速と自分のライン）が入り、チェックボックス・ボタンは系列ぶん', () => {
  const h = SR.legendHtml();
  assert.ok(h.includes('class="lg-note"') && h.includes('参考値です') && h.includes('「最速」と「自分のライン」を基準'));
  assert.equal((h.match(/data-vis=/g) || []).length, SR.SERIES.length);
  assert.equal((h.match(/data-sel=/g) || []).length, SR.SERIES.length);
});

test('引き継ぎ URL: R・角度（5° 刻み）・幅・入口速度（km/h 整数）を index.html へ渡す', () => {
  const k = { rMin: 21.6, angDeg: 87.4 };
  assert.equal(SR.cornerLinkUrl(k, 100 / 3.6, 6), 'index.html?R=22&angDeg=85&W=6&vIn=100');
  assert.equal(SR.cornerLinkUrl({ rMin: 80, angDeg: 91 }, 41.67, 7.5), 'index.html?R=80&angDeg=90&W=7.5&vIn=150');
});

test('判定: コーナー0個は「ほぼ直線」、差が負なら −X.XX秒の形', () => {
  const trS = { corners: [] };
  const mk = time => ({ sim: { time }, stats: [] });
  const s = SR.verdictInfo({ fast: mk(10), center: mk(10.3) }, trS);
  assert.ok(s.straight && SR.verdictHtml(s).includes('ほぼ直線のため、ラインによる差はありません。区間タイム'));
  assert.ok(SR.plateHtml(s).includes('区間タイム') && SR.plateHtml(s).includes('<span class="plate-n">10.00</span>'));
  const tr2 = { corners: [{ no: 1, dir: 'R', rMin: 38, angDeg: 90 }, { no: 3, dir: 'L', rMin: 22, angDeg: 100 }] };
  const mk2 = (time, a, b) => ({ sim: { time }, stats: [{ tCorner: a }, { tCorner: b }] });
  const info = SR.verdictInfo({ center: mk2(20, 3, 4), fast: mk2(19.66, 2.9, 3.39) }, tr2);
  assert.equal(info.worst.label, '③左R22');
  const html = SR.verdictHtml(info);
  assert.ok(html.includes('19.66') && html.includes('③左R22') && html.includes('−0.61秒') && !html.includes('中央のほうが速い'), html);
  assert.ok(SR.plateHtml(info).includes('<span class="plate-l">最速は中央より</span><span class="plate-n">−0.34</span>'), SR.plateHtml(info));
  /* 最速が中央より遅い（探索中の仮の値など）は ＋ と「中央のほうが速い」 */
  const slow = SR.verdictInfo({ center: mk2(20, 3, 4), fast: mk2(20.2, 3.1, 4.1) }, tr2);
  assert.ok(SR.plateHtml(slow).includes('+0.20') && SR.verdictHtml(slow).includes('中央のほうが速いラインです'));
});

test('今いる場所の1行: コーナー内はひし形の番号と「左 R22 の 40%」、外は「区間 1,234 m」、続けて速度', () => {
  const tr = { corners: [{ no: 3, dir: 'L', rMin: 22, angDeg: 90, i0: 100, i1: 200 }], st: Float64Array.from({ length: 2000 }, (_, i) => i) };
  const h = SR.posHtml(tr, 140, 31.4);
  assert.ok(h.startsWith('<span class="dia"><span>3</span></span>') && h.includes('左 R22 の <b class="num">40</b>%') && h.includes('<b class="num">31</b> km/h'), h);
  const o = SR.posHtml(tr, 1234, 88.6);
  assert.ok(!o.includes('class="dia"') && o.includes('区間 <b class="num">1,234</b> m') && o.includes('<b class="num">89</b> km/h'), o);
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

test('G-G 図: 枠が極端に小さくても円の半径が負にならない（<circle> attribute r の負値エラー対策）', () => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), { W: 6, mode: 'full' });
  const R = results(tr), car = deriveCar(GRB);
  for (const [w, h] of [[30, 260], [262, 20], [0, 0], [300, 260]]) {
    const html = SR.ggPlot(w, h, car, R.center.sim, 'red').html;
    const rs = [...html.matchAll(/ r="([^"]+)"/g)].map(m => +m[1]);
    assert.ok(rs.length > 0 && rs.every(r => r >= 0), w + 'x' + h + ': ' + rs.join(','));
  }
});
