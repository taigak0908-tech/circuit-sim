/* ===== 区間モードの画面配線（状態機械・地図クリック・経路取得 → tr 構築 → 6本のライン計算 → 判定・表・グラフ・地図の線） =====
   HTML/SVG の組み立ては section-render.js（SectionRender）。ここは状態・DOM への反映・イベント。
   最速ラインは lines.js の searchFastest を条件が変わるたびに自動で走らせる（非同期・中断つき）。
   自分のラインはコーナーごとのスライダーで調整し、位置スクラブで地図の車・グラフの縦線・G-G図・荷重カードが連動する。 */
(function () {
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const SR = SectionRender;

  /* 車種プリセット（index.html の IIFE 内 CAR_PRESETS をコピー。数値を変えるときは両方そろえる） */
  const CAR_PRESETS = {
    grb: { label: 'スバル インプレッサ WRX STI (GRB)', v: { mass: 1550, ps: 308, mu: 1.10, wf: 59, h: 0.50, rs: 56, L: 2.625, tf: 1.530, tr: 1.540, cda: 0.78, cla: 0.10, rollGrad: 3.2, pitchGrad: 1.6, drive: 'AWD' } },
    gr86: { label: 'トヨタ GR86 (ZN8)', v: { mass: 1340, ps: 235, mu: 1.10, wf: 54, h: 0.46, rs: 55, L: 2.575, tf: 1.520, tr: 1.550, cda: 0.60, cla: 0.05, rollGrad: 3.0, pitchGrad: 1.5, drive: 'FR' } },
    nd: { label: 'マツダ ロードスター (ND 1.5)', v: { mass: 1080, ps: 132, mu: 1.10, wf: 50, h: 0.45, rs: 55, L: 2.310, tf: 1.495, tr: 1.505, cda: 0.64, cla: 0.00, rollGrad: 4.0, pitchGrad: 2.0, drive: 'FR' } },
    fl5: { label: 'ホンダ シビック TYPE R (FL5)', v: { mass: 1500, ps: 330, mu: 1.10, wf: 62, h: 0.50, rs: 50, L: 2.735, tf: 1.625, tr: 1.615, cda: 0.74, cla: 0.20, rollGrad: 2.6, pitchGrad: 1.4, drive: 'FF' } },
    gry: { label: 'トヨタ GRヤリス (RZ)', v: { mass: 1350, ps: 272, mu: 1.10, wf: 59, h: 0.50, rs: 56, L: 2.560, tf: 1.535, tr: 1.565, cda: 0.73, cla: 0.10, rollGrad: 3.0, pitchGrad: 1.6, drive: 'AWD' } }
  };
  const MAX_VIAS = 5;
  const FAST_DELAY = 250;   // ms。条件が動き続けている間（スライダーのドラッグ中など）は最速探索を始めない
  const HINTS = {
    start: '地図をクリックして始点を置きます',
    end: '地図をクリックして終点を置きます',
    via: '地図をクリックして経由点を置きます',
    manual: '道に沿って地図を順にクリックします（2点以上で線を引きます）',
    measure: '航空写真の上で、道の左端と右端を順にクリックします'
  };
  const HINT_IDLE = 'ボタンで点の種類を選び、地図をクリックします';

  /* 状態。mode は null | 'start' | 'end' | 'via' | 'manual' | 'measure' */
  const S = {
    mode: null,
    points: { start: null, end: null, vias: [] },
    manualPts: [],       // 手動モードの点列
    manual: false,       // いま手動モードの点を使っているか
    latlngs: null, tr: null,
    trFrom: null,        // S.tr を作ったときの S.latlngs（同じ配列なら経路は変わっていない）
    W: 6, laneMode: 'full', vIn: 60,
    wTouched: false,     // 幅を自分で決めたか（スライダー・計測・保存の読み込み）。false の間だけ OSM タグの幅を初期値に使う
    measureP: null,      // 幅の計測の1点目
    preset: 'grb', carP: Object.assign({}, CAR_PRESETS.grb.v), car: null,   // carP = 車のパラメータ、car = deriveCar の結果
    params: [],          // 自分のライン（コーナーごと {apex,inside,hold}）。tr ができるたび既定値に戻す
    paramsEdited: false, // スライダーを触ったか。触っていなければ最速の探索が終わったとき自分のラインも最速に揃える
    fast: null,          // 最速探索 {tr, car, vIn, ac(AbortController), timer, t0, params, res}。res は完了後の {line, sim, stats}
    fastError: false,    // 最速探索の失敗メッセージを出している間 true（次に成功したら消す）
    computeError: false, // compute の失敗メッセージを出している間 true（成功したら消す）
    sel: 'fast',         // 選択中の系列（地図で太く・表で強調）
    selCorner: -1,       // 表で選んだコーナーの添字
    scrub: 0,            // 位置（点の添字）
    playing: false,
    results: null,       // {[系列id]: {line, sim, stats}}
    visible: new Set(['center', 'my', 'fast']),   // 表示中の系列
    failCount: 0,
    seq: 0,              // 経路取得の通し番号（古い応答を捨てる）
    pendingRestore: null // 保存区間の復元待ち {params, paramsEdited, total}。区間ができたとき（再試行で後からできても）当てて消す
  };

  if (typeof L === 'undefined') {
    const m = $('msg'); m.hidden = false; m.textContent = '地図ライブラリ(Leaflet)を読み込めませんでした。ネットワークを確認して再読み込みしてください。';
    return;
  }
  S.car = deriveCar(S.carP);
  const api = createMap('map');

  /* ---------- メッセージ欄 ---------- */
  function showMsg(text, opt) {
    const el = $('msg');
    el.textContent = '';
    if (!text) { el.hidden = true; return; }
    el.className = 'msg' + (opt && opt.info ? ' info' : '');
    const sp = document.createElement('span'); sp.textContent = text; el.appendChild(sp);
    if (opt && opt.retry) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.id = 'btn-retry'; b.textContent = '再試行';
      b.addEventListener('click', rebuildRoute);
      el.appendChild(b);
    }
    el.hidden = false;
  }

  /* ---------- モード切替・ボタン表示 ---------- */
  const MODE_BTN = { start: 'btn-start', end: 'btn-end', via: 'btn-via', manual: 'btn-manual', measure: 'btn-measure' };
  function setMode(m) {
    const prev = S.mode;
    S.mode = m; S.measureP = null; api.measureLine(null);   // 計測の途中の点は、モードを変えたら捨てる
    if (m === 'measure') { setBase('aerial'); showMsg('道の左端と右端をクリックしてください', { info: true }); }
    else if (prev === 'measure') showMsg(null);
    Object.keys(MODE_BTN).forEach(k => $(MODE_BTN[k]).setAttribute('aria-pressed', String(k === m)));
    $('map-hint').textContent = m ? HINTS[m] : HINT_IDLE;
    api.map.getContainer().style.cursor = m ? 'crosshair' : '';
    updateManualBtn();
  }
  function updateManualBtn() { $('btn-manual').disabled = !(S.failCount >= 3 || S.mode === 'manual'); }
  function toggleMode(m) { setMode(S.mode === m ? null : m); }

  /* ---------- 地図の描画更新 ---------- */
  function updateMarkers() {
    if (S.manual) {
      const p = S.manualPts, n = p.length;
      api.setMarkers({ start: p[0] || null, end: n > 1 ? p[n - 1] : null, vias: p.slice(1, -1) });
    } else {
      api.setMarkers({ start: S.points.start, end: S.points.end, vias: S.points.vias });
    }
  }
  function clearRouteView() {
    S.latlngs = null; S.tr = null; S.results = null;
    stopFast(); stopPlay(); S.scrub = 0; syncMyUI(true);
    api.setRoute(null); api.drawCorners([], null);
    renderAll();   // 結果が無いので判定・表・グラフ・地図の線を片付ける
    $('sec-info').textContent = '区間は未設定です';
  }

  /* ---------- 最速探索（searchFastest）の管理 ---------- */
  /* いまの条件（区間・車・進入速度）と同じ条件で始めた探索（探索中か完了済み）を返す。無ければ null */
  function fastCurrent() { const f = S.fast; return f && f.tr === S.tr && f.car === S.car && f.vIn === S.vIn ? f : null; }
  const fastRunning = () => { const f = fastCurrent(); return !!(f && !f.res); };
  function cancelFast(f) { clearTimeout(f.timer); f.ac.abort(); }
  function stopFast() { if (S.fast) cancelFast(S.fast); S.fast = null; showProgress(null); }
  /* 進捗の表示。done == null で非表示（完了・中止）。コーナー0個は探索が一瞬なので出さない */
  function showProgress(done, total) {
    const bar = $('fast-progress'), st = $('fast-status'), f = S.fast;
    if (done == null) {
      bar.hidden = true;
      st.textContent = f && f.res ? '最速を探索しました（' + ((f.t1 - f.t0) / 1000).toFixed(1) + ' 秒）' : '';
      return;
    }
    if (!total) { bar.hidden = true; st.textContent = ''; return; }
    bar.hidden = false; bar.max = total; bar.value = done;
    st.textContent = '最速を探索中… ' + done + ' / ' + total;
  }
  function startFast() {
    const tr = S.tr;
    if (S.fast) cancelFast(S.fast);
    const f = S.fast = { tr, car: S.car, vIn: S.vIn, ac: new AbortController(), timer: 0, t0: performance.now(), t1: 0, params: null, res: null };
    showProgress(0, 2 * tr.corners.length);
    syncMyUI();   // 最速の params が決まるまで「最速に戻す」を無効にする
    f.timer = setTimeout(() => {
      searchFastest(f.tr, f.car, f.vIn / 3.6, { signal: f.ac.signal, onProgress: (d, t) => { if (S.fast === f) showProgress(d, t); } })
        .then(r => { if (!r.aborted && fastCurrent() === f) finishFast(f, r); })
        .catch(e => { if (S.fast === f) { showProgress(null); S.fastError = true; showMsg('最速の探索に失敗しました（' + e.message + '）'); } });
    }, FAST_DELAY);
  }
  function finishFast(f, r) {
    const tr = f.tr;
    const run = runLineN(tr, f.car, f.vIn / 3.6, tr.corners.length ? lineCustom(tr, r.params) : centerLine(tr));
    f.params = r.params; f.t1 = performance.now();
    f.res = { line: run.line, sim: run.sim, stats: cornerStats(tr, run.sim) };
    showProgress(null);
    if (S.fastError) { S.fastError = false; showMsg(null); }   // 失敗メッセージは成功したら消す
    if (S.results) S.results.fast = f.res;
    if (!S.paramsEdited) {   // 自分のラインを触っていなければ最速に揃える
      S.params = r.params.map(p => Object.assign({}, p));
      if (S.results) S.results.my = f.res;
    }
    syncMyUI(); renderAll();
  }

  /* ---------- 計算（tr → 6本のライン） ---------- */
  function compute() {
    const tr = S.tr;
    if (!tr || tr.error) { stopFast(); S.results = null; return; }
    const vE = S.vIn / 3.6, R = {};
    const run = line => { const r = runLineN(tr, S.car, vE, line); return { line: r.line, sim: r.sim, stats: cornerStats(tr, r.sim) }; };
    /* コーナーが無い直線では曲率最小化の方程式が特異になり NaN が出る（lines.js では中央線にフォールバック済み）。
       ラインによる差も無いので、全系列を中央ラインにする */
    const straight = tr.corners.length === 0;
    const pick = make => run(straight ? centerLine(tr) : make());
    R.center = run(centerLine(tr));
    R.oio = pick(() => lineOIO(tr));
    R.late = pick(() => lineLate(tr));
    R.inside = pick(() => lineInside(tr));
    R.my = pick(() => lineCustom(tr, S.params));
    if (!fastCurrent()) startFast();
    const f = fastCurrent();
    R.fast = f && f.res ? f.res : R.my;   // 探索が終わるまでは自分のラインと同じ結果を仮に指す
    S.results = R;
  }

  /* ---------- 描画 ---------- */
  const visibleIds = () => SR.SERIES.map(s => s.id).filter(id => S.visible.has(id));
  /* CSS 変数（var(--s1)）を実色にする。Leaflet は CSS 変数を使えないため。ダークモードでも呼び直せば追従 */
  function cssColor(v) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    return m ? (getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888') : v;
  }
  let speedCtx = null, deltaCtx = null, ggCtx = null;

  function renderVerdict() {
    $('verdict').innerHTML = SR.verdictHtml(SR.verdictInfo(S.results, S.tr));
    if (fastRunning()) {
      const p = document.createElement('p'); p.className = 'sub';
      p.textContent = '最速を探索中です。いまの値は仮のもの（自分のラインと同じ）で、探索が終わると差し替わります。';
      $('verdict').querySelector('.v-text').appendChild(p);
    }
  }
  function renderLegend() {
    const el = $('legend');
    if (!el.firstChild) el.innerHTML = SR.legendHtml();   // 系列は固定なので作るのは一度だけ（フォーカスを保つ）
    el.querySelectorAll('input[data-vis]').forEach(i => { i.checked = S.visible.has(i.dataset.vis); });
    el.querySelectorAll('button[data-sel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sel === S.sel)));
  }
  function renderTable() { $('table').innerHTML = SR.tableHtml(S.tr, S.results, visibleIds(), S.sel, S.selCorner); }
  function renderSpeed() {
    const el = $('speed');
    speedCtx = SR.speedPlot(el.clientWidth || 600, el.clientHeight || 260, S.tr, S.results, visibleIds(), S.sel);
    el.innerHTML = speedCtx.html;
  }
  function renderDelta() {
    const el = $('delta');
    deltaCtx = SR.deltaPlot(el.clientWidth || 600, el.clientHeight || 200, S.tr, S.results, visibleIds(), S.sel);
    el.innerHTML = deltaCtx.html;
  }
  function renderGG() {
    const el = $('gg');
    ggCtx = SR.ggPlot(el.clientWidth || 300, el.clientHeight || 260, S.car, S.results[S.sel].sim, SR.seriesOf(S.sel).color);
    el.innerHTML = ggCtx.html;
    $('ggsub').textContent = SR.seriesOf(S.sel).name + ' のGの使い方（横軸: 横G、縦軸: 前後G）';
  }
  function renderMapLines() {
    api.clearLines();
    const ids = visibleIds();
    if (!ids.length) return;
    const order = ids.filter(id => id !== S.sel).concat(ids.includes(S.sel) ? [S.sel] : []);   // 選択中を最前面に
    api.drawLines(order.map(id => ({
      id, latlngs: trackToLatLngs(S.tr, S.results[id].line.n),
      color: cssColor(SR.seriesOf(id).color), weight: id === S.sel ? 5 : 3
    })));
  }
  function renderAll() {
    const ok = !!(S.tr && S.results);
    ['verdict', 'legend', 'table-card', 'speed-card', 'delta-card', 'scrub-grid'].forEach(id => { $(id).hidden = !ok; });
    $('btn-fast').disabled = !S.tr;
    if (!ok) {
      api.clearLines(); api.setCar(null); stopPlay(); speedCtx = deltaCtx = ggCtx = null;
      ['verdict', 'table', 'speed', 'delta', 'gg', 'state'].forEach(id => { $(id).innerHTML = ''; });
      return;
    }
    renderVerdict(); renderLegend(); renderTable(); renderSpeed(); renderDelta(); renderGG(); renderMapLines();
    $('scrub').max = S.tr.N - 1;
    updateScrub();
  }
  /* 入力が連続しても 1 フレームに 1 回だけ計算・描画する */
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      try {
        compute();
        if (S.computeError) { S.computeError = false; showMsg(null); }   // 失敗メッセージは成功したら消す
      } catch (e) { S.results = null; S.computeError = true; showMsg('ラインの計算に失敗しました（' + e.message + '）'); }
      renderAll();
    });
  }

  /* ---------- 位置スクラブ（地図の車・グラフの縦線・G-G図・荷重カードが連動） ---------- */
  function updateCross(id, c) {
    const ln = $(id + '-x'); if (!c || !ln) return;
    const xp = c.fr.x(S.tr.st[S.scrub]);
    ln.setAttribute('x1', xp); ln.setAttribute('x2', xp);
    c.ids.forEach(sid => { const d = $(id + '-d-' + sid); d.setAttribute('cx', xp); d.setAttribute('cy', c.fr.y(c.val(sid, S.scrub))); });
  }
  function updateScrub() {
    if (!S.tr || !S.results) return;
    const R = S.results[S.sel], i = S.scrub;
    $('scrub').value = i;
    $('pos-text').textContent = SR.posText(S.tr, i);
    updateCross('speed', speedCtx); updateCross('delta', deltaCtx);
    api.setCar(xyToLatLng(R.line.px[i], R.line.py[i], S.tr.origin));
    $('state').innerHTML = SR.stateHtml(S.car, R.sim, i);
    $('statepos').textContent = SR.seriesOf(S.sel).name + ' ／ ' + SR.posText(S.tr, i);
    const dot = $('ggdot');
    if (dot && ggCtx) { const d = SR.ggDot(ggCtx, R.sim, i); dot.setAttribute('cx', d.x); dot.setAttribute('cy', d.y); }
  }
  function setScrub(i) { if (!S.tr) return; S.scrub = SR.clampI(Math.round(i), 0, S.tr.N - 1); updateScrub(); }

  /* 再生: 1 フレームに v[i]*dt だけ進む（dt は実際の経過秒。長い停止は 0.1 秒に丸める）。line.seg[i] を跨いだら i を進める。終端で止まる */
  let raf = 0;
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false; cancelAnimationFrame(raf);
    $('play').textContent = '再生'; $('play').setAttribute('aria-pressed', 'false');
  }
  function startPlay() {
    if (!S.tr || !S.results) return;
    if (S.scrub >= S.tr.N - 1) S.scrub = 0;
    S.playing = true; $('play').textContent = '停止'; $('play').setAttribute('aria-pressed', 'true');
    let last = 0, acc = 0;
    const step = ts => {
      if (!S.playing) return;
      if (!S.tr || !S.results) { stopPlay(); return; }
      const dt = last ? Math.min((ts - last) / 1000, 0.1) : 1 / 60; last = ts;
      const R = S.results[S.sel], N = S.tr.N;
      let i = S.scrub; acc += R.sim.v[i] * dt;
      while (i < N - 1 && acc >= R.line.seg[i]) { acc -= R.line.seg[i]; i++; }
      S.scrub = i; updateScrub();
      if (i >= N - 1) { stopPlay(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /* グラフ上の位置にスクラブを合わせ、値のツールチップを出す（速度・タイム差で共通）。再生中はつかんだとき（pointerdown）だけ止めて動かす */
  function bindPlot(id, getCtx, tipFn) {
    const el = $(id);
    const move = e => {
      const c = getCtx(); if (!c || !S.tr || !S.results) return;
      if (S.playing) { if (e.type !== 'pointerdown') return; stopPlay(); }
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) * c.fr.w / (r.width || c.fr.w);
      const xv = c.xd[0] + (px - c.fr.m.l) / (c.fr.w - c.fr.m.l - c.fr.m.r) * (c.xd[1] - c.xd[0]);
      setScrub(xv / S.tr.ds);
      const xp = c.fr.x(S.tr.st[S.scrub]), tip = $(id + '-tip'); if (!tip) return;
      tip.innerHTML = tipFn(S.tr, S.results, c.ids, S.sel, S.scrub); tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(c.fr.w - w - 4, xp + 14 + w > c.fr.w ? xp - w - 14 : xp + 14)) + 'px';
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', () => { const t = $(id + '-tip'); if (t) t.hidden = true; });
  }

  /* ---------- 自分のライン（コーナーごとのスライダー） ---------- */
  /* 選択中のコーナーの値をスライダーに映す。rebuild=true でコーナー一覧も作り直す */
  function syncMyUI(rebuild) {
    const tr = S.tr, sel = $('my-corner'), has = !!(tr && tr.corners.length);
    if (rebuild) {
      sel.innerHTML = has ? tr.corners.map((k, c) => '<option value="' + c + '">' + cornerLabel(k) + '</option>').join('') : '';
      if (has && S.selCorner >= 0 && S.selCorner < tr.corners.length) sel.value = String(S.selCorner);   // 幅を変えても選んでいたコーナーを保つ
    }
    ['my-corner', 'my-apex', 'my-inside', 'my-hold'].forEach(id => { $(id).disabled = !has; });
    const f = fastCurrent();
    $('my-reset').disabled = !(has && f && f.params);
    $('my-hint').textContent = !tr ? '区間を決めると、コーナーごとに調整できます。' : has ? 'コーナーを選んで、エイペックスの位置・内への寄せ・入口で外に居続ける距離を動かします。' : 'この区間にはコーナーがありません。';
    const p = has && S.params[+sel.value];
    if (!p) return;
    $('my-apex').value = Math.round(p.apex * 100); $('my-inside').value = Math.round(p.inside * 100); $('my-hold').value = p.hold;
    $('my-apex-o').textContent = $('my-apex').value; $('my-inside-o').textContent = $('my-inside').value; $('my-hold-o').textContent = $('my-hold').value;
  }
  function onMyInput() {
    const c = +$('my-corner').value; if (!S.params[c]) return;
    S.params[c] = { apex: +$('my-apex').value / 100, inside: +$('my-inside').value / 100, hold: +$('my-hold').value };
    S.paramsEdited = true;
    $('my-apex-o').textContent = $('my-apex').value; $('my-inside-o').textContent = $('my-inside').value; $('my-hold-o').textContent = $('my-hold').value;
    schedule();
  }
  function pickCorner(c) {
    S.selCorner = c; $('my-corner').value = String(c); syncMyUI();
    if (S.tr && S.results) renderTable();
  }

  /* ---------- 経路 → tr → コーナー表示 ---------- */
  /* 新旧の tr でコーナーの並び（個数と各 i0/i1）が同じか */
  function sameCorners(a, b) {
    return !!(a && b && a.corners.length === b.corners.length && a.corners.every((k, c) => k.i0 === b.corners[c].i0 && k.i1 === b.corners[c].i1));
  }
  /* tr だけ作り直す（幅・範囲を変えたときは経路を取り直さない）。fit=true で地図を経路に合わせる。
     経路が同じ（S.latlngs が同じ配列）でコーナーの並びも同じなら、自分のライン・調整済みの印・選んだコーナーを保つ。
     経路が変わったとき（rebuildRoute・手動の線・保存の読み込み）は既定値に戻す */
  function rebuildTrack(fit) {
    if (!S.latlngs) return;
    const tr = buildTrackFromPath(S.latlngs, { W: S.W, mode: S.laneMode });
    if (tr.error) {
      S.tr = null; S.results = null; stopFast(); stopPlay(); S.scrub = 0; syncMyUI(true);
      api.setRoute(null); api.drawCorners([], null); renderAll();
      $('sec-info').textContent = '区間は未設定です';
      showMsg('区間は100m〜5kmにしてください（いま ' + Math.round(tr.total) + ' m）');
      return;
    }
    const keep = S.trFrom === S.latlngs && sameCorners(S.tr, tr);
    S.tr = tr; S.trFrom = S.latlngs; S.results = null;   // 古い tr の結果を参照する隙間を作らない
    if (!keep) { S.params = defaultParams(tr, 'late'); S.paramsEdited = false; S.selCorner = -1; }
    stopPlay(); S.scrub = 0; syncMyUI(true);
    schedule();
    api.setRoute(S.latlngs);
    api.drawCorners(tr.corners, tr);
    if (fit) api.fitRoute();
    const n = tr.corners.length;
    $('sec-info').textContent = '全長 ' + Math.round(tr.total) + ' m・コーナー ' + n + ' 個';
    if (n === 0) showMsg('ほぼ直線です', { info: true }); else showMsg(null);
  }

  /* 経路を取って区間を作り直す。tr ができたら true。保存区間の復元待ち（S.pendingRestore）があれば、成功したときに当てる */
  async function rebuildRoute() {
    const { start, end, vias } = S.points;
    if (!start || !end) return false;
    const seq = ++S.seq;
    showMsg(S.pendingRestore ? '保存した区間を読み込み中…（経路を取得しています）' : '経路を取得中…', { info: true });
    let r;
    try {
      r = await fetchRoute([start, ...vias, end]);
    } catch (e) {
      if (seq !== S.seq) return false;
      S.failCount++; updateManualBtn(); clearRouteView();
      showMsg(e.message === 'noroute'
        ? '道路としてつながっていません。経由点を足すか始点を少しずらしてください'
        : '経路を取れませんでした（' + S.failCount + '回目）', { retry: true });
      return false;
    }
    if (seq !== S.seq) return false;
    S.failCount = 0; updateManualBtn();
    S.latlngs = r.latlngs;
    rebuildTrack(true);   // 地図を経路全体に合わせる
    if (!S.tr) return false;
    applyPendingRestore();
    if (!S.wTouched) applyOsmWidth(seq);
    return true;
  }

  /* 保存区間の復元（openSaved が S.pendingRestore に置いたもの）を、いまの tr に当てて消す。
     自分のラインはコーナー数が同じときだけ戻す（変わっていたら最速に任せる）。全長が 5% 以上違えば知らせる */
  function applyPendingRestore() {
    const p = S.pendingRestore; S.pendingRestore = null;
    if (!p || !S.tr) return;
    if (p.paramsEdited && Array.isArray(p.params) && p.params.length === S.tr.corners.length) {
      S.params = p.params.map(q => Object.assign({}, q)); S.paramsEdited = true; syncMyUI(); schedule();
    }
    const now = S.tr.total;
    if (p.total > 0 && Math.abs(now - p.total) / p.total >= 0.05) showMsg('道路データが変わっています（保存時 ' + Math.round(p.total) + ' m → いま ' + Math.round(now) + ' m）', { info: true });
  }

  /* 幅を m（0.1 刻み・3〜12 に丸め）でスライダーと S.W に入れ、tr を作り直す。実際に入れた値を返す */
  function setWidth(w) {
    const v = Math.min(12, Math.max(3, Math.round(w * 10) / 10));
    S.W = v; $('f-W').value = String(v); $('o-W').textContent = v.toFixed(1);
    rebuildTrack(false);
    return v;
  }
  /* OSM タグの幅を、区間の中点で1回だけ取って初期値にする（自分で幅を決めていたら使わない） */
  async function applyOsmWidth(seq) {
    const tr = S.tr, mid = trackToLatLngs(tr)[tr.N >> 1];
    const w = await fetchOsmWidth(mid.lat, mid.lng);
    /* 取れない・古い応答・幅をもう触った・区間が変わった、に加えて自分のラインを調整済みなら使わない。
       （幅だけ変えても rebuildTrack は自分のラインを保つが、調整した幅の前提が黙って変わらないように使わない） */
    if (w == null || seq !== S.seq || S.wTouched || S.paramsEdited || S.tr !== tr) return;
    const v = setWidth(w);
    showMsg('地図データの幅 ' + v.toFixed(1) + ' m を初期値にしました', { info: true });
  }

  function useManualRoute() {
    ++S.seq;
    S.latlngs = manualRoute(S.manualPts).latlngs;
    rebuildTrack(false);
  }

  function clearAll() {
    ++S.seq; S.pendingRestore = null;
    S.points = { start: null, end: null, vias: [] };
    S.manualPts = []; S.manual = false; S.wTouched = false;
    clearRouteView(); api.setMarkers(null); showMsg(null); setMode(null);
  }

  /* ---------- 地図クリック ---------- */
  api.onMapClick(p => {
    const m = S.mode;
    if (!m) return;
    if (m === 'measure') {
      if (!S.measureP) { S.measureP = p; api.measureLine(p, null); return; }
      const d = api.map.distance(S.measureP, p);
      S.wTouched = true; setMode(null);
      const v = setWidth(d);
      showMsg(Math.abs(v - d) > 0.05 ? '測った幅 ' + d.toFixed(1) + ' m は範囲外のため ' + v.toFixed(1) + ' m にしました' : '幅 ' + v.toFixed(1) + ' m を入れました', { info: true });
      return;
    }
    if (m === 'manual') {
      S.manual = true; S.manualPts.push(p); updateMarkers();
      if (S.manualPts.length >= 2) useManualRoute();
      return;
    }
    if (m === 'via' && S.points.vias.length >= MAX_VIAS) {
      showMsg('経由点は最大 ' + MAX_VIAS + ' 個までです。全消去してやり直すか、点の位置を見直してください', { info: true });
      return;
    }
    if (S.manual) { S.manual = false; clearRouteView(); }   // 手動の線を捨てて通常モードに戻る
    S.pendingRestore = null;   // 点を動かしたら、読み込みに失敗した保存区間の復元はもう当てない
    if (m === 'start') S.points.start = p;
    else if (m === 'end') S.points.end = p;
    else S.points.vias.push(p);
    setMode(null);
    updateMarkers();
    rebuildRoute();
  });

  /* ---------- ボタンの配線 ---------- */
  $('btn-start').addEventListener('click', () => toggleMode('start'));
  $('btn-end').addEventListener('click', () => toggleMode('end'));
  $('btn-via').addEventListener('click', () => toggleMode('via'));
  $('btn-measure').addEventListener('click', () => toggleMode('measure'));
  $('btn-manual').addEventListener('click', () => {
    if (S.mode === 'manual') { setMode(null); return; }
    S.manualPts = []; S.manual = true; ++S.seq; S.pendingRestore = null;   // 手動は新しい線から始める
    clearRouteView(); updateMarkers(); showMsg(null);
    setMode('manual');
  });
  $('btn-clear').addEventListener('click', clearAll);

  function setBase(name) {
    api.setBase(name);
    $('base-osm').setAttribute('aria-pressed', String(name === 'osm'));
    $('base-aerial').setAttribute('aria-pressed', String(name === 'aerial'));
  }
  $('base-osm').addEventListener('click', () => setBase('osm'));
  $('base-aerial').addEventListener('click', () => setBase('aerial'));

  $('f-W').addEventListener('input', e => {
    S.W = parseFloat(e.target.value); $('o-W').textContent = S.W.toFixed(1); S.wTouched = true;
    rebuildTrack(false);
  });
  function setLaneMode(m) {
    S.laneMode = m;
    $('mode-full').setAttribute('aria-pressed', String(m === 'full'));
    $('mode-lane').setAttribute('aria-pressed', String(m === 'lane'));
    rebuildTrack(false);
  }
  $('mode-full').addEventListener('click', () => setLaneMode('full'));
  $('mode-lane').addEventListener('click', () => setLaneMode('lane'));
  $('f-vIn').addEventListener('input', e => { S.vIn = parseFloat(e.target.value); $('o-vIn').textContent = String(S.vIn); schedule(); });

  /* 車種（index.html と同じ挙動: 駆動方式を変えるとカスタム扱い） */
  $('f-preset').innerHTML = Object.keys(CAR_PRESETS).map(k => '<option value="' + k + '">' + CAR_PRESETS[k].label + '</option>').join('') + '<option value="custom">カスタム（自分で入力）</option>';
  $('f-preset').value = S.preset; $('f-drive').value = S.carP.drive;
  $('f-preset').addEventListener('change', e => {
    const k = e.target.value; S.preset = k;
    if (CAR_PRESETS[k]) { S.carP = Object.assign({}, CAR_PRESETS[k].v); $('f-drive').value = S.carP.drive; }
    S.car = deriveCar(S.carP); schedule();
  });
  $('f-drive').addEventListener('change', e => {
    S.carP.drive = e.target.value; S.preset = 'custom'; $('f-preset').value = 'custom';
    S.car = deriveCar(S.carP); schedule();
  });

  /* 最速の探索・自分のライン */
  $('btn-fast').addEventListener('click', () => { stopFast(); schedule(); });   // 同じ条件でやり直す
  ['my-apex', 'my-inside', 'my-hold'].forEach(id => $(id).addEventListener('input', onMyInput));
  $('my-corner').addEventListener('change', e => pickCorner(+e.target.value));
  $('my-reset').addEventListener('click', () => {
    const f = fastCurrent(); if (!f || !f.params) return;
    S.params = f.params.map(p => Object.assign({}, p)); S.paramsEdited = false;
    syncMyUI(); schedule();
  });

  /* スクラブ・再生 */
  $('scrub').addEventListener('input', e => { stopPlay(); setScrub(+e.target.value); });
  $('play').addEventListener('click', () => { if (S.playing) stopPlay(); else startPlay(); });

  /* 凡例: チェックで表示/非表示、ボタンで選択（選んだ系列は表示も入れる） */
  $('legend').addEventListener('change', e => {
    const i = e.target.closest('input[data-vis]'); if (!i || !S.results) return;
    if (i.checked) S.visible.add(i.dataset.vis); else S.visible.delete(i.dataset.vis);
    renderTable(); renderSpeed(); renderDelta(); renderMapLines(); updateScrub();
  });
  $('legend').addEventListener('click', e => {
    const b = e.target.closest('button[data-sel]'); if (!b || !S.results) return;
    S.sel = b.dataset.sel; S.visible.add(S.sel);
    renderLegend(); renderTable(); renderSpeed(); renderDelta(); renderGG(); renderMapLines(); updateScrub();
  });
  /* 表の行: 選んだコーナーに地図を寄せる（自分のライン調整の対象にもなる） */
  $('table').addEventListener('click', e => {
    if (e.target.closest('a')) return;   // 「1コーナーで詳しく」リンクは行クリック（地図を寄せる）に回さない
    const row = e.target.closest('tr[data-c]'); if (!row || !S.tr) return;
    const c = +row.dataset.c, k = S.tr.corners[c]; if (!k) return;
    pickCorner(c);   // 表の強調と #my-corner を合わせる
    const ll = trackToLatLngs(S.tr).slice(k.i0, k.i1 + 1);
    api.map.fitBounds(L.latLngBounds(ll.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 18 });
    $('map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  bindPlot('speed', () => speedCtx, SR.tipHtml);
  bindPlot('delta', () => deltaCtx, SR.deltaTipHtml);
  /* 横幅が変わったらグラフを描き直す／配色（ダークモード）が変わったら地図の線の色を取り直す */
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = $('main').clientWidth, rT = 0;
    new ResizeObserver(() => {
      const w = $('main').clientWidth; if (w === lastW) return; lastW = w;
      clearTimeout(rT); rT = setTimeout(() => { if (S.tr && S.results) { renderSpeed(); renderDelta(); renderGG(); updateScrub(); } }, 120);
    }).observe($('main'));
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.tr && S.results) renderMapLines(); });

  /* ---------- 区間の保存・一覧・読み込み・削除（store.js） ---------- */
  function renderSaved() {
    const ul = $('sec-list'), list = sectionStore.listSections();
    ul.textContent = '';
    if (!list.length) { const li = document.createElement('li'); li.className = 'sub'; li.textContent = '保存した区間はありません'; ul.appendChild(li); return; }
    list.forEach(s => {
      const li = document.createElement('li'), nm = document.createElement('strong'), info = document.createElement('span'), row = document.createElement('div');
      nm.textContent = s.name;
      info.className = 'sub num';
      info.textContent = new Date(s.savedAt).toLocaleString('ja-JP') + ' ・ ' + Math.round(s.total) + ' m';
      row.className = 'seg c2';
      [['open', '開く'], ['del', '削除']].forEach(([act, label]) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.act = act; b.dataset.id = s.id; b.textContent = label; row.appendChild(b);
      });
      li.append(nm, info, row); ul.appendChild(li);
    });
  }
  function saveCurrent() {
    const name = $('sec-name').value.trim();
    if (!name) { showMsg('名前を入れてください'); return; }
    if (!S.tr) { showMsg('区間を作ってから保存してください'); return; }
    const same = sectionStore.listSections().find(s => s.name === name);   // 同じ名前は上書き（id を引き継ぐ）
    const points = S.manual
      ? { start: null, end: null, vias: [], manual: S.manualPts.map(p => ({ lat: p.lat, lng: p.lng })) }
      : { start: S.points.start, end: S.points.end, vias: S.points.vias.slice() };
    const id = sectionStore.saveSection({
      id: same && same.id, name, points, manual: S.manual, W: S.W, laneMode: S.laneMode, vIn: S.vIn,
      preset: S.preset, carP: Object.assign({}, S.carP), params: S.params.map(p => Object.assign({}, p)), paramsEdited: S.paramsEdited, total: S.tr.total
    });
    renderSaved();
    if (id == null) showMsg('保存できませんでした（ブラウザの保存領域が使えません）');
    else showMsg('保存しました', { info: true });
  }
  async function openSaved(id) {
    const d = sectionStore.getSection(id);
    if (!d || !d.points) return;
    clearAll();   // 点・経路・結果を片付けて、幅の「触った」印も戻す
    showMsg('保存した区間を読み込み中…', { info: true });   // 経路が描けたら rebuildTrack が消す（探索の進み具合は進捗バー）
    S.wTouched = true;   // 保存した幅を使う（OSM タグで上書きしない）
    S.W = Math.min(12, Math.max(3, +d.W || 6)); $('f-W').value = String(S.W); $('o-W').textContent = S.W.toFixed(1);
    S.laneMode = d.laneMode === 'lane' ? 'lane' : 'full';
    $('mode-full').setAttribute('aria-pressed', String(S.laneMode === 'full')); $('mode-lane').setAttribute('aria-pressed', String(S.laneMode === 'lane'));
    S.vIn = +d.vIn || 60; $('f-vIn').value = String(S.vIn); $('o-vIn').textContent = String(S.vIn);
    S.preset = CAR_PRESETS[d.preset] || (d.preset === 'custom' && d.carP) ? d.preset : 'grb';   // 不明な車種は GRB に戻す
    S.carP = Object.assign({}, CAR_PRESETS[S.preset] ? CAR_PRESETS[S.preset].v : d.carP);
    S.car = deriveCar(S.carP); $('f-preset').value = S.preset; $('f-drive').value = S.carP.drive;
    $('sec-name').value = d.name;
    /* 自分のラインと全長の警告は、区間ができたときに当てる（経路の取得に失敗しても、再試行で成功したときに当たる） */
    S.pendingRestore = { params: Array.isArray(d.params) ? d.params.map(p => Object.assign({}, p)) : null, paramsEdited: !!d.paramsEdited, total: +d.total || 0 };
    if (d.manual) {
      S.manual = true; S.manualPts = (d.points.manual || []).map(p => ({ lat: p.lat, lng: p.lng })); updateMarkers();
      if (S.manualPts.length < 2) { S.pendingRestore = null; showMsg('保存された点が足りません'); return; }
      useManualRoute(); api.fitRoute(); applyPendingRestore();
    } else {
      S.points = { start: d.points.start, end: d.points.end, vias: (d.points.vias || []).slice() }; updateMarkers();
      await rebuildRoute();   // 成功すれば中で applyPendingRestore と地図合わせをする
    }
  }
  $('btn-save').addEventListener('click', saveCurrent);
  $('sec-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCurrent(); } });
  $('sec-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    if (b.dataset.act === 'open') openSaved(b.dataset.id);
    else { sectionStore.deleteSection(b.dataset.id); renderSaved(); }   // 個人用ツールなので確認なしで削除
  });

  setMode(null);
  syncMyUI(true);
  renderSaved();
})();
