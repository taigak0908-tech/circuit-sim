/* ===== ヘッダー帯: 昼／夜の切替と、スマホでスクロールしたときの縮小（index.html と section.html で共有） =====
   <head> で同期読み込みする（描画前に <html data-theme> を決めて、昼夜のちらつきを出さない）。
   既定は端末の設定（prefers-color-scheme）。ヘッダーの「昼」「夜」で上書きし、localStorage に保存する。
   切り替えたら document に 'themechange'（detail.theme = 'night' | 'day'）を投げる。地図やグラフはこれで描き直す。 */
(function () {
  const KEY = 'circuit-sim-theme';
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let chosen = null;   // 本人が選んだもの（無ければ端末の設定に従う）
  try { const v = localStorage.getItem(KEY); if (v === 'night' || v === 'day') chosen = v; } catch (e) { /* 保存領域が使えなくても動く */ }
  const system = () => (mq && !mq.matches ? 'day' : 'night');
  const current = () => root.getAttribute('data-theme');

  function syncButtons() {
    ['day', 'night'].forEach(t => { const b = document.getElementById('theme-' + t); if (b) b.setAttribute('aria-pressed', String(current() === t)); });
  }
  function apply(t) {
    if (current() === t) return;
    root.setAttribute('data-theme', t);
    syncButtons();
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
  }
  root.setAttribute('data-theme', chosen || system());
  if (mq) {
    const onSys = () => { if (!chosen) apply(system()); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  }

  /* スマホ幅でスクロールしたら .is-shrunk を付ける（区間名と黄色い板だけの1行に縮む。見た目は css/theme.css）。
     縮むと上の高さが変わってスクロール量も動くので、付ける所と外す所を離して行ったり来たりしないようにする */
  function bindShrink() {
    const hd = document.querySelector('.hd'); if (!hd) return;
    let shrunk = false, ticking = false;
    const check = () => {
      ticking = false;
      const y = window.scrollY || 0;
      const next = shrunk ? y > 24 : y > 140;
      if (next !== shrunk) { shrunk = next; hd.classList.toggle('is-shrunk', shrunk); }
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    check();
  }

  document.addEventListener('DOMContentLoaded', () => {
    syncButtons();
    ['day', 'night'].forEach(t => {
      const b = document.getElementById('theme-' + t);
      if (b) b.addEventListener('click', () => {
        chosen = t;
        try { localStorage.setItem(KEY, t); } catch (e) { /* 保存できなくても切り替えは効く */ }
        apply(t);
      });
    });
    bindShrink();
  });
  window.CircuitTheme = { get: current };
})();
