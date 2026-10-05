const { test, assert } = require('./harness');
const { createStore } = require('../js/store');

/* メモリ実装のストレージ（localStorage の代わり） */
const memStorage = () => {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
};
const sec = (name, extra) => Object.assign({
  name, points: { start: { lat: 36.7, lng: 139.5 }, end: { lat: 36.8, lng: 139.4 }, vias: [] },
  manual: false, W: 6.5, laneMode: 'full', vIn: 60, preset: 'grb', carP: { mass: 1550 }, params: [], paramsEdited: false, total: 1234
}, extra);

test('store: 保存 → 一覧 → 取得 → 削除', () => {
  const st = createStore(memStorage());
  assert.deepEqual(st.listSections(), []);
  const id = st.saveSection(sec('峠A'));
  assert.ok(typeof id === 'string' && id.length >= 3);
  const list = st.listSections();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, '峠A');
  assert.equal(list[0].total, 1234);
  assert.ok(!isNaN(Date.parse(list[0].savedAt)), 'savedAt は ISO 文字列');
  const got = st.getSection(id);
  assert.equal(got.W, 6.5);
  assert.deepEqual(got.points.start, { lat: 36.7, lng: 139.5 });
  assert.equal(st.getSection('nothing'), null);
  st.deleteSection(id);
  assert.deepEqual(st.listSections(), []);
  assert.equal(st.getSection(id), null);
});

test('store: id があれば上書き、無ければ別の id で追加', () => {
  const st = createStore(memStorage());
  const a = st.saveSection(sec('A'));
  const b = st.saveSection(sec('B'));
  assert.ok(a !== b);
  const a2 = st.saveSection(Object.assign(sec('A改'), { id: a, W: 8 }));
  assert.equal(a2, a);
  assert.equal(st.listSections().length, 2);
  assert.equal(st.getSection(a).name, 'A改');
  assert.equal(st.getSection(a).W, 8);
});

test('store: 別のストア（同じストレージ）からも読める', () => {
  const ms = memStorage();
  const id = createStore(ms).saveSection(sec('共有'));
  assert.equal(createStore(ms).getSection(id).name, '共有');
});

test('store: storage が null でも例外なし（保存は null、一覧は空）', () => {
  const st = createStore(null);
  assert.deepEqual(st.listSections(), []);
  assert.equal(st.saveSection(sec('x')), null);
  assert.equal(st.getSection('a'), null);
  st.deleteSection('a');
});

test('store: getItem / setItem が例外を投げても落ちない', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  const st = createStore(bad);
  assert.deepEqual(st.listSections(), []);
  assert.equal(st.saveSection(sec('x')), null);
  st.deleteSection('a');
});

test('store: JSON が壊れていても空扱いで、保存すれば直る', () => {
  const ms = memStorage();
  ms.setItem('section-sim-v1', '{broken');
  const st = createStore(ms);
  assert.deepEqual(st.listSections(), []);
  ms.setItem('section-sim-v1', JSON.stringify({ sections: 'x' }));
  assert.deepEqual(st.listSections(), []);
  const id = st.saveSection(sec('復旧'));
  assert.equal(st.listSections().length, 1);
  assert.equal(st.getSection(id).name, '復旧');
});
