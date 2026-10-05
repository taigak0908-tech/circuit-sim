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

/* 東向きに出発して、直線と円弧をつないだ中心線（平面 xy）を作る。0.5m 刻みで点を打つ。
   steps: ['s', 長さm] / ['L'|'R', 半径m, 角度°]。
   noise>0 なら spacing m 間隔に間引いた各点の xy に、±noise m 以内の決定的な擬似乱数を足す */
function course(steps, noise, spacing) {
  const h = 0.5;
  let x = 0, y = 0, hd = 0;
  const xs = [x], ys = [y];
  for (const [k, a, b] of steps) {
    if (k === 's') {
      for (let d = 0; d < a; d += h) { x += Math.cos(hd) * h; y += Math.sin(hd) * h; xs.push(x); ys.push(y); }
    } else {
      const sgn = k === 'L' ? 1 : -1, n = Math.round(a * b * Math.PI / 180 / h);
      for (let i = 0; i < n; i++) { hd += sgn * h / a; x += Math.cos(hd) * h; y += Math.sin(hd) * h; xs.push(x); ys.push(y); }
    }
  }
  if (!noise) return { xs, ys };
  const step = Math.round(spacing / h), nx = [], ny = [];
  for (let i = 0; i < xs.length; i += step) {
    nx.push(xs[i] + Math.sin(i * 12.9898) * noise);
    ny.push(ys[i] + Math.sin(i * 78.233 + 1) * noise);
  }
  return { xs: nx, ys: ny };
}
const ORIGIN = { lat: 35.36, lng: 138.73 };
const toLatLngs = (c) => c.xs.map((x, i) => { const p = xyToLatLng(x, c.ys[i], ORIGIN); return [p.lat, p.lng]; });
const SHAPE = [['s', 30], ['L', 30, 90], ['s', 40], ['R', 30, 90], ['s', 30]];

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

test('±1mのノイズを乗せても検出数と向きが変わらない', () => {
  /* 点を 20m 間隔（地図を手でなぞる程度）に間引き、各点を ±1m の決定的な擬似乱数でずらす。
     10m 以下の間隔だと、kMin=1/150 では ±1m のずれが小さな偽コーナーになる（検出側のしきい値の限界） */
  const a = buildTrackFromPath(toLatLngs(course(SHAPE)), {});
  const b = buildTrackFromPath(toLatLngs(course(SHAPE, 1.0, 20)), {});
  assert.ok(!a.error && !b.error);
  assert.equal(b.corners.length, a.corners.length);
  assert.deepEqual(b.corners.map(c => c.dir), a.corners.map(c => c.dir));
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
