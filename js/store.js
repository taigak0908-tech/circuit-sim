/* ===== 区間の保存（localStorage） =====
   DOM・地図には触らない。ブラウザではグローバル（createStore / sectionStore）、Node では module.exports。
   storage が無い・壊れている・例外を投げる場合は、すべて「空」扱いにして落ちない。 */
const STORE_KEY = 'section-sim-v1';

/* storage = {getItem, setItem, removeItem} を持つもの（localStorage か、テスト用のメモリ実装）。null でもよい */
function createStore(storage) {
  function load() {
    try {
      const j = JSON.parse(storage.getItem(STORE_KEY));
      return j && Array.isArray(j.sections) ? j.sections : [];
    } catch (e) { return []; }
  }
  function write(list) {
    try { storage.setItem(STORE_KEY, JSON.stringify({ sections: list })); return true; } catch (e) { return false; }
  }
  const newId = () => Date.now().toString(36) + String(Math.floor(Math.random() * 100)).padStart(2, '0');

  /* 一覧（新しい保存が上）。[{id, name, savedAt, total}] */
  function listSections() {
    return load().map(s => ({ id: s.id, name: s.name, savedAt: s.savedAt, total: s.total }))
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  }
  function getSection(id) { return load().find(s => s.id === id) || null; }
  /* id があれば上書き、無ければ追加。保存した id を返す（保存できなければ null） */
  function saveSection(obj) {
    if (!storage || !obj) return null;
    const list = load();
    const rec = Object.assign({}, obj, { savedAt: new Date().toISOString() });
    const at = obj.id ? list.findIndex(s => s.id === obj.id) : -1;
    if (at >= 0) list[at] = rec;
    else { rec.id = obj.id || newId(); while (list.some(s => s.id === rec.id)) rec.id = newId(); list.push(rec); }
    return write(list) ? rec.id : null;
  }
  function deleteSection(id) {
    if (!storage) return;
    const list = load(), rest = list.filter(s => s.id !== id);
    if (rest.length !== list.length) write(rest);
  }
  return { listSections, getSection, saveSection, deleteSection };
}

/* ブラウザ用の既定ストア（localStorage にアクセスするだけで例外が出る環境も許す） */
let sectionStore = null;
if (typeof window !== 'undefined') {
  let ls = null;
  try { ls = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { ls = null; }
  sectionStore = createStore(ls);
}

if (typeof module !== 'undefined') module.exports = { createStore };
