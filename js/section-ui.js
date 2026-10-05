/* ===== 区間モードの画面配線（状態機械・地図クリック・経路取得 → tr 構築 → コーナー表示） =====
   表・グラフ・ラインは次のタスクでここに足していく。 */
(function () {
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);

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
    preset: 'grb', car: Object.assign({}, CAR_PRESETS.grb.v),
    failCount: 0,
    seq: 0               // 経路取得の通し番号（古い応答を捨てる）
  };

  if (typeof L === 'undefined') {
    const m = $('msg'); m.hidden = false; m.textContent = '地図ライブラリ(Leaflet)を読み込めませんでした。ネットワークを確認して再読み込みしてください。';
    return;
  }
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
    S.latlngs = null; S.tr = null;
    api.setRoute(null); api.drawCorners([], null); api.clearLines();
    $('sec-info').textContent = '区間は未設定です';
  }

  /* ---------- 経路 → tr → コーナー表示 ---------- */
  /* tr だけ作り直す（幅・範囲を変えたときは経路を取り直さない）。fit=true で地図を経路に合わせる */
  function rebuildTrack(fit) {
    if (!S.latlngs) return;
    const tr = buildTrackFromPath(S.latlngs, { W: S.W, mode: S.laneMode });
    if (tr.error) {
      S.tr = null; api.setRoute(null); api.drawCorners([], null);
      $('sec-info').textContent = '区間は未設定です';
      showMsg('区間は100m〜5kmにしてください（いま ' + Math.round(tr.total) + ' m）');
      return;
    }
    S.tr = tr;
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
  $('f-vIn').addEventListener('input', e => { S.vIn = parseFloat(e.target.value); $('o-vIn').textContent = String(S.vIn); });

  /* 車種（index.html と同じ挙動: 駆動方式を変えるとカスタム扱い） */
  $('f-preset').innerHTML = Object.keys(CAR_PRESETS).map(k => '<option value="' + k + '">' + CAR_PRESETS[k].label + '</option>').join('') + '<option value="custom">カスタム（自分で入力）</option>';
  $('f-preset').value = S.preset; $('f-drive').value = S.car.drive;
  $('f-preset').addEventListener('change', e => {
    const k = e.target.value; S.preset = k;
    if (CAR_PRESETS[k]) { S.car = Object.assign({}, CAR_PRESETS[k].v); $('f-drive').value = S.car.drive; }
  });
  $('f-drive').addEventListener('change', e => { S.car.drive = e.target.value; S.preset = 'custom'; $('f-preset').value = 'custom'; });

  setMode(null);
})();
