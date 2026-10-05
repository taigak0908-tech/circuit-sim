/* ===== 物理計算（DOM非依存・ブラウザではグローバル関数、Node では module.exports） ===== */
const G = 9.81, RHO = 1.2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* 対称5重対角の連立方程式 */
function solvePenta(d0, d1, d2, rhs) {
  const n = d0.length;
  const c = Float64Array.from(d0), d = Float64Array.from(d1), e = Float64Array.from(d2), x = Float64Array.from(rhs);
  const b = new Float64Array(n), a = new Float64Array(n);
  for (let i = 1; i < n; i++) b[i] = d1[i - 1];
  for (let i = 2; i < n; i++) a[i] = d2[i - 2];
  for (let i = 0; i < n - 1; i++) {
    let m = b[i + 1] / c[i];
    c[i + 1] -= m * d[i]; x[i + 1] -= m * x[i];
    if (i + 2 < n) {
      d[i + 1] -= m * e[i];
      m = a[i + 2] / c[i];
      b[i + 2] -= m * d[i]; c[i + 2] -= m * e[i]; x[i + 2] -= m * x[i];
    }
  }
  x[n - 1] /= c[n - 1];
  x[n - 2] = (x[n - 2] - d[n - 2] * x[n - 1]) / c[n - 2];
  for (let i = n - 3; i >= 0; i--) x[i] = (x[i] - d[i] * x[i + 1] - e[i] * x[i + 2]) / c[i];
  return x;
}

/* 車両 */
function deriveCar(p) {
  const m = p.mass, eff = 0.78;
  return { m, wf: p.wf / 100, h: p.h, L: p.L, tf: p.tf, tr: p.tr, mu: p.mu, ks: 0.15, rs: p.rs / 100,
    Peff: p.ps * 735.5 * eff, CdA: p.cda, ClA: p.cla, aeroF: 0.45, drive: p.drive, Fz0: m * G / 4,
    rollGrad: p.rollGrad, pitchGrad: p.pitchGrad };
}
function wheelLoads(car, v, ax, ay) {
  const down = 0.5 * RHO * car.ClA * v * v, lt = car.m * ax * car.h / car.L;
  let Ff = car.m * G * car.wf - lt + down * car.aeroF, Fr = car.m * G * (1 - car.wf) + lt + down * (1 - car.aeroF);
  if (Ff < 0) { Fr += Ff; Ff = 0; } if (Fr < 0) { Ff += Fr; Fr = 0; }
  const M = car.m * ay * car.h;
  const dF = clamp(M * car.rs / car.tf, -Ff / 2, Ff / 2), dR = clamp(M * (1 - car.rs) / car.tr, -Fr / 2, Fr / 2);
  return [Ff / 2 - dF, Ff / 2 + dF, Fr / 2 - dR, Fr / 2 + dR]; /* 左前, 右前, 左後, 右後 */
}
function tireCap(car, F) { return car.mu * F * Math.max(0.6, 1 + car.ks - car.ks * F / car.Fz0); }
function dragForce(car, v) { return 0.5 * RHO * car.CdA * v * v + 0.015 * car.m * G; }

/* タイヤの使用状況。ok=グリップ内に収まる */
function tireState(car, v, ax, ay) {
  const Fz = wheelLoads(car, v, ax, ay);
  const capF = tireCap(car, Fz[0]) + tireCap(car, Fz[1]), capR = tireCap(car, Fz[2]) + tireCap(car, Fz[3]);
  const Fx = car.m * ax + dragForce(car, v), FyF = car.m * Math.abs(ay) * car.wf, FyR = car.m * Math.abs(ay) * (1 - car.wf);
  let FxF, FxR, ok;
  if (Fx > 0 && car.drive === 'FR') { FxF = 0; FxR = Fx; }
  else if (Fx > 0 && car.drive === 'FF') { FxF = Fx; FxR = 0; }
  else {
    const remF = Math.sqrt(Math.max(capF * capF - FyF * FyF, 0)), remR = Math.sqrt(Math.max(capR * capR - FyR * FyR, 0));
    const sum = remF + remR;
    FxF = sum > 0 ? Fx * remF / sum : Fx / 2; FxR = Fx - FxF;
  }
  const uF = Math.hypot(FxF, FyF) / Math.max(capF, 1), uR = Math.hypot(FxR, FyR) / Math.max(capR, 1);
  ok = uF <= 1.0001 && uR <= 1.0001;
  return { Fz, uF, uR, ok };
}
function axMax(car, v, ay) {
  const drag = dragForce(car, v), aE = (car.Peff / Math.max(v, 15) - drag) / car.m;
  if (tireState(car, v, aE, ay).ok) return aE;
  let lo = -drag / car.m, hi = aE;
  if (!tireState(car, v, lo, ay).ok) return lo;
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (tireState(car, v, mid, ay).ok) lo = mid; else hi = mid; }
  return lo;
}
function axMin(car, v, ay) {
  let hi = -dragForce(car, v) / car.m, lo = -3 * G;
  if (!tireState(car, v, hi, ay).ok) return hi;
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (tireState(car, v, mid, ay).ok) hi = mid; else lo = mid; }
  return hi;
}
function vLimit(car, kap) {
  const k = Math.abs(kap); if (k < 1e-5) return 95;
  let lo = 3, hi = 95;
  if (tireState(car, hi, 0, hi * hi * k).ok) return hi;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (tireState(car, mid, 0, mid * mid * k).ok) lo = mid; else hi = mid; }
  return lo;
}

/* 準定常の速度プロファイル: 限界速度 → 加速側 → 減速側 */
function simulate(tr, line, car, vEntry) {
  const N = tr.N, vl = new Float64Array(N), v = new Float64Array(N);
  for (let i = 0; i < N; i++) vl[i] = vLimit(car, line.kap[i]);
  v[0] = Math.min(vEntry, vl[0]);
  for (let i = 0; i < N - 1; i++) {
    const a = axMax(car, v[i], v[i] * v[i] * line.kap[i]);
    v[i + 1] = Math.min(Math.sqrt(Math.max(v[i] * v[i] + 2 * a * line.seg[i], 9)), vl[i + 1]);
  }
  for (let i = N - 1; i > 0; i--) {
    const a = axMin(car, v[i], v[i] * v[i] * line.kap[i]);
    const vb = Math.sqrt(v[i] * v[i] - 2 * a * line.seg[i - 1]);
    if (vb < v[i - 1]) v[i - 1] = vb;
  }
  const ax = new Float64Array(N), ay = new Float64Array(N), t = new Float64Array(N);
  for (let i = 0; i < N - 1; i++) {
    ax[i] = (v[i + 1] * v[i + 1] - v[i] * v[i]) / (2 * line.seg[i]);
    t[i + 1] = t[i] + line.seg[i] / ((v[i] + v[i + 1]) / 2);
  }
  ax[N - 1] = ax[N - 2];
  for (let i = 0; i < N; i++) ay[i] = v[i] * v[i] * line.kap[i];
  let iMin = 0; for (let i = 1; i < N; i++) if (v[i] < v[iMin]) iMin = i;
  let iBrake = -1; for (let i = 0; i < iMin; i++) if (ax[i] < -0.3 * G) { iBrake = i; break; }
  let ayMax = 0; for (let i = 0; i < N; i++) ayMax = Math.max(ayMax, Math.abs(ay[i]));
  const res = { v, ax, ay, t, time: t[N - 1], iMin, vMin: v[iMin], vEnd: v[N - 1], iBrake, ayMax };
  /* コーナー区間（iA/iB）を持つコースだけ、区間ごとの値を足す */
  if (tr.iA != null) Object.assign(res, { vExit: v[tr.iB], tIn: t[tr.iA], tCorner: t[tr.iB] - t[tr.iA], tOut: t[N - 1] - t[tr.iB] });
  return res;
}

if (typeof module !== 'undefined') module.exports = { G, RHO, clamp, solvePenta, deriveCar, wheelLoads, tireCap, dragForce, tireState, axMax, axMin, vLimit, simulate };
