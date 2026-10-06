const { test, assert } = require('./harness');
const { buildTrackFromPath } = require('../js/track');
const { trackToLatLngs, fetchRoute, fetchOsmWidth, osmWidthFromElements, cornerLabel, cornerMapLabel, CORNER_FULL_ZOOM } = require('../js/map');

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

/* ---- 通信まわり（fetch を差し替えて試す） ---- */
async function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('not json'); return body; } });
const P = [{ lat: 36.7, lng: 139.5 }, { lat: 36.8, lng: 139.4 }];
const errMsg = async p => { try { await p; return null; } catch (e) { return e.message; } };

test('fetchRoute: 成功で latlngs と distance を返す', async () => {
  const body = { code: 'Ok', routes: [{ distance: 123, geometry: { coordinates: [[139.5, 36.7], [139.4, 36.8]] } }] };
  const r = await withFetch(reply(200, body), () => fetchRoute(P));
  assert.deepEqual(r.latlngs, [{ lat: 36.7, lng: 139.5 }, { lat: 36.8, lng: 139.4 }]);
  assert.equal(r.distance, 123);
});

test('fetchRoute: HTTP 400 でも code が NoSegment/NoRoute/InvalidQuery なら noroute', async () => {
  for (const code of ['NoSegment', 'NoRoute', 'InvalidQuery']) {
    assert.equal(await withFetch(reply(400, { code }), () => errMsg(fetchRoute(P))), 'noroute', code);
  }
});

test('fetchRoute: 200 で code が Ok でないときも noroute', async () => {
  assert.equal(await withFetch(reply(200, { code: 'NoRoute' }), () => errMsg(fetchRoute(P))), 'noroute');
});

test('fetchRoute: 429・500・JSON でない本文・通信失敗は route', async () => {
  assert.equal(await withFetch(reply(429, undefined), () => errMsg(fetchRoute(P))), 'route');
  assert.equal(await withFetch(reply(500, { code: 'Boom' }), () => errMsg(fetchRoute(P))), 'route');
  assert.equal(await withFetch(async () => { throw new TypeError('net'); }, () => errMsg(fetchRoute(P))), 'route');
});

test('fetchRoute: 200 でも本文が JSON として読めなければ route（noroute にしない）', async () => {
  assert.equal(await withFetch(reply(200, undefined), () => errMsg(fetchRoute(P))), 'route');
});

test('fetchRoute: 15秒で打ち切る（signal が abort されると route）', async () => {
  let sig = null;
  const hang = (url, opt) => new Promise((_, rej) => { sig = opt.signal; opt.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const t0 = Date.now(), realTO = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => realTO(fn, ms === 15000 ? 20 : ms);   // 待ち時間だけ短縮
  try { assert.equal(await withFetch(hang, () => errMsg(fetchRoute(P))), 'route'); }
  finally { globalThis.setTimeout = realTO; }
  assert.ok(sig && sig.aborted && Date.now() - t0 < 2000);
});

test('osmWidthFromElements: width 優先（単位つき可）、無ければ lanes*3、どちらも無ければ null', () => {
  assert.equal(osmWidthFromElements([{ tags: { highway: 'residential', width: '6.5' } }]), 6.5);
  assert.equal(osmWidthFromElements([{ tags: { width: '6 m' } }]), 6);
  assert.equal(osmWidthFromElements([{ tags: { lanes: '2', width: 'narrow' } }]), 6);
  assert.equal(osmWidthFromElements([{ tags: { lanes: '2' } }, { tags: { width: '7' } }]), 7);
  assert.equal(osmWidthFromElements([{ tags: { highway: 'track' } }]), null);
  assert.equal(osmWidthFromElements([]), null);
  assert.equal(osmWidthFromElements(undefined), null);
  assert.equal(osmWidthFromElements([{ tags: { width: '0' } }]), null);
});

test('fetchOsmWidth: Overpass に data= で POST し、数値を返す／失敗は null', async () => {
  let seen = null;
  const ok = async (url, opt) => { seen = { url, opt }; return { ok: true, json: async () => ({ elements: [{ tags: { lanes: '2' } }] }) }; };
  assert.equal(await withFetch(ok, () => fetchOsmWidth(36.74, 139.5)), 6);
  assert.ok(seen.url.includes('overpass-api.de') && seen.opt.method === 'POST');
  assert.equal(decodeURIComponent(seen.opt.body), 'data=[out:json][timeout:10];way(around:8,36.74,139.5)[highway];out tags;');
  assert.equal(await withFetch(reply(504, undefined), () => fetchOsmWidth(1, 2)), null);
  assert.equal(await withFetch(async () => { throw new Error('net'); }, () => fetchOsmWidth(1, 2)), null);
});

test('cornerMapLabel: ズーム 16 未満は丸数字だけ、16 以上は全文（重なり対策）', () => {
  const c = { no: 1, dir: 'R', rMin: 38, angDeg: 90 };
  assert.equal(CORNER_FULL_ZOOM, 16);
  assert.equal(cornerMapLabel(c, 15), '①');
  assert.equal(cornerMapLabel(c, 15.9), '①');
  assert.equal(cornerMapLabel(c, 16), '①右R38 90°');
  assert.equal(cornerMapLabel(c, 18), cornerLabel(c, true));
  assert.equal(cornerMapLabel({ no: 21, dir: 'L', rMin: 9, angDeg: 120 }, 10), '(21)');
});
