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

/* 平滑化済みの曲率 kap から、コーナー（|κ| が kMin を超える連続区間）を検出する。
   minLen 未満の区間は捨て、同じ向きで間が mergeGap 未満の区間は1つにまとめ（向きが違えば隙間 0 でもまとめない）、
   まとめた後に旋回角が minAng(°) 未満のものを捨てる（ノイズ由来の偽コーナー除け）。
   戻り値: [{no(1始まり), dir('L'|'R'), i0, i1, s0, s1, rMin(区間内の最小旋回半径 m), angDeg(区間の旋回角 °)}] */
function detectCorners(kap, ds, opt) {
  const o = Object.assign({ kMin: 1 / 150, minLen: 8, mergeGap: 15, minAng: 10 }, opt);
  const n = kap.length, cand = [];
  let i = 0;
  while (i < n) {
    if (Math.abs(kap[i]) <= o.kMin) { i++; continue; }
    const i0 = i;
    /* 符号が反転したらそこで区間を切る（L→R が隙間 0 で続いても別のコーナー） */
    const left = kap[i] > 0;
    while (i < n && Math.abs(kap[i]) > o.kMin && (kap[i] > 0) === left) i++;
    const i1 = i - 1;
    if ((i1 - i0 + 1) * ds >= o.minLen) cand.push({ i0, i1, dir: left ? 'L' : 'R' });
  }
  const merged = [];
  for (const c of cand) {
    const prev = merged[merged.length - 1];
    if (prev && prev.dir === c.dir && (c.i0 - prev.i1) * ds < o.mergeGap) prev.i1 = c.i1;
    else merged.push({ i0: c.i0, i1: c.i1, dir: c.dir });
  }
  const out = [];
  for (const c of merged) {
    let kMax = 0, ang = 0;
    for (let j = c.i0; j <= c.i1; j++) { const a = Math.abs(kap[j]); if (a > kMax) kMax = a; ang += a * ds; }
    const angDeg = ang * 180 / Math.PI;
    if (angDeg < o.minAng) continue;
    out.push({ no: out.length + 1, dir: c.dir, i0: c.i0, i1: c.i1, s0: c.i0 * ds, s1: c.i1 * ds, rMin: 1 / kMax, angDeg });
  }
  return out;
}

/* 走行できる横位置の範囲（進行方向の右が正）。コース幅 W の端から 1m（車幅の半分ほど）内側まで。
   'full' = 全幅、'lane' = 左半分（中心線まで）。それ以外の mode は 'full' 扱い */
function laneBounds(W, mode) {
  const lo = -(W / 2 - 1);
  return mode === 'lane' ? { bLo: lo, bHi: 0 } : { bLo: lo, bHi: W / 2 - 1 };
}

/* 緯度経度の列から tr（物理計算・ライン生成が使うトラック構造体）を組み立てる。
   全長が 100m 未満 / 5000m 超なら {error:'short'|'long', total} を返す（呼び出し側は tr.error で分岐） */
function buildTrackFromPath(latlngs, opt) {
  const W = opt && opt.W != null ? opt.W : 6.0, mode = opt && opt.mode ? opt.mode : 'full';
  const { xs, ys, origin } = toLocalXY(latlngs);
  const { cx, cy, st } = resample(xs, ys, 1.0);
  const N = cx.length;
  if (N < 2) return { error: 'short', total: 0 };
  const total = st[N - 1];
  if (total < 100) return { error: 'short', total };
  if (total > 5000) return { error: 'long', total };
  const kap = smooth(curvature(cx, cy), 5);
  const { nx, ny } = headingAndNormal(cx, cy);
  const corners = detectCorners(kap, 1.0);
  const { bLo, bHi } = laneBounds(W, mode);
  return { N, ds: 1, cx, cy, nx, ny, st, kap, total, origin, corners, W, bLo, bHi, z: null };
}

if (typeof module !== 'undefined') module.exports = { toLocalXY, xyToLatLng, resample, smooth, headingAndNormal, curvature, detectCorners, laneBounds, buildTrackFromPath };
