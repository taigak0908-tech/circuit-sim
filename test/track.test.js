const { test, assert } = require('./harness');
const { toLocalXY, xyToLatLng, resample, smooth, headingAndNormal, curvature } = require('../js/track');

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
