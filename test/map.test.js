const { test, assert } = require('./harness');
const { buildTrackFromPath } = require('../js/track');
const { trackToLatLngs } = require('../js/map');

const haversine = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* 北へ約 333m の直線（緯度 0.003° ぶん） */
const straight = () => buildTrackFromPath(
  Array.from({ length: 31 }, (_, i) => ({ lat: 35 + i * 0.0001, lng: 139 })), { W: 6, mode: 'full' });

test('trackToLatLngs: n 省略で中心線が origin 近傍に載る', () => {
  const tr = straight();
  const ll = trackToLatLngs(tr);
  assert.equal(ll.length, tr.N);
  for (const p of ll) assert.ok(haversine(p, tr.origin) < 200, '原点から遠い');
  // 北向きの直線なので経度は変わらない
  assert.ok(Math.abs(ll[0].lng - 139) < 1e-7 && Math.abs(ll[tr.N - 1].lng - 139) < 1e-7);
});

test('trackToLatLngs: n を渡すと法線方向に n[i] だけずれる', () => {
  const tr = straight();
  const c = trackToLatLngs(tr);
  const n = new Float64Array(tr.N).fill(3);
  const sh = trackToLatLngs(tr, n);
  for (const i of [0, 100, tr.N - 1]) assert.ok(Math.abs(haversine(c[i], sh[i]) - 3) < 0.01, 'ずれ ' + haversine(c[i], sh[i]));
  // 北向き進行の右（東）側に寄る → 経度が増える
  assert.ok(sh[100].lng > c[100].lng);
});
