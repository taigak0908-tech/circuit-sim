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
    /* 完全な直線（曲率ほぼ0）でピンも無いと連立方程式が特異になり、解に NaN/Infinity が出る。
       その場合は反復を打ち切り、全点を中央線（n=0）にフォールバックする（直線ではラインの差が無いため） */
    if (!n.every(Number.isFinite)) { n = new Float64Array(N); break; }
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
   内側 = 左コーナーは bLo 側・右コーナーは bHi 側、外側はその反対。params[c] が無いコーナーはピン無し。
   hold の外側ピンは apex の手前 max(8 m, 幅の2倍) で止める（短いコーナーで外→内の横移動が数 m に詰まり、
   ラインが急に折れて型ラインが中央より大幅に遅くなっていた）。止める位置が i0 より前になるなら hold ピンは置かない */
function pinsFromParams(tr, params) {
  const N = tr.N, pins = new Float64Array(N).fill(NaN);
  for (let c = 0; c < tr.corners.length; c++) {
    const p = params && params[c];
    if (!p) continue;
    const k = tr.corners[c], left = k.dir === 'L';
    const inner = (left ? tr.bLo : tr.bHi) * p.inside, outer = left ? tr.bHi : tr.bLo;
    const ia = _phys.clamp(Math.round(k.i0 + p.apex * (k.i1 - k.i0)), 0, N - 1);
    if (p.hold > 0) {
      const gap = Math.round(Math.max(8, 2 * (tr.W || 0)) / tr.ds);
      const iEnd = Math.min(k.i0 + Math.round(p.hold / tr.ds), ia - gap);
      for (let i = Math.max(k.i0, 0); i <= iEnd; i++) pins[i] = outer;   // iEnd < i0（範囲が逆転）なら1つも置かない
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

/* ===== 最速ライン探索（コーナーごとの座標降下） ===== */
const APEX_GRID = [0.30, 0.40, 0.50, 0.55, 0.60, 0.70, 0.80];
const INSIDE_GRID = [1.0, 0.7, 0.4];
const HOLD_GRID = [0, 10, 20];
const SEARCH_PASSES = 2;
const WINDOW_EXT = 50;   // m。局所窓を前後のコーナーの外へ広げる距離

/* params で区間全体を解いて走らせる。{n, v, time}（局所窓の端の値と、比較の基準に使う） */
function fullEval(tr, car, vEntry, params) {
  const line = lineCustom(tr, params), sim = _phys.simulate(tr, line, car, vEntry);
  return { n: line.n, v: sim.v, time: sim.time };
}

/* tr の点 a..b だけを取り出した tr（配列は subarray で共有。st は窓の先頭を 0 に平行移動）。
   solveLineN / finishLineN / simulate が使う値だけを持つ。ピンは区間全体の pinsFromParams を切り出して渡すので corners は要らない */
function subTrack(tr, a, b) {
  const N = b - a + 1, st = new Float64Array(N);
  for (let i = 0; i < N; i++) st[i] = tr.st[a + i] - tr.st[a];
  return { N, ds: tr.ds, cx: tr.cx.subarray(a, b + 1), cy: tr.cy.subarray(a, b + 1), nx: tr.nx.subarray(a, b + 1), ny: tr.ny.subarray(a, b + 1),
    kap: tr.kap ? tr.kap.subarray(a, b + 1) : null, st, total: st[N - 1], W: tr.W, bLo: tr.bLo, bHi: tr.bHi, corners: [] };
}

/* コーナー c の候補を「局所窓」で評価する関数を返す（trial の params → 窓のタイム）。
   窓 = 前のコーナー c-1 の i0（無ければ 0）〜 次のコーナー c+1 の i1（無ければ N-1）を前後に WINDOW_EXT m 広げた [a, b]。
   窓の両端 3 点は現在の全体解 cur の n にピンし（区間の端そのものなら全体と同じく自由）、
   進入速度は cur の v[a]（区間の先頭なら vEntry）。区間全体を解くより窓が短いぶん速い */
function windowEvaluator(tr, car, vEntry, c, cur) {
  const K = tr.corners, ext = Math.round(WINDOW_EXT / tr.ds);
  const a = Math.max(0, (c > 0 ? K[c - 1].i0 : 0) - ext);
  const b = Math.min(tr.N - 1, (c < K.length - 1 ? K[c + 1].i1 : tr.N - 1) + ext);
  const w = subTrack(tr, a, b), vIn = a === 0 ? vEntry : cur.v[a];
  return trial => {
    const pins = pinsFromParams(tr, trial).slice(a, b + 1);
    for (let k = 0; k < 3; k++) {
      if (a > 0) pins[k] = cur.n[a + k];
      if (b < tr.N - 1) pins[w.N - 1 - k] = cur.n[b - k];
    }
    return _phys.simulate(w, solveLineN(w, pins), car, vIn).time;
  };
}

/* コーナー c だけを格子（7×3×3=63通り）で試し、タイムが最短の {param, time} を返す。
   cur（現在の全体解 {n, v, time}）を渡すと局所窓で評価し、time は窓のタイム。null なら区間全体で評価し、time は区間タイム。
   まず「現在の params[c]」をそのまま評価して基準にし、格子の候補は基準より厳密に速い（1e-9 超）ときだけ採用する。
   理由: 初期値（late の apex=0.65 など）は格子に含まれないので、基準に入れないと
   「探索した結果が初期値より遅くなる」ことがある。同タイムなら先に見つけた方（現在値 → 格子順）を残す。
   候補を1つ評価するたびに yield するジェネレータ（戻り値が結果）。非同期版はこの yield のところで時間を見て画面に制御を返す */
function* bestForCornerGen(tr, car, vEntry, params, c, cur) {
  const timeOf = cur ? windowEvaluator(tr, car, vEntry, c, cur) : trial => runLineN(tr, car, vEntry, lineCustom(tr, trial)).sim.time;
  let best = { param: params[c], time: timeOf(params) };
  yield;
  for (const apex of APEX_GRID) for (const inside of INSIDE_GRID) for (const hold of HOLD_GRID) {
    const trial = params.slice();
    trial[c] = { apex, inside, hold };
    const time = timeOf(trial);
    if (time < best.time - 1e-9) best = { param: trial[c], time };
    yield;
  }
  return best;
}
function bestForCorner(tr, car, vEntry, params, c, cur) {
  const g = bestForCornerGen(tr, car, vEntry, params, c, cur);
  let r;
  while (!(r = g.next()).done);
  return r.value;
}

/* 探索の状態 {params, cur, time, windowed}。defaultParams(late) から始める。windowed は opts.windowed（既定 true） */
function searchInit(tr, car, vEntry, opts) {
  const params = defaultParams(tr, 'late'), cur = fullEval(tr, car, vEntry, params);
  return { params, cur, time: cur.time, windowed: !(opts && opts.windowed === false) };
}
/* コーナー c を1つ処理する（評価ごとに yield）。局所窓のときは、採用した params[c] で区間全体を解き直して cur を更新する
   （各コーナーの最後に1回）。窓では速くても全体で遅くなった場合は元の値に戻す（各コーナー処理後のタイムは増えない） */
function* searchStepGen(st, tr, car, vEntry, c) {
  const g = bestForCornerGen(tr, car, vEntry, st.params, c, st.windowed ? st.cur : null);
  let r;
  while (!(r = g.next()).done) yield;
  const prev = st.params[c];
  if (!st.windowed) { st.params[c] = r.value.param; st.time = r.value.time; return; }
  if (r.value.param === prev) return;
  const trial = st.params.slice(); trial[c] = r.value.param;
  const nx = fullEval(tr, car, vEntry, trial);
  if (nx.time <= st.cur.time + 1e-9) { st.params[c] = r.value.param; st.cur = nx; st.time = nx.time; }
}

/* 同期版。コーナー順に他を固定して格子を総当たりし、これを2周する。{params, time}（time は区間全体のタイム）。
   opts.windowed=false で候補を区間全体で評価する（旧来の方法。テストで局所窓と比べる） */
function searchFastestSync(tr, car, vEntry, opts) {
  const st = searchInit(tr, car, vEntry, opts), C = tr.corners.length;
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (let c = 0; c < C; c++) {
      const g = searchStepGen(st, tr, car, vEntry, c);
      while (!g.next().done);
    }
  }
  return { params: st.params, time: st.time };
}

const SLICE_MS = 20;   // 非同期版が画面に制御を返す間隔（ms）。1 評価は最長でも十数 ms

/* 非同期版。同じ探索を、SLICE_MS ごとに画面へ制御を返しながら進める（結果は同期版と同じ）。
   opts = {onProgress(done,total), signal, sliceMs, windowed}。onProgress はコーナー1つ分ごと。sliceMs は制御を返す間隔（既定 SLICE_MS。テストでは 0 にして毎評価ごとに返す）。
   各コーナー処理の前と制御を返した直後に signal.aborted を見て、立っていれば {aborted:true} を返す */
async function searchFastest(tr, car, vEntry, opts) {
  const { onProgress, signal, sliceMs = SLICE_MS } = opts || {};
  const C = tr.corners.length;
  if (C === 0) return searchFastestSync(tr, car, vEntry, opts);
  const total = SEARCH_PASSES * C;
  const st = searchInit(tr, car, vEntry, opts);
  let done = 0;
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (let c = 0; c < C; c++) {
      if (signal && signal.aborted) return { aborted: true };
      const g = searchStepGen(st, tr, car, vEntry, c);
      let t0 = Date.now();
      while (!g.next().done) {
        if (Date.now() - t0 >= sliceMs) {
          await new Promise(res => setTimeout(res, 0));
          if (signal && signal.aborted) return { aborted: true };
          t0 = Date.now();
        }
      }
      done++;
      if (onProgress) onProgress(done, total);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  return { params: st.params, time: st.time };
}

if (typeof module !== 'undefined') module.exports = { solveLineN, finishLineN, centerLine, lineOIO, runLineN, pinsFromParams, defaultParams, lineLate, lineInside, lineCustom, cornerStats, searchFastest, searchFastestSync };
