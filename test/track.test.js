const { test, assert } = require('./harness');
const { toLocalXY, xyToLatLng, resample, smooth, headingAndNormal, curvature, detectCorners, laneBounds, buildTrackFromPath } = require('../js/track');

/* 中心 (0,0)・半径 r の円周上に 1° 刻みで n 点。ccw=true なら反時計回り（左旋回） */
function arc(r, n, ccw) {
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const a = (ccw ? 1 : -1) * i * Math.PI / 180;
    xs.push(r * Math.cos(a)); ys.push(r * Math.sin(a));
  }
  return { xs, ys };
}
const mean = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return s / (to - from); };
const haversine = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test('半径50mの円弧を1m刻みにすると曲率が1/50±2%', () => {
  const { xs, ys } = arc(50, 180, true);
  const { cx, cy, st } = resample(xs, ys, 1);
  assert.equal(st[3], 3);
  const k = smooth(curvature(cx, cy), 5);
  const m = mean(k, 10, k.length - 10);
  assert.ok(Math.abs(m - 1 / 50) < 0.02 / 50, '平均曲率 ' + m);
});

test('同じ座標が連続しても resample が NaN を出さない', () => {
  const { cx, cy, st } = resample([0, 0, 10, 10, 20], [0, 0, 0, 0, 0], 1);
  assert.equal(cx.length, 21);
  for (let i = 0; i < cx.length; i++) {
    assert.ok(Number.isFinite(cx[i]) && Number.isFinite(cy[i]) && Number.isFinite(st[i]), 'i=' + i);
    assert.ok(Math.abs(cx[i] - i) < 1e-9 && cy[i] === 0, 'i=' + i);
  }
});

test('5km離れた点を xy→latlng に戻すと誤差0.5m未満', () => {
  const c = { lat: 35.36, lng: 138.73 };
  const pts = [[c.lat, c.lng], [c.lat + 0.045, c.lng], [c.lat - 0.045, c.lng], [c.lat, c.lng + 0.055], [c.lat, c.lng - 0.055]];
  const { xs, ys, origin } = toLocalXY(pts);
  /* 原点は重心（対称配置なので中心点に一致） */
  assert.ok(haversine(origin, c) < 0.01);
  for (let i = 0; i < pts.length; i++) {
    const back = xyToLatLng(xs[i], ys[i], origin);
    const d = haversine({ lat: pts[i][0], lng: pts[i][1] }, back);
    assert.ok(d < 0.5, 'i=' + i + ' 誤差 ' + d + ' m');
  }
  /* x=東, y=北: 北の点は y が正、東の点は x が正 */
  assert.ok(ys[1] > 4900 && Math.abs(xs[1]) < 1e-6);
  assert.ok(xs[3] > 4900 && Math.abs(ys[3]) < 1e-6);
});

test('{lat,lng} オブジェクトの列も受け付ける', () => {
  const a = toLocalXY([[35, 139], [35.001, 139.001]]);
  const b = toLocalXY([{ lat: 35, lng: 139 }, { lat: 35.001, lng: 139.001 }]);
  assert.deepEqual(Array.from(a.xs), Array.from(b.xs));
  assert.deepEqual(Array.from(a.ys), Array.from(b.ys));
});

test('右旋回の曲率は負、左旋回は正', () => {
  const L = arc(50, 180, true), R = arc(50, 180, false);
  const kL = curvature(resample(L.xs, L.ys, 1).cx, resample(L.xs, L.ys, 1).cy);
  const kR = curvature(resample(R.xs, R.ys, 1).cx, resample(R.xs, R.ys, 1).cy);
  assert.ok(mean(kL, 5, kL.length - 5) > 0);
  assert.ok(mean(kR, 5, kR.length - 5) < 0);
});

test('smooth は端で窓を縮めて平均する', () => {
  const s = smooth([0, 3, 6, 9, 12], 1);
  assert.ok(s instanceof Float64Array);
  assert.deepEqual(Array.from(s), [1.5, 3, 6, 9, 10.5]);
});

test('headingAndNormal は進行方向の右を正の法線にする', () => {
  /* 東向きの直線: 右は南（y が負）→ nx=0, ny=-1 */
  const e = headingAndNormal([0, 1, 2, 3], [0, 0, 0, 0]);
  assert.ok(Math.abs(e.nx[1]) < 1e-12 && Math.abs(e.ny[1] + 1) < 1e-12);
  /* 北向き: 右は東 → nx=1, ny=0。端（片側差分）でも同じ */
  const n = headingAndNormal([0, 0, 0], [0, 1, 2]);
  for (const i of [0, 1, 2]) assert.ok(Math.abs(n.nx[i] - 1) < 1e-12 && Math.abs(n.ny[i]) < 1e-12);
});

/* ===== コーナー検出・走行範囲・buildTrackFromPath ===== */

const { course, toLatLngs, SHAPE } = require('./fixtures/courses');

test('左R30→直線40m→右R30 のS字で左右2コーナーが検出される', () => {
  const tr = buildTrackFromPath(toLatLngs(course(SHAPE)), {});
  assert.ok(!tr.error, 'error: ' + tr.error);
  assert.equal(tr.corners.length, 2);
  assert.deepEqual(tr.corners.map(c => c.dir), ['L', 'R']);
  assert.deepEqual(tr.corners.map(c => c.no), [1, 2]);
  for (const c of tr.corners) {
    assert.ok(Math.abs(c.angDeg - 90) < 8, 'angDeg ' + c.angDeg);
    assert.ok(c.rMin > 25 && c.rMin < 36, 'rMin ' + c.rMin);
    assert.ok(c.s0 === c.i0 * tr.ds && c.s1 === c.i1 * tr.ds);
  }
  assert.ok(tr.corners[0].s1 < tr.corners[1].s0, 'コーナーが順に並ぶ');
  /* tr の基本形 */
  assert.equal(tr.ds, 1);
  assert.equal(tr.N, tr.cx.length);
  assert.equal(tr.total, tr.st[tr.N - 1]);
  assert.equal(tr.W, 6); assert.equal(tr.bLo, -2); assert.equal(tr.bHi, 2); assert.equal(tr.z, null);
  assert.ok(tr.origin && Number.isFinite(tr.origin.lat));
});

test('R=8m・180°のヘアピンが1コーナー、angDeg≈180±5', () => {
  const tr = buildTrackFromPath(toLatLngs(course([['s', 50], ['R', 8, 180], ['s', 50]])), { W: 4, mode: 'lane' });
  assert.ok(!tr.error, 'error: ' + tr.error);
  assert.equal(tr.corners.length, 1);
  const c = tr.corners[0];
  assert.equal(c.dir, 'R');
  assert.ok(c.angDeg >= 175 && c.angDeg <= 185, 'angDeg ' + c.angDeg);
  assert.ok(c.rMin >= 7 && c.rMin <= 9, 'rMin ' + c.rMin);
  assert.equal(tr.bHi, 0);
});

test('±1mのノイズを乗せても検出数と向きが変わらない（ノイズ位相8通り）', () => {
  /* 点を 20m 間隔（地図を手でなぞる程度）に間引き、各点を ±1m の決定的な擬似乱数でずらす。
     10m 以下の間隔だと、±1m のずれが 10〜20° の偽コーナーになり minAng=10 でも除けない（検出側の限界） */
  const a = buildTrackFromPath(toLatLngs(course(SHAPE)), {});
  assert.ok(!a.error);
  for (let ph = 0; ph < 8; ph++) {
    const b = buildTrackFromPath(toLatLngs(course(SHAPE, 1.0, 20, ph)), {});
    assert.ok(!b.error, 'phase ' + ph);
    assert.deepEqual(b.corners.map(c => c.dir), a.corners.map(c => c.dir), 'phase ' + ph);
  }
});

test('minAng(10°) 未満の緩いカーブはコーナーに数えない', () => {
  /* 1/100 を 9 点 = 0.09rad ≒ 5.2°（kMin・minLen は満たす）→ 捨てる。本物の 38° のコーナーの番号は 1 から振り直す */
  const k = new Float64Array(80);
  for (let i = 5; i < 14; i++) k[i] = 1 / 100;
  assert.equal(detectCorners(k, 1.0).length, 0);
  for (let i = 40; i < 60; i++) k[i] = -1 / 30;
  const m = detectCorners(k, 1.0);
  assert.equal(m.length, 1);
  assert.equal(m[0].no, 1); assert.equal(m[0].dir, 'R');
  /* minAng を下げれば数える */
  assert.equal(detectCorners(k, 1.0, { minAng: 3 }).length, 2);
});

test('同方向コーナーが10m間隔なら1つにまとまる', () => {
  /* 左(1/30)20点 → ゼロ10点 → 左20点。間 10m は mergeGap 15 未満 */
  const k = new Float64Array(70);
  for (let i = 10; i < 30; i++) k[i] = 1 / 30;
  for (let i = 40; i < 60; i++) k[i] = 1 / 30;
  const m = detectCorners(k, 1.0);
  assert.equal(m.length, 1);
  assert.equal(m[0].i0, 10); assert.equal(m[0].i1, 59); assert.equal(m[0].dir, 'L');
  /* 間隔が mergeGap 以上（20m）なら分かれたまま */
  const k2 = new Float64Array(80);
  for (let i = 10; i < 30; i++) k2[i] = 1 / 30;
  for (let i = 50; i < 70; i++) k2[i] = 1 / 30;
  const m2 = detectCorners(k2, 1.0);
  assert.equal(m2.length, 2);
  /* 向きが違うなら隙間 0 でもまとめない */
  const k3 = new Float64Array(60);
  for (let i = 10; i < 30; i++) k3[i] = 1 / 30;
  for (let i = 30; i < 50; i++) k3[i] = -1 / 30;
  const m3 = detectCorners(k3, 1.0);
  assert.deepEqual(m3.map(c => c.dir), ['L', 'R']);
  assert.deepEqual(m3.map(c => c.no), [1, 2]);
  /* minLen(8m) 未満の短い区間は無視 */
  const k4 = new Float64Array(40); k4[10] = k4[11] = k4[12] = 1 / 20;
  assert.equal(detectCorners(k4, 1.0).length, 0);
  /* rMin と angDeg: 20点 × (1/30 rad/m) × 1m = 0.667 rad ≒ 38.2° */
  assert.ok(Math.abs(m[0].rMin - 30) < 1e-9);
  assert.ok(Math.abs(m2[0].angDeg - 20 / 30 * 180 / Math.PI) < 1e-9);
});

test('laneBounds(6,"full") は [-2,2]、laneBounds(6,"lane") は [-2,0]', () => {
  assert.deepEqual(laneBounds(6, 'full'), { bLo: -2, bHi: 2 });
  assert.deepEqual(laneBounds(6, 'lane'), { bLo: -2, bHi: 0 });
  assert.deepEqual(laneBounds(3, 'full'), { bLo: -0.5, bHi: 0.5 });
  assert.deepEqual(laneBounds(3, 'lane'), { bLo: -0.5, bHi: 0 });
  assert.deepEqual(laneBounds(6, 'xxx'), { bLo: -2, bHi: 2 });
});

test('全長80mは {error:"short"}、5kmを超えると {error:"long"}', () => {
  const s = buildTrackFromPath(toLatLngs(course([['s', 80]])), {});
  assert.equal(s.error, 'short');
  assert.ok(s.total > 79 && s.total < 81);
  assert.ok(!('corners' in s));
  const one = buildTrackFromPath([[35, 139]], {});
  assert.equal(one.error, 'short'); assert.equal(one.total, 0);
  const l = buildTrackFromPath([[35, 139], [35.05, 139]], {});
  assert.equal(l.error, 'long'); assert.ok(l.total > 5000);
});

/* ===== 中心線の位置平滑化（折れ線の頂点を丸める） ===== */

/* 直線 60m → 頂点で turnDeg°（左）曲がる → 直線 60m を、12m 間隔の点列（頂点で折れる折れ線）として作る。
   OSRM の道路形状の再現。turnDeg 省略時は 90° */
function polylineCorner(turnDeg) {
  const a = (turnDeg == null ? 90 : turnDeg) * Math.PI / 180, xs = [], ys = [];
  let x = 0, y = 0;
  xs.push(x); ys.push(y);
  for (let i = 0; i < 5; i++) { x += 12; xs.push(x); ys.push(y); }
  for (let i = 0; i < 5; i++) { x += 12 * Math.cos(a); y += 12 * Math.sin(a); xs.push(x); ys.push(y); }
  return { xs, ys };
}

test('折れ線の鋭い頂点が丸められる（最小半径4m以上・コーナー1つ・旋回角が頂点の角度に合う）', () => {
  const tr = buildTrackFromPath(toLatLngs(polylineCorner()), {});
  assert.ok(!tr.error, 'error: ' + tr.error);
  let kMax = 0;
  for (let i = 0; i < tr.N; i++) kMax = Math.max(kMax, Math.abs(tr.kap[i]));
  const minR = 1 / kMax;
  assert.ok(minR >= 4, 'minR ' + minR);
  assert.equal(tr.corners.length, 1);
  assert.ok(tr.corners[0].angDeg >= 80 && tr.corners[0].angDeg <= 100, 'angDeg ' + tr.corners[0].angDeg);
  /* 位置を平滑化しないと、1m 刻みの折れ線では 3 点の円による曲率が頂点の折れ角を過小に見積もる
     （90° の頂点が 81°、150° が 111° になる）。平滑化後は頂点の角度どおりに出る */
  assert.ok(Math.abs(tr.corners[0].angDeg - 90) <= 5, '90°の頂点の angDeg ' + tr.corners[0].angDeg);
  const sharp = buildTrackFromPath(toLatLngs(polylineCorner(150)), {});
  assert.equal(sharp.corners.length, 1);
  assert.ok(Math.abs(sharp.corners[0].angDeg - 150) <= 5, '150°の頂点の angDeg ' + sharp.corners[0].angDeg);
});

test('始点・終点の位置は平滑化でほぼ動かない（1.0m以内）', () => {
  const ll = toLatLngs(polylineCorner());
  const tr = buildTrackFromPath(ll, {});
  assert.ok(!tr.error, 'error: ' + tr.error);
  /* tr.cx/cy は重心原点の xy なので、元の点列も同じ重心原点に直して比べる。
     比べる相手は「平滑化前の 1m 刻み中心線」の始点・終点。resample は終点を含めず（全長の端数は切り捨て）、
     平滑化の後にもう一度 resample するので、終点は最大 1m 手前になる。平滑化そのものが動かすのはこの端数だけ */
  const { xs, ys } = toLocalXY(ll);
  const r = resample(xs, ys, 1.0), last = r.cx.length - 1, N = tr.N;
  const d0 = Math.hypot(tr.cx[0] - r.cx[0], tr.cy[0] - r.cy[0]);
  const d1 = Math.hypot(tr.cx[N - 1] - r.cx[last], tr.cy[N - 1] - r.cy[last]);
  assert.ok(d0 <= 1.0, '始点のずれ ' + d0);
  assert.ok(d1 <= 1.0, '終点のずれ ' + d1);
});
