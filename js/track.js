/* ===== 地図座標 → 中心線・法線・曲率（DOM非依存・ブラウザではグローバル関数、Node では module.exports） ===== */
const EARTH_R = 6371000;

/* 緯度経度の列を、重心を原点とする平面座標(m)にする（正距円筒。x=東, y=北）。
   latlngs は [lat,lng] の配列でも {lat,lng} のオブジェクトでもよい。 */
function toLocalXY(latlngs) {
  const n = latlngs.length;
  const la = new Float64Array(n), lo = new Float64Array(n);
  let sLat = 0, sLng = 0;
  for (let i = 0; i < n; i++) {
    const p = latlngs[i];
    la[i] = Array.isArray(p) ? p[0] : p.lat;
    lo[i] = Array.isArray(p) ? p[1] : p.lng;
    sLat += la[i]; sLng += lo[i];
  }
  const origin = { lat: sLat / n, lng: sLng / n };
  const rad = Math.PI / 180, kx = EARTH_R * Math.cos(origin.lat * rad) * rad, ky = EARTH_R * rad;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = (lo[i] - origin.lng) * kx; ys[i] = (la[i] - origin.lat) * ky; }
  return { xs, ys, origin };
}

/* toLocalXY の逆変換 */
function xyToLatLng(x, y, origin) {
  const rad = Math.PI / 180;
  return {
    lat: origin.lat + y / (EARTH_R * rad),
    lng: origin.lng + x / (EARTH_R * Math.cos(origin.lat * rad) * rad)
  };
}

/* 折れ線を弧長 ds 刻みに線形補間する。長さ 0（1e-9 未満）の辺は飛ばす。
   st[i] = i*ds の等間隔で、折れ線の全長を超えない範囲まで（元の終点は含めない）。 */
function resample(xs, ys, ds) {
  const cx = [], cy = [], st = [];
  let acc = 0;      // ここまでの辺の累積長
  let next = 0;     // 次に置く点の弧長位置
  for (let i = 0; i < xs.length - 1; i++) {
    const dx = xs[i + 1] - xs[i], dy = ys[i + 1] - ys[i], len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    /* 浮動小数の誤差で終点ちょうどの点が落ちないよう、わずかに余裕を見る */
    while (next <= acc + len + 1e-9) {
      const t = Math.min(1, Math.max(0, (next - acc) / len));
      cx.push(xs[i] + dx * t); cy.push(ys[i] + dy * t); st.push(st.length * ds);
      next = st.length * ds;
    }
    acc += len;
  }
  return { cx: Float64Array.from(cx), cy: Float64Array.from(cy), st: Float64Array.from(st) };
}

/* 窓 [i-halfWin, i+halfWin] の単純移動平均。端は窓を縮める（存在する点だけで平均） */
function smooth(arr, halfWin) {
  const n = arr.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - halfWin), b = Math.min(n - 1, i + halfWin);
    let s = 0;
    for (let j = a; j <= b; j++) s += arr[j];
    out[i] = s / (b - a + 1);
  }
  return out;
}

/* 各点の進行方向（前後差分、端は片側差分）から法線を出す。
   index.html の buildTrack と同じ規約: nx = sin(hd), ny = -cos(hd)（進行方向の右が正） */
function headingAndNormal(cx, cy) {
  const N = cx.length, nx = new Float64Array(N), ny = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    const hd = Math.atan2(cy[b] - cy[a], cx[b] - cx[a]);
    nx[i] = Math.sin(hd); ny[i] = -Math.cos(hd);
  }
  return { nx, ny };
}

/* 3点を通る円の符号付き曲率（index.html の finishLine と同じ式）。左旋回が正、右旋回が負。端は隣の値をコピー */
function curvature(cx, cy) {
  const N = cx.length, k = new Float64Array(N);
  for (let i = 1; i < N - 1; i++) {
    const ax = cx[i] - cx[i - 1], ay = cy[i] - cy[i - 1], bx = cx[i + 1] - cx[i], by = cy[i + 1] - cy[i];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(ax + bx, ay + by);
    k[i] = 2 * (ax * by - ay * bx) / (la * lb * lc || 1);
  }
  if (N > 1) { k[0] = k[1]; k[N - 1] = k[N - 2]; }
  return k;
}

if (typeof module !== 'undefined') module.exports = { toLocalXY, xyToLatLng, resample, smooth, headingAndNormal, curvature };
