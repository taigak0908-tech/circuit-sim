/* ===== 地図（Leaflet）・経路取得・座標変換 =====
   ブラウザではグローバル関数、Node では module.exports。
   Leaflet（グローバル L）には各関数の中でだけ触る（トップレベルでは触らない）。 */
const _xyToLatLng = typeof module !== 'undefined' ? require('./track').xyToLatLng : xyToLatLng;

const VIEW_KEY = 'section-sim-view-v1';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FETCH_TIMEOUT = 15000;   // ms。経路・OSM タグの取得はこれ以上待たない
const TILES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 },
  aerial: { url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', attribution: '国土地理院', maxNativeZoom: 18, maxZoom: 19 }   // 18 を超えたら 18 のタイルを拡大して使う
};

/* 2点間の球面距離(m)（ハーバーサイン） */
function _dist(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function _pathLength(ll) { let d = 0; for (let i = 1; i < ll.length; i++) d += _dist(ll[i - 1], ll[i]); return d; }

/* タイムアウトつきの fetch。ms 以内に応答が返らなければ中断して例外にする。
   戻り値は {ok, json}（本文が JSON でなければ json は null）。通信そのものの失敗・タイムアウトは例外 */
async function _fetchJson(url, opt, ms) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms || FETCH_TIMEOUT);
  try {
    const res = await fetch(url, Object.assign({}, opt, { signal: ac.signal }));
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    return { ok: res.ok, json };
  } finally { clearTimeout(timer); }
}

/* 経路取得（OSRM）。points = [{lat,lng}]（始点・経由点…・終点の順）。
   通信失敗・タイムアウト・HTTPエラー（道が無い以外）は Error('route')、
   道が無い（code が NoSegment/NoRoute/InvalidQuery 系、または 200 で code !== 'Ok'）は Error('noroute') */
async function fetchRoute(points) {
  const coords = points.map(p => p.lng + ',' + p.lat).join(';');
  let r;
  try {
    r = await _fetchJson(OSRM_URL + coords + '?overview=full&geometries=geojson');
  } catch (e) {
    throw new Error('route');
  }
  const json = r.json;
  if (r.ok && !json) throw new Error('route');   // 200 なのに本文が読めない（本文の読み取り中のタイムアウトなど）は通信失敗。道が無いのではない
  if (!r.ok) throw new Error(json && /^(NoSegment|NoRoute|InvalidQuery)/.test(json.code) ? 'noroute' : 'route');
  if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) throw new Error('noroute');
  const route = json.routes[0];
  return { latlngs: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), distance: route.distance };
}

/* OSM の way の tags から道幅(m)を決める。width があればその数値（"6 m" も可）、無く lanes があれば lanes*3、無ければ null。
   elements は Overpass の応答の elements 配列（複数の way があれば width を優先し、先に見つかった値を使う） */
function osmWidthFromElements(elements) {
  let lanes = null;
  for (const el of elements || []) {
    const t = el && el.tags; if (!t) continue;
    const w = parseFloat(t.width);
    if (isFinite(w) && w > 0) return w;
    const n = parseInt(t.lanes, 10);
    if (lanes == null && isFinite(n) && n > 0) lanes = n * 3;
  }
  return lanes;
}

/* 地点の近く（8m 以内）の道路の OSM タグから道幅(m)の初期値を取る（Overpass API）。取れない・失敗・タイムアウトは null */
async function fetchOsmWidth(lat, lng) {
  const q = '[out:json][timeout:10];way(around:8,' + lat + ',' + lng + ')[highway];out tags;';
  try {
    const r = await _fetchJson(OVERPASS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q)
    });
    return r.ok && r.json ? osmWidthFromElements(r.json.elements) : null;
  } catch (e) { return null; }
}

/* 手動の点列を Catmull-Rom スプラインで滑らかにつなぐ（各区間 10 分割）。2点なら直線 */
function manualRoute(points) {
  const n = points.length, STEP = 10, out = [];
  const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
    for (let k = 0; k < STEP; k++) {
      const t = k / STEP;
      out.push({ lat: cr(p0.lat, p1.lat, p2.lat, p3.lat, t), lng: cr(p0.lng, p1.lng, p2.lng, p3.lng, t) });
    }
  }
  if (n) out.push({ lat: points[n - 1].lat, lng: points[n - 1].lng });
  return { latlngs: out, distance: _pathLength(out) };
}

/* tr の中心線（n 省略）または横位置 n[i]（右が正）を適用した線を [{lat,lng}] にする */
function trackToLatLngs(tr, n) {
  const out = new Array(tr.N);
  for (let i = 0; i < tr.N; i++) {
    const d = n ? n[i] : 0;
    out[i] = _xyToLatLng(tr.cx[i] + d * tr.nx[i], tr.cy[i] + d * tr.ny[i], tr.origin);
  }
  return out;
}

/* コーナー番号の丸数字（①〜⑳、21 以上は (21)） */
function _cornerNo(no) { return no >= 1 && no <= 20 ? String.fromCharCode(0x2460 + no - 1) : '(' + no + ')'; }

/* コーナーの表示名。例: ③左R22。withAng=true で「 90°」を付ける（地図ラベル・表で使う） */
function cornerLabel(c, withAng) {
  return _cornerNo(c.no) + (c.dir === 'L' ? '左' : '右') + 'R' + Math.round(c.rMin) + (withAng ? ' ' + Math.round(c.angDeg) + '°' : '');
}

/* 地図のズームがこれ未満なら、コーナーのラベルは丸数字だけにする（密集したコーナーで全文が重なるため） */
const CORNER_FULL_ZOOM = 16;

/* 地図に出すコーナーのラベル。zoom が CORNER_FULL_ZOOM 以上なら全文（①右R38 90°）、未満なら丸数字だけ（①） */
function cornerMapLabel(c, zoom) { return zoom >= CORNER_FULL_ZOOM ? cornerLabel(c, true) : _cornerNo(c.no); }

/* 地図を作る。el = 地図を入れる要素（またはその id）。戻り値のメソッドで操作する */
function createMap(el) {
  const map = L.map(el, { zoomControl: true });
  let base = null;
  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const cornerLayer = L.layerGroup().addTo(map);
  const linesLayer = L.layerGroup().addTo(map);
  const measureLayer = L.layerGroup().addTo(map);
  let carMarker = null, routeLine = null;

  function setBase(name) {
    const t = TILES[name] || TILES.osm;
    if (base) map.removeLayer(base);
    base = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom, maxNativeZoom: t.maxNativeZoom || t.maxZoom }).addTo(map);
    base.bringToBack();
  }
  function setRoute(latlngs) {
    routeLayer.clearLayers(); routeLine = null;
    if (!latlngs || latlngs.length < 2) return;
    routeLine = L.polyline(latlngs.map(p => [p.lat, p.lng]), { color: '#2a78d6', weight: 5, opacity: .8, interactive: false }).addTo(routeLayer);
  }
  function _mk(p, cls, text) {
    return L.marker([p.lat, p.lng], { interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'pt-wrap', html: '<span class="pt ' + cls + '">' + text + '</span>', iconSize: [0, 0] }) });
  }
  function setMarkers(m) {
    markerLayer.clearLayers();
    if (!m) return;
    if (m.start) _mk(m.start, 'pt-start', 'S').addTo(markerLayer);
    (m.vias || []).forEach((p, i) => _mk(p, 'pt-via', String(i + 1)).addTo(markerLayer));
    if (m.end) _mk(m.end, 'pt-end', 'G').addTo(markerLayer);
  }
  /* コーナーのラベルを描く。corners/tr は覚えておき、ズームが変わったら（zoomend）同じ内容でラベルだけ作り直す */
  let cornersShown = null, cornersTr = null;
  function _renderCorners() {
    cornerLayer.clearLayers();
    if (!cornersShown || !cornersTr) return;
    const tr = cornersTr, z = map.getZoom();
    cornersShown.forEach(c => {
      const mid = Math.round((c.i0 + c.i1) / 2);
      const p = _xyToLatLng(tr.cx[mid], tr.cy[mid], tr.origin);
      const text = cornerMapLabel(c, z);
      L.marker([p.lat, p.lng], { interactive: false, keyboard: false, zIndexOffset: 500,
        icon: L.divIcon({ className: 'corner-wrap', html: '<span class="corner-lbl">' + text + '</span>', iconSize: [0, 0] }) }).addTo(cornerLayer);
    });
  }
  function drawCorners(corners, tr) {
    cornersShown = corners && corners.length ? corners : null; cornersTr = tr || null;   // 空・null で前のコーナーを消す
    _renderCorners();
  }
  function drawLines(lines) {
    linesLayer.clearLayers();
    (lines || []).forEach(l => {
      L.polyline(l.latlngs.map(p => [p.lat, p.lng]), { color: l.color, weight: l.weight || 3, opacity: .95, interactive: false }).addTo(linesLayer);
    });
  }
  function clearLines() { linesLayer.clearLayers(); }
  function setCar(p) {
    if (carMarker) { map.removeLayer(carMarker); carMarker = null; }
    if (p) carMarker = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#d03b3b', fillOpacity: 1, interactive: false }).addTo(map);
  }
  /* 幅の計測用の一時描画。p1 だけなら仮の点、p1 と p2 なら点と線。p1 が null なら消す */
  function measureLine(p1, p2) {
    measureLayer.clearLayers();
    if (!p1) return;
    const dot = p => L.circleMarker([p.lat, p.lng], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#eda100', fillOpacity: 1, interactive: false }).addTo(measureLayer);
    dot(p1);
    if (p2) { dot(p2); L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], { color: '#eda100', weight: 3, interactive: false }).addTo(measureLayer); }
  }
  function onMapClick(cb) { map.on('click', e => cb({ lat: e.latlng.lat, lng: e.latlng.lng })); }
  /* 地図を経路全体に合わせる。アニメーションは使わない（アニメーションは requestAnimationFrame 頼みで、
     直後の重い計算や、画面に出ていないタブでは止まって「合わない」ように見えるため。その場で合わせる） */
  function fitRoute() { if (routeLine) map.fitBounds(routeLine.getBounds(), { padding: [30, 30], animate: false }); }
  function saveView() {
    try { const c = map.getCenter(); localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })); } catch (e) { /* 保存できなくても動く */ }
  }
  function restoreView() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(VIEW_KEY)); } catch (e) { v = null; }
    if (v && isFinite(v.lat) && isFinite(v.lng) && isFinite(v.zoom)) map.setView([v.lat, v.lng], v.zoom);
    else map.setView([36.5, 137.5], 5);
  }

  restoreView();
  setBase('osm');
  map.on('moveend', saveView);
  map.on('zoomend', () => { if (cornersShown) _renderCorners(); });   // ズームでラベルの詳しさを切り替える
  return { map, setBase, setRoute, setMarkers, drawCorners, drawLines, clearLines, setCar, measureLine, onMapClick, fitRoute, saveView, restoreView };
}

if (typeof module !== 'undefined') module.exports = { fetchRoute, fetchOsmWidth, osmWidthFromElements, manualRoute, trackToLatLngs, createMap, cornerLabel, cornerNo: _cornerNo, cornerMapLabel, CORNER_FULL_ZOOM };
