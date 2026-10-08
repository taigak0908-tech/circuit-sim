/* ===== 区間モードの描画部品（DOM 非依存。HTML / SVG の文字列を返すだけ） =====
   ブラウザではグローバル SectionRender、Node では module.exports。
   index.html の frame / tickStep / renderSpeed / renderVerdict / renderTable を区間モード用に改変したコピー
   （計画上の意図的な重複。数式や配色を変えるときは両方そろえる）。 */
const SectionRender = (function () {
  const M = typeof module !== 'undefined' ? require('./map') : { cornerLabel, cornerNo: _cornerNo, cornerText, cornerDiamond };
  const P = typeof module !== 'undefined' ? require('./physics') : { G, tireState };
  const MINUS = '−';
  /* 符号付き。丸めて 0 になるときは ± にする（−0.00 を出さない） */
  const sgn = (x, d) => { const r = +x.toFixed(d); return (r > 0 ? '+' : r < 0 ? MINUS : '±') + Math.abs(r).toFixed(d); };
  const clampI = (x, a, b) => Math.max(a, Math.min(b, x));

  /* 色が付くのは「最速（黄）」と「自分（青）」だけ。中央と型ラインは灰色で、線種（dash）で見分ける。
     thin = 細い線（中央）、cased = 昼の白地では下に縁取りを敷く（黄色の線）。地図・グラフ・凡例で同じ線種にする */
  const SERIES = [
    { id: 'center', name: '中央', color: 'var(--line-type)', dash: '', thin: true },
    { id: 'oio', name: '全アウトインアウト', color: 'var(--line-type)', dash: '6 3' },
    { id: 'late', name: '全レイトエイペックス', color: 'var(--line-type)', dash: '2 3' },
    { id: 'inside', name: '全インベタ', color: 'var(--line-type)', dash: '8 3 2 3' },
    { id: 'my', name: '自分のライン', color: 'var(--blue)', dash: '' },
    { id: 'fast', name: '最速', color: 'var(--yellow)', dash: '', cased: true }
  ];
  const seriesOf = id => SERIES.find(s => s.id === id);
  const EPS_T = 0.005;   // 秒。これ未満の差は「差なし」として扱う

  /* 線の見た目の属性（色・太さ・線種）。w = 太さ(px) */
  const strokeOf = (s, w) => 'stroke="' + s.color + '" stroke-width="' + w + '"' + (s.dash ? ' stroke-dasharray="' + s.dash + '" stroke-linecap="butt"' : ' stroke-linecap="round"');
  /* 凡例・表・ツールチップの線種の見本（小さな SVG） */
  function keyHtml(s) {
    const w = s.thin ? 1.5 : 2.5;
    return '<svg class="key" viewBox="0 0 26 8" aria-hidden="true">' +
      (s.cased ? '<line x1="1" x2="25" y1="4" y2="4" stroke="var(--yellow-case)" stroke-width="' + (w + 2.5) + '"/>' : '') +
      '<line x1="1" x2="25" y1="4" y2="4" ' + strokeOf(s, w) + '/></svg>';
  }

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

  /* 判定の1行（ヘッダー帯の下）。最速と中央の差そのものは黄色い板（plateHtml）が受け持つ */
  function verdictText(info) {
    const sec = x => '<span class="num">' + sgn(x, 2) + '秒</span>';
    if (info.straight) return '<p>ほぼ直線のため、ラインによる差はありません。区間タイム <strong class="num">' + info.time.toFixed(2) + ' 秒</strong></p>';
    let t = '最速の区間タイム <strong class="num">' + info.time.toFixed(2) + ' 秒</strong>。';
    if (info.delta >= EPS_T) t += '中央のほうが速いラインです。';
    if (info.worst) t += '差が最も大きいのは <strong>' + info.worst.label + '</strong>（' + sec(info.worst.d) + '）。';
    return '<p>' + t + '</p>';
  }
  function verdictHtml(info) { return verdictText(info); }

  /* 最速との差の黄色い板の中身（ラベル・斜体の大きな数字・単位）。ほぼ直線なら区間タイムを載せる */
  function plateHtml(info) {
    const box = (l, n) => '<span class="plate-l">' + l + '</span><span class="plate-n">' + n + '</span><span class="plate-u">秒</span>';
    if (info.straight) return box('区間タイム', info.time.toFixed(2));
    return box('最速は中央より', sgn(info.delta, 2));
  }

  /* ---------- 凡例（チェックボックス＋選択ボタン） ---------- */
  /* 凡例の末尾の説明。型ラインは計算の参考値で、判定カードの基準は「最速」 */
  const LEGEND_NOTE = '型ライン（全アウトインアウト・全レイト・全インベタ）は全コーナーに同じ型を当てた参考値です。峠では「最速」と「自分のライン」を基準にしてください';
  function legendHtml() {
    return SERIES.map(s =>
      '<span class="lg"><input type="checkbox" data-vis="' + s.id + '" aria-label="' + s.name + 'を表示">' +
      '<button type="button" data-sel="' + s.id + '" aria-pressed="false">' + keyHtml(s) + s.name + '</button></span>').join('') +
      '<span class="lg-note">' + LEGEND_NOTE + '</span>';
  }

  /* ---------- 1コーナー比較（index.html）への引き継ぎ ----------
     コーナー k・そのコーナー入口での中央ラインの速度 vMs（m/s）・区間の幅 W から URL を作る。
     index.html 側で各スライダーの範囲（幅は 3〜16 m など）に収める。角度は 5° 刻み、速度は km/h の整数 */
  function cornerLinkUrl(k, vMs, W) {
    return 'index.html?R=' + Math.round(k.rMin) + '&angDeg=' + Math.round(k.angDeg / 5) * 5 + '&W=' + +(+W).toFixed(1) + '&vIn=' + Math.round(vMs * 3.6);
  }

  /* ---------- コーナー表 ----------
     ids = 表示する系列 id の配列（SERIES の順）。selId = 強調する系列、selCorner = 選ばれている行（無ければ -1） */
  /* compact=true はスマホ幅用: 系列の選択によらず「最低（最速のライン）・最速・自分」の3列だけにする */
  function tableHtml(tr, results, ids, selId, selCorner, compact) {
    const cols = ids.map(id => seriesOf(id));
    const cls = id => (id === selId ? ' selcol' : '');
    const t0 = results.center.sim.time;
    /* 中央との差。遅くなる（＋）ときだけ赤（規制標識の色） */
    const diff = t => { const d = sgn(t - t0, 2); return '<span class="' + (d[0] === '+' ? 'slow' : 'sub') + '">' + d + '</span>'; };
    const cornerCell = k => '<td><button type="button" class="cbtn">' + M.cornerDiamond(k.no) + '<span>' + M.cornerText(k) + '</span></button></td>';
    const linkCell = k => '<td><a class="btn-sm" target="_blank" rel="noopener" href="' + cornerLinkUrl(k, results.center.sim.v[k.i0], tr.W) + '"><span class="sr-only">1コーナーで</span>詳しく</a></td>';
    const rowOpen = c => '<tr data-c="' + c + '"' + (c === selCorner ? ' class="pick" aria-current="true"' : '') + '>';
    let h;
    if (compact) {
      const F = results.fast, Y = results.my;
      h = '<table class="table compact"><thead><tr><th scope="col">コーナー</th><th scope="col">最低 km/h<span class="sr-only">（最速のライン）</span></th>' +
        '<th scope="col">' + keyHtml(seriesOf('fast')) + ' 最速 s</th><th scope="col">' + keyHtml(seriesOf('my')) + ' 自分 s</th><th scope="col"><span class="sr-only">1コーナーで</span>詳しく</th></tr></thead><tbody>';
      tr.corners.forEach((k, c) => {
        h += rowOpen(c) + cornerCell(k) + '<td>' + (F.stats[c].vMin * 3.6).toFixed(1) + '</td><td>' + F.stats[c].tCorner.toFixed(2) + '</td><td>' + Y.stats[c].tCorner.toFixed(2) + '</td>' + linkCell(k) + '</tr>';
      });
      h += '<tr class="total"><td>区間合計</td><td></td><td class="t">' + F.sim.time.toFixed(2) + '</td><td class="t">' + Y.sim.time.toFixed(2) + ' ' + diff(Y.sim.time) + '</td><td></td></tr></tbody></table>';
    } else {
      h = '<table class="table"><thead><tr><th scope="col" rowspan="2">コーナー</th>' +
        cols.map(s => '<th scope="colgroup" colspan="2" class="sg' + cls(s.id) + '"' + '>' + keyHtml(s) + ' ' + s.name + '</th>').join('') + '<th scope="col" rowspan="2">詳しく</th></tr><tr>' +
        cols.map(s => '<th scope="col" class="' + cls(s.id).trim() + '">最低 km/h</th><th scope="col" class="' + cls(s.id).trim() + '">通過 s</th>').join('') + '</tr></thead><tbody>';
      tr.corners.forEach((k, c) => {
        h += rowOpen(c) + cornerCell(k) +
          cols.map(s => {
            const st = results[s.id].stats[c];
            return '<td class="' + cls(s.id).trim() + '">' + (st.vMin * 3.6).toFixed(1) + '</td><td class="' + cls(s.id).trim() + '">' + st.tCorner.toFixed(2) + '</td>';
          }).join('') + linkCell(k) + '</tr>';
      });
      h += '<tr class="total"><td>区間合計</td>' + cols.map(s => {
        const t = results[s.id].sim.time;
        return '<td colspan="2" class="t' + cls(s.id) + '">' + t.toFixed(2) + ' ' + (s.id === 'center' ? '<span class="sub">基準</span>' : diff(t)) + '</td>';
      }).join('') + '<td></td></tr></tbody></table>';
    }
    if (tr.corners.length) h += '<p class="hint">「詳しく」は、そのコーナーの条件（入口の速度は中央ライン）を 1コーナー比較へ渡して新しいタブで開きます。1コーナー比較は半径 5〜200 m・幅 3〜16 m・入口速度 20〜220 km/h の範囲なので、外れている値は端の値になります。</p>';
    return h;
  }

  /* ---------- 速度グラフ ---------- */
  function tickStep(span, n) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function tickList(lo, hi, step) { const out = []; for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(8)); return out; }
  /* 枡・軸・帯を描く。w,h = 描画サイズ(px)。返す x(), y() はデータ値 → px */
  /* ひし形の標識（SVG）。cx,cy = 中心。20px 角を 45° 回して番号を中に書く（HTML の .dia と同じ形） */
  const diaSvg = (cx, cy, no) => '<g transform="translate(' + cx.toFixed(1) + ' ' + cy + ')"><rect x="-10" y="-10" width="20" height="20" rx="2" transform="rotate(45)" fill="var(--yellow)" stroke="#000" stroke-width="1.2"/>' +
    '<text class="dia-t" y="4" text-anchor="middle">' + no + '</text></g>';
  /* bands = [{x0, x1, no}]（カーブ区間）。黄色の薄い帯を敷き、上の余白にひし形の番号を置く（隣と重なるときは省く） */
  function frame(w, h, o) {
    const bands = o.bands || [];
    const m = { l: 46, r: 14, t: bands.length && o.marks !== false ? 36 : 12, b: 36 };
    const x = v => m.l + (v - o.xd[0]) / (o.xd[1] - o.xd[0]) * (w - m.l - m.r), y = v => h - m.b - (v - o.yd[0]) / (o.yd[1] - o.yd[0]) * (h - m.t - m.b);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + o.aria + '">';
    let lastX = -Infinity;
    bands.forEach(b => {
      s += '<rect x="' + x(b.x0) + '" y="' + m.t + '" width="' + Math.max(1, x(b.x1) - x(b.x0)) + '" height="' + (h - m.t - m.b) + '" style="fill:var(--yellow);fill-opacity:var(--band-op)"/>';
      const cx = (x(b.x0) + x(b.x1)) / 2;
      if (o.marks !== false && cx - lastX >= 30) { s += diaSvg(cx, 16, b.no); lastX = cx; }
    });
    o.yt.forEach(t => { s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="' + (o.zero && t === 0 ? 'var(--line-type)' : 'var(--rule)') + '"/><text x="' + (m.l - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + o.yf(t) + '</text>'; });
    s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (h - m.b) + '" y2="' + (h - m.b) + '" stroke="var(--line-type)"/>';
    o.xt.forEach(t => { s += '<text x="' + x(t) + '" y="' + (h - m.b + 16) + '" text-anchor="middle">' + o.xf(t) + '</text>'; });
    s += '<text class="jp" x="' + (w - m.r) + '" y="' + (h - 4) + '" text-anchor="end">' + o.xtitle + '</text>';
    return { s, x, y, w, h, m };
  }

  /* 系列の折れ線（選択中を最前面）と、位置表示用の縦線・点（#<prefix>-x / #<prefix>-d-<id>）。valOf(id,i) = 系列 id の位置 i の値。
     点を間引いて描く（5km でも 1 本 1250 点程度。1px 未満の違いは見えない） */
  function lines(fr, tr, ids, selId, valOf, prefix) {
    const stride = Math.max(1, Math.floor(tr.N / 1500));
    const poly = id => { const p = []; for (let i = 0; i < tr.N; i += stride) p.push(fr.x(tr.st[i]).toFixed(1) + ',' + fr.y(valOf(id, i)).toFixed(1)); if ((tr.N - 1) % stride) p.push(fr.x(tr.st[tr.N - 1]).toFixed(1) + ',' + fr.y(valOf(id, tr.N - 1)).toFixed(1)); return p.join(' '); };
    let s = fr.s;
    const draw = id => {
      const se = seriesOf(id), w = id === selId ? 2.6 : se.thin ? 1.2 : 1.8, pts = poly(id);
      if (se.cased) s += '<polyline points="' + pts + '" fill="none" stroke="var(--yellow-case)" stroke-width="' + (w + 2.4) + '" stroke-linejoin="round" stroke-linecap="round"/>';
      s += '<polyline points="' + pts + '" fill="none" ' + strokeOf(se, w) + ' stroke-linejoin="round"/>';
    };
    ids.filter(id => id !== selId).forEach(draw); if (ids.includes(selId)) draw(selId);
    return s + '<g id="' + prefix + '-h"><line id="' + prefix + '-x" y1="' + fr.m.t + '" y2="' + (fr.h - fr.m.b) + '" stroke="var(--strong)" stroke-width="1"/>' +
      ids.map(id => '<circle id="' + prefix + '-d-' + id + '" r="' + (id === selId ? 5 : 4) + '" fill="' + seriesOf(id).color + '" stroke="var(--face)" stroke-width="2"/>').join('') + '</g>';
  }

  /* 速度グラフ一式。戻り値 {html, fr, xd, ids, val}。位置表示用の縦線と点（#speed-x / #speed-d-<id>）と #speed-tip 入り。
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
      bands: tr.corners.map(k => ({ x0: k.s0, x1: k.s1, no: k.no }))
    });
    const val = (id, i) => results[id].sim.v[i] * 3.6;
    return { html: lines(fr, tr, ids, selId, val, 'speed') + '</svg><div class="tip" id="speed-tip" hidden></div>', fr, xd, ids, val };
  }

  /* ホバー位置 i の値の一覧（ツールチップ用） */
  function tipHtml(tr, results, ids, selId, i) {
    return '<b>距離 ' + Math.round(tr.st[i]) + ' m</b>' + ids.map(id => {
      const s = seriesOf(id);
      return '<div class="row"' + (id === selId ? ' style="font-weight:700"' : '') + '>' + keyHtml(s) + '' + s.name + '<span class="v">' + (results[id].sim.v[i] * 3.6).toFixed(1) + ' km/h</span></div>';
    }).join('');
  }

  /* ---------- タイム差（中央との差の積み上げ） ---------- */
  /* 各ラインの点 i は中心線の点 i のオフセットなので、同じ i 同士で差を取れば同じ位置での差になる。
     戻り値 {id: Float64Array(N)}（baseId との t の差。マイナスが baseId より先行） */
  function deltaSeries(results, baseId, ids) {
    const base = results[baseId].sim.t, out = {};
    ids.forEach(id => { const t = results[id].sim.t, d = new Float64Array(t.length); for (let i = 0; i < t.length; i++) d[i] = t[i] - base[i]; out[id] = d; });
    return out;
  }
  /* タイム差グラフ一式。戻り値は speedPlot と同じ形（#delta-x / #delta-d-<id> / #delta-tip） */
  function deltaPlot(w, h, tr, results, ids, selId) {
    const ds = deltaSeries(results, 'center', ids);
    let lo = 0, hi = 0;
    ids.forEach(id => { const d = ds[id]; for (let i = 0; i < tr.N; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; } });
    if (hi - lo < 0.02) { hi += 0.01; lo -= 0.01; }
    const st = tickStep(hi - lo, 4), yd = [Math.floor(lo / st - 1e-9) * st, Math.ceil(hi / st + 1e-9) * st], dec = st < 0.1 ? 2 : 1;
    const xd = [0, tr.total], xs = tickStep(xd[1] - xd[0], Math.max(4, Math.min(10, w / 80)));
    const fr = frame(w, h, {
      xd, yd, xt: tickList(xd[0], xd[1], xs), yt: tickList(yd[0], yd[1], st), xf: t => String(Math.round(t)), yf: t => (Math.abs(t) < 1e-9 ? '0' : sgn(t, dec)),
      zero: true, marks: false, xtitle: '区間の距離（m）', aria: '中央ラインに対するタイム差の推移',
      bands: tr.corners.map(k => ({ x0: k.s0, x1: k.s1, no: k.no }))
    });
    const val = (id, i) => ds[id][i];
    return { html: lines(fr, tr, ids, selId, val, 'delta') + '</svg><div class="tip" id="delta-tip" hidden></div>', fr, xd, ids, val };
  }
  function deltaTipHtml(tr, results, ids, selId, i) {
    const ds = deltaSeries(results, 'center', ids);
    return '<b>距離 ' + Math.round(tr.st[i]) + ' m</b>' + ids.map(id => {
      const s = seriesOf(id);
      return '<div class="row"' + (id === selId ? ' style="font-weight:700"' : '') + '>' + keyHtml(s) + '' + s.name + '<span class="v">' + sgn(ds[id][i], 3) + ' 秒</span></div>';
    }).join('');
  }

  /* ---------- 位置の文・G-G 図・車両状態（荷重カード） ---------- */
  /* i を含むコーナー（無ければ null） */
  function cornerAt(tr, i) { return tr.corners.find(k => i >= k.i0 && i <= k.i1) || null; }
  /* 「③左R22 の 40% 地点」（コーナー内）／「区間 1,234 m 地点」（コーナー外） */
  function posText(tr, i) {
    const k = cornerAt(tr, i);
    if (k) return M.cornerLabel(k) + ' の ' + Math.round((i - k.i0) / Math.max(1, k.i1 - k.i0) * 100) + '% 地点';
    return '区間 ' + Math.round(tr.st[i]).toLocaleString('en-US') + ' m 地点';
  }
  /* 今いる場所の1行（スクラブの横）。コーナー内は「◇7 右 R7 の 40%」、外は「区間 1,234 m」、続けて速度 kmh（km/h） */
  function posHtml(tr, i, kmh) {
    const k = cornerAt(tr, i);
    const where = k
      ? M.cornerDiamond(k.no) + '<span>' + (k.dir === 'L' ? '左' : '右') + ' R' + Math.round(k.rMin) + ' の <b class="num">' + Math.round((i - k.i0) / Math.max(1, k.i1 - k.i0) * 100) + '</b>%</span>'
      : '<span>区間 <b class="num">' + Math.round(tr.st[i]).toLocaleString('en-US') + '</b> m</span>';
    return where + '<span class="pos-v"><b class="num">' + Math.round(kmh) + '</b> km/h</span>';
  }
  /* G-G 線図。sim = 選択中ラインの結果。戻り値 {html, cx, cy, k}（点は ggDot で置く） */
  function ggPlot(w, h, car, sim, color) {
    const gm = Math.ceil((car.mu + 0.3) * 2) / 2, rad = Math.max(0, Math.min(w, h) / 2 - 22), cx = w / 2, cy = h / 2, k = rad / gm, G = P.G;
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="選択中のラインの前後Gと横Gの軌跡">';
    for (let g = 0.5; g <= gm + 1e-9; g += 0.5) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + g * k + '" fill="none" stroke="var(--rule)"/><text x="' + (cx + 3) + '" y="' + (cy - g * k + 11) + '">' + g.toFixed(1) + ' G</text>';
    s += '<line x1="' + (cx - rad) + '" x2="' + (cx + rad) + '" y1="' + cy + '" y2="' + cy + '" stroke="var(--line-type)"/><line x1="' + cx + '" x2="' + cx + '" y1="' + (cy - rad) + '" y2="' + (cy + rad) + '" stroke="var(--line-type)"/>';
    s += '<text class="jp" x="' + cx + '" y="' + (cy - rad - 6) + '" text-anchor="middle">加速</text><text class="jp" x="' + cx + '" y="' + (cy + rad + 15) + '" text-anchor="middle">減速</text>';
    s += '<text class="jp" x="' + (cx - rad - 4) + '" y="' + (cy - 5) + '" text-anchor="start">左</text><text class="jp" x="' + (cx + rad + 4) + '" y="' + (cy - 5) + '" text-anchor="end">右</text>';
    const N = sim.v.length, stride = Math.max(1, Math.floor(N / 1500)), p = [];
    for (let i = 0; i < N; i += stride) p.push((cx - sim.ay[i] / G * k).toFixed(1) + ',' + (cy - sim.ax[i] / G * k).toFixed(1));
    s += '<polyline points="' + p.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>';
    s += '<circle id="ggdot" r="5" fill="var(--strong)" stroke="var(--face)" stroke-width="2"/></svg>';
    return { html: s, cx, cy, k };
  }
  /* 位置 i の G-G 図上の点 {x, y} */
  function ggDot(gg, sim, i) { return { x: gg.cx - sim.ay[i] / P.G * gg.k, y: gg.cy - sim.ax[i] / P.G * gg.k }; }

  /* 位置 i の車両状態（速度・G・4輪荷重・ロール・ピッチ・タイヤ使用率）の HTML */
  function stateHtml(car, sim, i) {
    const G = P.G, v = sim.v[i], ax = sim.ax[i], ay = sim.ay[i];
    const ts = P.tireState(car, v, ax, ay), kg = ts.Fz.map(f => f / G), full = car.m / 2;
    const roll = car.rollGrad * ay / G, pitch = car.pitchGrad * ax / G, EX = 4;
    const tire = (x, y, idx, anchor) => {
      const ratio = clampI(kg[idx] / full, 0, 1);
      return '<rect x="' + x + '" y="' + y + '" width="15" height="30" rx="4" fill="var(--text)" fill-opacity="' + (0.10 + 0.90 * ratio).toFixed(2) + '" stroke="var(--text)"/>' +
        '<text class="strong" x="' + (anchor === 'end' ? x - 6 : x + 21) + '" y="' + (y + 16) + '" text-anchor="' + anchor + '" style="font-size:14px">' + kg[idx].toFixed(0) + '</text>' +
        '<text x="' + (anchor === 'end' ? x - 6 : x + 21) + '" y="' + (y + 28) + '" text-anchor="' + anchor + '">kg</text>';
    };
    let s = '<svg viewBox="0 0 330 182" role="img" aria-label="4輪の荷重とロール・ピッチの様子" style="display:block;width:100%;height:auto;max-width:420px">';
    s += '<rect x="62" y="26" width="56" height="124" rx="16" fill="none" stroke="var(--line-type)" stroke-width="1.5"/><path d="M72 62 Q90 50 108 62" fill="none" stroke="var(--line-type)" stroke-width="1.5"/>';
    s += '<text class="jp" x="90" y="16" text-anchor="middle">前</text>';
    s += tire(44, 36, 0, 'end') + tire(121, 36, 1, 'start') + tire(44, 110, 2, 'end') + tire(121, 110, 3, 'start');
    s += '<text class="jp" x="90" y="174" text-anchor="middle">4輪の荷重</text>';
    /* 後ろから見た図（ロール） */
    s += '<text class="jp ink" x="255" y="16" text-anchor="middle">ロール ' + Math.abs(roll).toFixed(1) + '°' + (roll > 0.05 ? ' 右へ' : roll < -0.05 ? ' 左へ' : '') + '</text>';
    s += '<line x1="196" x2="314" y1="78" y2="78" stroke="var(--line-type)"/><rect x="206" y="60" width="11" height="18" rx="3" fill="var(--text)"/><rect x="293" y="60" width="11" height="18" rx="3" fill="var(--text)"/>';
    s += '<g transform="rotate(' + (roll * EX).toFixed(2) + ' 255 72)"><rect x="214" y="34" width="82" height="30" rx="8" fill="var(--face)" stroke="var(--strong)" stroke-width="1.5"/><rect x="230" y="26" width="50" height="12" rx="5" fill="var(--face)" stroke="var(--strong)" stroke-width="1.5"/></g>';
    /* 横から見た図（ピッチ）: 右が前 */
    s += '<text class="jp ink" x="255" y="106" text-anchor="middle">ピッチ ' + Math.abs(pitch).toFixed(1) + '°' + (pitch < -0.05 ? ' 前下がり' : pitch > 0.05 ? ' 後ろ下がり' : '') + '</text>';
    s += '<line x1="196" x2="314" y1="166" y2="166" stroke="var(--line-type)"/><circle cx="218" cy="157" r="9" fill="var(--text)"/><circle cx="290" cy="157" r="9" fill="var(--text)"/>';
    s += '<g transform="rotate(' + (-pitch * EX).toFixed(2) + ' 254 150)"><rect x="200" y="132" width="108" height="20" rx="7" fill="var(--face)" stroke="var(--strong)" stroke-width="1.5"/><path d="M226 132 L236 118 L272 118 L286 132" fill="var(--face)" stroke="var(--strong)" stroke-width="1.5" stroke-linejoin="round"/></g>';
    s += '<text class="jp" x="318" y="146" text-anchor="middle">前</text></svg>';
    const meter = (label, u) => '<div class="meter"><span>' + label + '</span><span class="track"><span class="fill' + (u >= 0.985 ? ' lim' : '') + '" style="display:block;width:' + clampI(u * 100, 0, 100).toFixed(0) + '%"></span></span><span class="val">' + (u * 100).toFixed(0) + '%' + (u >= 0.985 ? ' 限界' : '') + '</span></div>';
    return '<div style="display:grid;gap:12px">' +
      '<div class="stats"><div class="stat"><div class="l">速度</div><div class="v">' + (v * 3.6).toFixed(1) + '<small>km/h</small></div></div>' +
      '<div class="stat"><div class="l">前後G（＋加速）</div><div class="v">' + sgn(ax / G, 2) + '<small>G</small></div></div>' +
      '<div class="stat"><div class="l">横G</div><div class="v">' + Math.abs(ay / G).toFixed(2) + '<small>G</small></div></div></div>' + s +
      '<div style="display:grid;gap:6px"><div class="sub">タイヤの使用率（グリップをどれだけ使っているか）</div>' + meter('フロント', ts.uF) + meter('リア', ts.uR) + '</div>' +
      '<p class="sub">ロールとピッチの図は、傾きを ' + EX + ' 倍に誇張しています。</p></div>';
  }

  return { SERIES, seriesOf, sgn, clampI, keyHtml, verdictInfo, verdictText, verdictHtml, plateHtml, legendHtml, cornerLinkUrl, tableHtml, tickStep, tickList, frame, speedPlot, tipHtml, deltaSeries, deltaPlot, deltaTipHtml, cornerAt, posText, posHtml, ggPlot, ggDot, stateHtml };
})();

if (typeof module !== 'undefined') module.exports = SectionRender;
