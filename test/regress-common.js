/* 回帰テストの共通部分: 車種・コーナーの組と、1組あたりの区間タイムの求め方 */
const { loadPresets } = require('./load-engine');

const CARS = ['grb', 'gr86', 'nd', 'fl5', 'gry'];
const CORNERS = ['hair', 'mid', 'high'];

/* key は 'grb-hair' のような「車種-コーナー」。runLine 相当（makeLine → simulate）の time を返す */
function timeOf(E, key) {
  const { CAR_PRESETS, CORNER_PRESETS } = loadPresets();
  const [c, k] = key.split('-');
  const corner = CORNER_PRESETS[k].v;
  const tr = E.buildTrack(corner);
  const line = E.makeLine(tr, { entry: 1, exit: 1, apex: null });
  return E.simulate(tr, line, E.deriveCar(CAR_PRESETS[c].v), corner.vIn / 3.6).time;
}

module.exports = { CARS, CORNERS, timeOf };
