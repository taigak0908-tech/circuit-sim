/* ===== 走行ライン（DOM非依存・ブラウザではグローバル関数、Node では module.exports） =====
   n は進行方向の右が正。範囲は tr.bLo..tr.bHi（非対称でよい）。physics.js を先に読み込むこと */
const _phys = typeof module !== 'undefined' ? require('./physics') : { clamp, solvePenta, simulate };

/* 指定点（ピン）を通り、走行範囲の中で曲率が最小になる横位置 n(s) を解く。
   pins: Float64Array(N)。自由点は NaN。範囲外のピン値は範囲に丸める。
   目的関数 = 中心線＋法線オフセットで作る位置の2階差分（曲率の近似）の二乗和。
   ピンは重み Wp のペナルティ、範囲外に出た点は活性集合に入れて境界値に固定する */
function solveLineN(tr, pins) {
  const N = tr.N, bLo = tr.bLo, bHi = tr.bHi;
  const h0 = new Float64Array(N), h1 = new Float64Array(N), h2 = new Float64Array(N), g = new Float64Array(N);
  for (let i = 1; i < N - 1; i++) {
    const ccx = tr.cx[i - 1] - 2 * tr.cx[i] + tr.cx[i + 1], ccy = tr.cy[i - 1] - 2 * tr.cy[i] + tr.cy[i + 1];
    const ux = tr.nx[i - 1], uy = tr.ny[i - 1], vx = -2 * tr.nx[i], vy = -2 * tr.ny[i], wx = tr.nx[i + 1], wy = tr.ny[i + 1];
    h0[i - 1] += ux * ux + uy * uy; h0[i] += vx * vx + vy * vy; h0[i + 1] += wx * wx + wy * wy;
    h1[i - 1] += ux * vx + uy * vy; h1[i] += vx * wx + vy * wy; h2[i - 1] += ux * wx + uy * wy;
    g[i - 1] += ux * ccx + uy * ccy; g[i] += vx * ccx + vy * ccy; g[i + 1] += wx * ccx + wy * ccy;
  }
  const pin = new Float64Array(N);
  for (let i = 0; i < N; i++) pin[i] = pins && !isNaN(pins[i]) ? _phys.clamp(pins[i], bLo, bHi) : NaN;
  const act = new Int8Array(N), Wp = 1e5;
  let n = new Float64Array(N);
  for (let it = 0; it < 40; it++) {
    const d0 = Float64Array.from(h0), rhs = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      rhs[i] = -g[i];
      if (!isNaN(pin[i])) { d0[i] += Wp; rhs[i] += Wp * pin[i]; }
      else if (act[i]) { d0[i] += Wp; rhs[i] += Wp * (act[i] > 0 ? bHi : bLo); }
    }
    n = _phys.solvePenta(d0, h1, h2, rhs);
    let changed = false;
    for (let i = 0; i < N; i++) {
      if (!isNaN(pin[i])) continue;
      if (!act[i]) {
        if (n[i] > bHi + 1e-3) { act[i] = 1; changed = true; }
        else if (n[i] < bLo - 1e-3) { act[i] = -1; changed = true; }
      } else if (it < 28) {
        /* 勾配の向きが壁から離れる側なら活性解除（28回以降は振動防止のため解除しない） */
        let r = h0[i] * n[i] + g[i];
        if (i > 0) r += h1[i - 1] * n[i - 1];
        if (i > 1) r += h2[i - 2] * n[i - 2];
        if (i < N - 1) r += h1[i] * n[i + 1];
        if (i < N - 2) r += h2[i] * n[i + 2];
        if (act[i] * r > 1e-9) { act[i] = 0; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < N; i++) n[i] = _phys.clamp(n[i], bLo, bHi);
  return finishLineN(tr, n);
}

/* 横位置 n から、物理計算に渡すライン {n, px, py, seg, dist, kap, length} を作る。
   曲率は3点円の式を ±2 点の重み付き平滑化 */
function finishLineN(tr, n) {
  const N = tr.N, px = new Float64Array(N), py = new Float64Array(N), seg = new Float64Array(N), dist = new Float64Array(N);
  for (let i = 0; i < N; i++) { px[i] = tr.cx[i] + n[i] * tr.nx[i]; py[i] = tr.cy[i] + n[i] * tr.ny[i]; }
  for (let i = 0; i < N - 1; i++) { seg[i] = Math.hypot(px[i + 1] - px[i], py[i + 1] - py[i]); dist[i + 1] = dist[i] + seg[i]; }
  seg[N - 1] = seg[N - 2];
  const k = new Float64Array(N);
  for (let i = 1; i < N - 1; i++) {
    const ax = px[i] - px[i - 1], ay = py[i] - py[i - 1], bx = px[i + 1] - px[i], by = py[i + 1] - py[i];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(ax + bx, ay + by);
    k[i] = 2 * (ax * by - ay * bx) / (la * lb * lc || 1);
  }
  k[0] = k[1]; k[N - 1] = k[N - 2];
  const ks = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0, w = 0;
    for (let j = -2; j <= 2; j++) { const q = i + j; if (q >= 0 && q < N) { const ww = 3 - Math.abs(j); s += k[q] * ww; w += ww; } }
    ks[i] = s / w;
  }
  return { n, px, py, seg, dist, kap: ks, length: dist[N - 1] };
}

/* 中央ライン（n=0 のまま走る） */
function centerLine(tr) { return finishLineN(tr, new Float64Array(tr.N)); }

/* 全アウト・イン・アウト（ピン無しで曲率最小の線） */
function lineOIO(tr) { return solveLineN(tr, new Float64Array(tr.N).fill(NaN)); }

/* ラインを走らせる */
function runLineN(tr, car, vEntry, line) { return { line, sim: _phys.simulate(tr, line, car, vEntry) }; }

/* コーナーごとのパラメータからピン配列を作る。
   params[c] = {apex:0..1（コーナー内の位置）, inside:0..1（内側への寄せ具合）, hold: m（入口で外側に居続ける距離）}
   内側 = 左コーナーは bLo 側・右コーナーは bHi 側、外側はその反対。params[c] が無いコーナーはピン無し */
function pinsFromParams(tr, params) {
  const N = tr.N, pins = new Float64Array(N).fill(NaN);
  for (let c = 0; c < tr.corners.length; c++) {
    const p = params && params[c];
    if (!p) continue;
    const k = tr.corners[c], left = k.dir === 'L';
    const inner = (left ? tr.bLo : tr.bHi) * p.inside, outer = left ? tr.bHi : tr.bLo;
    const ia = _phys.clamp(Math.round(k.i0 + p.apex * (k.i1 - k.i0)), 0, N - 1);
    if (p.hold > 0) {
      const iEnd = Math.min(k.i0 + Math.round(p.hold / tr.ds), ia - 2);
      for (let i = Math.max(k.i0, 0); i <= iEnd; i++) pins[i] = outer;
    }
    pins[ia] = inner;
  }
  return pins;
}

/* 型ラインの既定パラメータ。今は 'late'（レイトエイペックス）のみ。
   他の kind は将来の拡張点で、今は late と同じものを返す */
function defaultParams(tr, kind) {
  return tr.corners.map(() => ({ apex: 0.65, inside: 1, hold: 10 }));
}

/* 全コーナーをレイトエイペックスで走るライン */
function lineLate(tr) { return solveLineN(tr, pinsFromParams(tr, defaultParams(tr, 'late'))); }

/* 全コーナーの i0..i1 を内側いっぱいに通るライン（インベタ）。コーナー間は曲率最小でつなぐ */
function lineInside(tr) {
  const pins = new Float64Array(tr.N).fill(NaN);
  for (const k of tr.corners) {
    const inner = k.dir === 'L' ? tr.bLo : tr.bHi;
    for (let i = k.i0; i <= k.i1; i++) pins[i] = inner;
  }
  return solveLineN(tr, pins);
}

/* 自分で指定したパラメータで作るライン */
function lineCustom(tr, params) { return solveLineN(tr, pinsFromParams(tr, params)); }

/* コーナーごとの最低速度（m/s）と通過タイム（s）。km/h 換算は画面側 */
function cornerStats(tr, sim) {
  return tr.corners.map(k => {
    let vMin = Infinity;
    for (let i = k.i0; i <= k.i1; i++) if (sim.v[i] < vMin) vMin = sim.v[i];
    return { vMin, tCorner: sim.t[k.i1] - sim.t[k.i0] };
  });
}

if (typeof module !== 'undefined') module.exports = { solveLineN, finishLineN, centerLine, lineOIO, runLineN, pinsFromParams, defaultParams, lineLate, lineInside, lineCustom, cornerStats };
