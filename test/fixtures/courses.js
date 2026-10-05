/* テスト共有: 合成コース（平面 xy で作って緯度経度に変換する）。track.test.js / lines.test.js が使う */
const { xyToLatLng } = require('../../js/track');

/* 東向きに出発して、直線と円弧をつないだ中心線（平面 xy）を作る。0.5m 刻みで点を打つ。
   steps: ['s', 長さm] / ['L'|'R', 半径m, 角度°]。
   noise>0 なら spacing m 間隔に間引いた各点の xy に、±noise m 以内の決定的な擬似乱数を足す（phase でノイズの位相をずらす） */
function course(steps, noise, spacing, phase) {
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
  const step = Math.round(spacing / h), ph = phase || 0, nx = [], ny = [];
  for (let i = 0; i < xs.length; i += step) {
    nx.push(xs[i] + Math.sin(i * (12.9898 + ph)) * noise);
    ny.push(ys[i] + Math.sin(i * (78.233 + ph) + 1) * noise);
  }
  return { xs: nx, ys: ny };
}
const ORIGIN = { lat: 35.36, lng: 138.73 };
const toLatLngs = (c) => c.xs.map((x, i) => { const p = xyToLatLng(x, c.ys[i], ORIGIN); return [p.lat, p.lng]; });
const SHAPE = [['s', 30], ['L', 30, 90], ['s', 40], ['R', 30, 90], ['s', 30]];

module.exports = { course, ORIGIN, toLatLngs, SHAPE };
