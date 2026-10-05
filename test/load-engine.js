/* index.html のエンジン部（DOM非依存）を Node で評価して取り出す。
   js/physics.js があれば先頭に連結する（切り出し前は index.html の中にある）。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function loadEngine() {
  const html = read('index.html');
  const a = html.indexOf('/* ===== 計算エンジン');
  const b = html.indexOf('/* ===== 画面');
  if (a < 0 || b < 0) throw new Error('index.html にエンジン部の目印コメントが見つからない');
  /* 旧い module.exports 行は評価前に落とし、公開する関数名は下で明示的に return する */
  const engine = html.slice(a, b).replace(/^if \(typeof module !== 'undefined'\).*$/m, '');
  const physicsPath = path.join(root, 'js', 'physics.js');
  const physics = fs.existsSync(physicsPath) ? fs.readFileSync(physicsPath, 'utf8') + '\n' : '';
  const src = physics + engine + '\nreturn { buildTrack, makeLine, deriveCar, simulate };';
  return new Function('module', src)({ exports: {} });
}

/* 画面部の CAR_PRESETS / CORNER_PRESETS を index.html から読み取る（値の二重管理を避ける） */
function loadPresets() {
  const html = read('index.html');
  const grab = name => {
    const m = html.match(new RegExp('const ' + name + ' = (\\{[\\s\\S]*?\\r?\\n  \\});'));
    if (!m) throw new Error(name + ' が index.html に見つからない');
    return new Function('return ' + m[1])();
  };
  return { CAR_PRESETS: grab('CAR_PRESETS'), CORNER_PRESETS: grab('CORNER_PRESETS') };
}

module.exports = { loadEngine, loadPresets };
