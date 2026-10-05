/* ===== 区間モードの描画部品（DOM 非依存。HTML / SVG の文字列を返すだけ） =====
   ブラウザではグローバル SectionRender、Node では module.exports。
   index.html の frame / tickStep / renderSpeed / renderVerdict / renderTable を区間モード用に改変したコピー
   （計画上の意図的な重複。数式や配色を変えるときは両方そろえる）。 */
const SectionRender = (function () {
  const M = typeof module !== 'undefined' ? require('./map') : { cornerLabel, cornerNo: _cornerNo };
  const MINUS = '−';
  /* 符号付き。丸めて 0 になるときは ± にする（−0.00 を出さない） */
  const sgn = (x, d) => { const r = +x.toFixed(d); return (r > 0 ? '+' : r < 0 ? MINUS : '±') + Math.abs(r).toFixed(d); };
  const clampI = (x, a, b) => Math.max(a, Math.min(b, x));

  const SERIES = [
    { id: 'center', name: '中央', color: 'var(--ink2)' },
    { id: 'oio', name: '全アウトインアウト', color: 'var(--s1)' },
    { id: 'late', name: '全レイトエイペックス', color: 'var(--s2)' },
    { id: 'inside', name: '全インベタ', color: 'var(--s4)' },
    { id: 'my', name: '自分のライン', color: 'var(--s5)' },
    { id: 'fast', name: '最速', color: 'var(--accent)' }
  ];
  const seriesOf = id => SERIES.find(s => s.id === id);
  const EPS_T = 0.005;   // 秒。これ未満の差は「差なし」として扱う

  /* ---------- 判定カード ---------- */
  /* 最速と中央の差、コーナーごとの差で最も縮んだコーナーを返す（純粋）。
     worst は「中央より EPS_T 以上速いコーナー」があるときだけ入る */
  function verdictInfo(results, tr) {
    const fast = results.fast, center = results.center;
    const time = fast.sim.time, delta = time - center.sim.time;
    if (!tr.corners.length) return { straight: true, time, delta, worst: null };
    let worst = null;
    tr.corners.forEach((k, c) => {
      const d = fast.stats[c].tCorner - center.stats[c].tCorner;
      if (!worst || d < worst.d) worst = { c, d, label: M.cornerLabel(k) };
    });
    if (worst && worst.d > -EPS_T) worst = null;
    return { straight: false, time, delta, worst };
  }

  function verdictText(info) {
    const sec = x => '<span class="num">' + sgn(x, 2) + '秒</span>';
    if (info.straight) return '<p>ほぼ直線のため、ラインによる差はありません。区間タイム <strong class="num">' + info.time.toFixed(2) + ' 秒</strong></p>';
    let t;
    if (Math.abs(info.delta) < EPS_T) t = '最速は中央とほぼ同じタイムです。';
    else if (info.delta < 0) t = '最速は中央より <strong>' + sgn(info.delta, 2) + '秒</strong>。';
    else t = '最速は中央より <strong>' + sgn(info.delta, 2) + '秒</strong>（中央のほうが速いライン）。';
    if (info.worst) t += '差が最も大きいのは <strong>' + info.worst.label + '</strong>（' + sec(info.worst.d) + '）。';
    return '<p>' + t + '</p>';
  }

  function verdictHtml(info) {
    const s = seriesOf('fast');
    return '<div style="display:grid;gap:4px"><div class="eyebrow">この区間のタイム</div><div class="v-name"><span class="key" style="background:' + s.color + '"></span>' + s.name + '</div>' +
      '<div class="v-time">' + info.time.toFixed(2) + '<small>秒</small></div></div><div class="v-text">' + verdictText(info) + '</div>';
  }

  /* ---------- 凡例（チェックボックス＋選択ボタン） ---------- */
  function legendHtml() {
    return SERIES.map(s =>
      '<span class="lg"><input type="checkbox" data-vis="' + s.id + '" aria-label="' + s.name + 'を表示">' +
      '<button type="button" data-sel="' + s.id + '" aria-pressed="false"><span class="key" style="background:' + s.color + '"></span>' + s.name + '</button></span>').join('');
  }

  /* ---------- コーナー表 ----------
     ids = 表示する系列 id の配列（SERIES の順）。selId = 強調する系列、selCorner = 選ばれている行（無ければ -1） */
  function tableHtml(tr, results, ids, selId, selCorner) {
    const cols = ids.map(id => seriesOf(id));
    const cls = id => (id === selId ? ' selcol' : '');
    let h = '<table class="table"><thead><tr><th scope="col" rowspan="2">コーナー</th>' +
      cols.map(s => '<th scope="colgroup" colspan="2" class="sg' + cls(s.id) + '"' + '><span class="key" style="background:' + s.color + '"></span> ' + s.name + '</th>').join('') + '</tr><tr>' +
      cols.map(s => '<th scope="col" class="' + cls(s.id).trim() + '">最低 km/h</th><th scope="col" class="' + cls(s.id).trim() + '">通過 s</th>').join('') + '</tr></thead><tbody>';
    tr.corners.forEach((k, c) => {
      h += '<tr data-c="' + c + '"' + (c === selCorner ? ' class="pick" aria-current="true"' : '') + '><td><button type="button" class="cbtn">' + M.cornerLabel(k, true) + '</button></td>' +
        cols.map(s => {
          const st = results[s.id].stats[c];
          return '<td class="' + cls(s.id).trim() + '">' + (st.vMin * 3.6).toFixed(1) + '</td><td class="' + cls(s.id).trim() + '">' + st.tCorner.toFixed(2) + '</td>';
        }).join('') + '</tr>';
    });
    const t0 = results.center.sim.time;
    h += '<tr class="total"><td>区間合計</td>' + cols.map(s => {
      const t = results[s.id].sim.time;
      return '<td colspan="2" class="t' + cls(s.id) + '">' + t.toFixed(2) + ' <span class="sub">' + (s.id === 'center' ? '基準' : sgn(t - t0, 2)) + '</span></td>';
    }).join('') + '</tr></tbody></table>';
    return h;
  }

  /* ---------- 速度グラフ ---------- */
  function tickStep(span, n) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function tickList(lo, hi, step) { const out = []; for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(8)); return out; }
  /* 枡・軸・帯を描く。w,h = 描画サイズ(px)。返す x(), y() はデータ値 → px */
  function frame(w, h, o) {
    const m = { l: 46, r: 14, t: 12, b: 36 };
    const x = v => m.l + (v - o.xd[0]) / (o.xd[1] - o.xd[0]) * (w - m.l - m.r), y = v => h - m.b - (v - o.yd[0]) / (o.yd[1] - o.yd[0]) * (h - m.t - m.b);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + o.aria + '">';
    (o.bands || []).forEach(b => { s += '<rect x="' + x(b.x0) + '" y="' + m.t + '" width="' + Math.max(1, x(b.x1) - x(b.x0)) + '" height="' + (h - m.t - m.b) + '" fill="var(--ink)" opacity="0.05"/><text class="jp" x="' + (x(b.x0) + x(b.x1)) / 2 + '" y="' + (m.t + 13) + '" text-anchor="middle">' + b.label + '</text>'; });
    o.yt.forEach(t => { s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--grid)"/><text x="' + (m.l - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + o.yf(t) + '</text>'; });
    s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (h - m.b) + '" y2="' + (h - m.b) + '" stroke="var(--axis)"/>';
    o.xt.forEach(t => { s += '<text x="' + x(t) + '" y="' + (h - m.b + 16) + '" text-anchor="middle">' + o.xf(t) + '</text>'; });
    s += '<text class="jp" x="' + (w - m.r) + '" y="' + (h - 4) + '" text-anchor="end">' + o.xtitle + '</text>';
    return { s, x, y, w, h, m };
  }

  /* 速度グラフ一式。戻り値 {html, fr, xd, ids}。ホバー用の縦線と点（#speed-x / #speed-d-<id>）と #speed-tip 入り。
     ids が空でも枠は描く */
  function speedPlot(w, h, tr, results, ids, selId) {
    let lo = Infinity, hi = 0;
    ids.forEach(id => { const v = results[id].sim.v; for (let i = 0; i < tr.N; i++) { const k = v[i] * 3.6; if (k < lo) lo = k; if (k > hi) hi = k; } });
    if (!ids.length) { lo = 0; hi = 100; }
    if (hi - lo < 10) { hi += 5; lo = Math.max(0, lo - 5); }
    const ys = tickStep(hi - lo, 5), yd = [Math.floor(lo / ys) * ys, Math.ceil(hi / ys) * ys];
    const xd = [0, tr.total], xs = tickStep(xd[1] - xd[0], Math.max(4, Math.min(10, w / 80)));
    const fr = frame(w, h, {
      xd, yd, xt: tickList(xd[0], xd[1], xs), yt: tickList(yd[0], yd[1], ys), xf: t => String(Math.round(t)), yf: t => t.toFixed(0),
      xtitle: '区間の距離（m）', aria: '各ラインの速度の推移',
      bands: tr.corners.map(k => ({ x0: k.s0, x1: k.s1, label: M.cornerNo(k.no) }))
    });
    /* 点を間引いて描く（5km でも 1 本 1250 点程度。1px 未満の違いは見えない） */
    const stride = Math.max(1, Math.floor(tr.N / 1500));
    const poly = id => { const v = results[id].sim.v, p = []; for (let i = 0; i < tr.N; i += stride) p.push(fr.x(tr.st[i]).toFixed(1) + ',' + fr.y(v[i] * 3.6).toFixed(1)); if ((tr.N - 1) % stride) p.push(fr.x(tr.st[tr.N - 1]).toFixed(1) + ',' + fr.y(v[tr.N - 1] * 3.6).toFixed(1)); return p.join(' '); };
    let s = fr.s;
    const draw = id => { s += '<polyline points="' + poly(id) + '" fill="none" stroke="' + seriesOf(id).color + '" stroke-width="' + (id === selId ? 2.6 : 1.8) + '" stroke-linejoin="round" stroke-linecap="round"/>'; };
    ids.filter(id => id !== selId).forEach(draw); if (ids.includes(selId)) draw(selId);
    s += '<g id="speed-h" visibility="hidden"><line id="speed-x" y1="' + fr.m.t + '" y2="' + (h - fr.m.b) + '" stroke="var(--ink2)" stroke-width="1"/>' +
      ids.map(id => '<circle id="speed-d-' + id + '" r="' + (id === selId ? 5 : 4) + '" fill="' + seriesOf(id).color + '" stroke="var(--surface)" stroke-width="2"/>').join('') + '</g>';
    return { html: s + '</svg><div class="tip" id="speed-tip" hidden></div>', fr, xd, ids };
  }

  /* ホバー位置 i の値の一覧（ツールチップ用） */
  function tipHtml(tr, results, ids, selId, i) {
    return '<b>距離 ' + Math.round(tr.st[i]) + ' m</b>' + ids.map(id => {
      const s = seriesOf(id);
      return '<div class="row"' + (id === selId ? ' style="font-weight:700"' : '') + '><span class="key" style="background:' + s.color + '"></span>' + s.name + '<span class="v">' + (results[id].sim.v[i] * 3.6).toFixed(1) + ' km/h</span></div>';
    }).join('');
  }

  return { SERIES, seriesOf, sgn, clampI, verdictInfo, verdictText, verdictHtml, legendHtml, tableHtml, tickStep, tickList, frame, speedPlot, tipHtml };
})();

if (typeof module !== 'undefined') module.exports = SectionRender;
