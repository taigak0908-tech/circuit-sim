/* ===== 区間モードの画面配線（状態機械・地図クリック・経路取得 → tr 構築 → 6本のライン計算 → 判定・表・グラフ・地図の線） =====
   HTML/SVG の組み立ては section-render.js（SectionRender）。ここは状態・DOM への反映・イベント。
   最速探索と自分のラインの調整 UI は次のタスクで足す。 */
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
  const HINTS = {
    start: '地図をクリックして始点を置きます',
    end: '地図をクリックして終点を置きます',
    via: '地図をクリックして経由点を置きます',
    manual: '道に沿って地図を順にクリックします（2点以上で線を引きます）'
  };
  const HINT_IDLE = 'ボタンで点の種類を選び、地図をクリックします';

  /* 状態。mode は null | 'start' | 'end' | 'via' | 'manual' */
  const S = {
    mode: null,
    points: { start: null, end: null, vias: [] },
    manualPts: [],       // 手動モードの点列
    manual: false,       // いま手動モードの点を使っているか
    latlngs: null, tr: null,
    W: 6, laneMode: 'full', vIn: 60,
    preset: 'grb', carP: Object.assign({}, CAR_PRESETS.grb.v), car: null,   // carP = 車のパラメータ、car = deriveCar の結果
    params: [],          // 自分のライン（コーナーごと {apex,inside,hold}）。tr ができるたび既定値に戻す
    sel: 'fast',         // 選択中の系列（地図で太く・表で強調）
    selCorner: -1,       // 表で選んだコーナーの添字
    results: null,       // {[系列id]: {line, sim, stats}}
    visible: new Set(['center', 'my', 'fast']),   // 表示中の系列
    failCount: 0,
    seq: 0               // 経路取得の通し番号（古い応答を捨てる）
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
  const MODE_BTN = { start: 'btn-start', end: 'btn-end', via: 'btn-via', manual: 'btn-manual' };
  function setMode(m) {
    S.mode = m;
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
    api.setRoute(null); api.drawCorners([], null);
    renderAll();   // 結果が無いので判定・表・グラフ・地図の線を片付ける
    $('sec-info').textContent = '区間は未設定です';
  }

  /* ---------- 計算（tr → 6本のライン） ---------- */
  function compute() {
    const tr = S.tr;
    if (!tr || tr.error) { S.results = null; return; }
    const vE = S.vIn / 3.6, R = {};
    const run = line => { const r = runLineN(tr, S.car, vE, line); return { line: r.line, sim: r.sim, stats: cornerStats(tr, r.sim) }; };
    /* コーナーが無い直線では曲率最小化の方程式が特異になり NaN が出る（lines.js の solveLineN）。
       ラインによる差も無いので、全系列を中央ラインにする */
    const straight = tr.corners.length === 0;
    const pick = make => run(straight ? centerLine(tr) : make());
    R.center = run(centerLine(tr));
    R.oio = pick(() => lineOIO(tr));
    R.late = pick(() => lineLate(tr));
    R.inside = pick(() => lineInside(tr));
    R.my = pick(() => lineCustom(tr, S.params));
    R.fast = R.my;   // 最速探索（searchFastest）は次のタスクで組み込む。それまでは自分のラインと同じ結果を指す
    S.results = R;
  }

  /* ---------- 描画 ---------- */
  const visibleIds = () => SR.SERIES.map(s => s.id).filter(id => S.visible.has(id));
  /* CSS 変数（var(--s1)）を実色にする。Leaflet は CSS 変数を使えないため。ダークモードでも呼び直せば追従 */
  function cssColor(v) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    return m ? (getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888') : v;
  }
  let speedCtx = null;

  function renderVerdict() { $('verdict').innerHTML = SR.verdictHtml(SR.verdictInfo(S.results, S.tr)); }
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
    ['verdict', 'legend', 'table-card', 'speed-card'].forEach(id => { $(id).hidden = !ok; });
    if (!ok) {
      api.clearLines(); speedCtx = null;
      $('verdict').innerHTML = ''; $('table').innerHTML = ''; $('speed').innerHTML = '';
      return;
    }
    renderVerdict(); renderLegend(); renderTable(); renderSpeed(); renderMapLines();
  }
  /* 入力が連続しても 1 フレームに 1 回だけ計算・描画する */
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      try { compute(); } catch (e) { S.results = null; showMsg('ラインの計算に失敗しました（' + e.message + '）'); }
      renderAll();
    });
  }

  /* 速度グラフのホバー（縦線と各系列の値） */
  function bindSpeed() {
    const el = $('speed');
    const move = e => {
      const c = speedCtx; if (!c || !S.tr) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      const xv = c.xd[0] + (px - c.fr.m.l) / (c.fr.w - c.fr.m.l - c.fr.m.r) * (c.xd[1] - c.xd[0]);
      const i = SR.clampI(Math.round(xv / S.tr.ds), 0, S.tr.N - 1), xp = c.fr.x(S.tr.st[i]);
      const h = $('speed-h'), ln = $('speed-x'); if (!h || !ln) return;
      h.setAttribute('visibility', 'visible'); ln.setAttribute('x1', xp); ln.setAttribute('x2', xp);
      c.ids.forEach(id => { const d = $('speed-d-' + id); d.setAttribute('cx', xp); d.setAttribute('cy', c.fr.y(S.results[id].sim.v[i] * 3.6)); });
      const tip = $('speed-tip');
      tip.innerHTML = SR.tipHtml(S.tr, S.results, c.ids, S.sel, i); tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(c.fr.w - w - 4, xp + 14 + w > c.fr.w ? xp - w - 14 : xp + 14)) + 'px';
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', () => { const h = $('speed-h'), t = $('speed-tip'); if (h) h.setAttribute('visibility', 'hidden'); if (t) t.hidden = true; });
  }

  /* ---------- 経路 → tr → コーナー表示 ---------- */
  /* tr だけ作り直す（幅・範囲を変えたときは経路を取り直さない）。fit=true で地図を経路に合わせる */
  function rebuildTrack(fit) {
    if (!S.latlngs) return;
    const tr = buildTrackFromPath(S.latlngs, { W: S.W, mode: S.laneMode });
    if (tr.error) {
      S.tr = null; S.results = null; api.setRoute(null); api.drawCorners([], null); renderAll();
      $('sec-info').textContent = '区間は未設定です';
      showMsg('区間は100m〜5kmにしてください（いま ' + Math.round(tr.total) + ' m）');
      return;
    }
    S.tr = tr;
    S.params = defaultParams(tr, 'late'); S.selCorner = -1;
    schedule();
    api.setRoute(S.latlngs);
    api.drawCorners(tr.corners, tr);
    if (fit) api.fitRoute();
    const n = tr.corners.length;
    $('sec-info').textContent = '全長 ' + Math.round(tr.total) + ' m・コーナー ' + n + ' 個';
    if (n === 0) showMsg('ほぼ直線です', { info: true }); else showMsg(null);
  }

  async function rebuildRoute() {
    const { start, end, vias } = S.points;
    if (!start || !end) return;
    const seq = ++S.seq;
    showMsg('経路を取得中…', { info: true });
    let r;
    try {
      r = await fetchRoute([start, ...vias, end]);
    } catch (e) {
      if (seq !== S.seq) return;
      S.failCount++; updateManualBtn(); clearRouteView();
      showMsg(e.message === 'noroute'
        ? '道路としてつながっていません。経由点を足すか始点を少しずらしてください'
        : '経路を取れませんでした（' + S.failCount + '回目）', { retry: true });
      return;
    }
    if (seq !== S.seq) return;
    S.failCount = 0; updateManualBtn();
    S.latlngs = r.latlngs;
    rebuildTrack(true);
  }

  function useManualRoute() {
    ++S.seq;
    S.latlngs = manualRoute(S.manualPts).latlngs;
    rebuildTrack(false);
  }

  function clearAll() {
    ++S.seq;
    S.points = { start: null, end: null, vias: [] };
    S.manualPts = []; S.manual = false;
    clearRouteView(); api.setMarkers(null); showMsg(null); setMode(null);
  }

  /* ---------- 地図クリック ---------- */
  api.onMapClick(p => {
    const m = S.mode;
    if (!m) return;
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
  $('btn-manual').addEventListener('click', () => {
    if (S.mode === 'manual') { setMode(null); return; }
    S.manualPts = []; S.manual = true; ++S.seq;     // 手動は新しい線から始める
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
    S.W = parseFloat(e.target.value); $('o-W').textContent = S.W.toFixed(1);
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

  /* 凡例: チェックで表示/非表示、ボタンで選択（選んだ系列は表示も入れる） */
  $('legend').addEventListener('change', e => {
    const i = e.target.closest('input[data-vis]'); if (!i || !S.results) return;
    if (i.checked) S.visible.add(i.dataset.vis); else S.visible.delete(i.dataset.vis);
    renderTable(); renderSpeed(); renderMapLines();
  });
  $('legend').addEventListener('click', e => {
    const b = e.target.closest('button[data-sel]'); if (!b || !S.results) return;
    S.sel = b.dataset.sel; S.visible.add(S.sel);
    renderLegend(); renderTable(); renderSpeed(); renderMapLines();
  });
  /* 表の行: 選んだコーナーに地図を寄せる（自分のライン調整の対象にも使う） */
  $('table').addEventListener('click', e => {
    const row = e.target.closest('tr[data-c]'); if (!row || !S.tr) return;
    const c = +row.dataset.c, k = S.tr.corners[c]; if (!k) return;
    S.selCorner = c;
    $('table').querySelectorAll('tr[data-c]').forEach(r => {
      const on = r === row; r.classList.toggle('pick', on);
      if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    });
    const ll = trackToLatLngs(S.tr).slice(k.i0, k.i1 + 1);
    api.map.fitBounds(L.latLngBounds(ll.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 18 });
    $('map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  bindSpeed();
  /* 横幅が変わったらグラフを描き直す／配色（ダークモード）が変わったら地図の線の色を取り直す */
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = $('main').clientWidth, rT = 0;
    new ResizeObserver(() => {
      const w = $('main').clientWidth; if (w === lastW) return; lastW = w;
      clearTimeout(rT); rT = setTimeout(() => { if (S.tr && S.results) renderSpeed(); }, 120);
    }).observe($('main'));
  }
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.tr && S.results) renderMapLines(); });

  setMode(null);
})();
