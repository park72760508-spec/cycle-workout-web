// 루트맵 속도 추정기 모의 시험(GPS만 vs GPS+걸음). 실행: node scripts/diag/outdoor-speed-sim.cjs
const F = require('../../assets/js/outdoorSpeedFilter.js');
let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const LAT0 = 37.5, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
function run(name, profile, acc, devSigma, devAvail, walking) {
  const fix = []; let x = 0, ex = 0, ey = 0, t = 0, lastStepT = -1e9, walkSeenT = -1e9;
  for (const [dur, v] of profile) for (let i = 0; i < dur; i++) {
    t += 1000; x += v; const sp = acc / 2; ex = 0.8 * ex + gauss() * sp * 0.6; ey = 0.8 * ey + gauss() * sp * 0.6;
    let dev = null; if (rnd() < devAvail) dev = v > 0 ? Math.max(0, v + gauss() * devSigma) : Math.abs(gauss()) * 0.08;
    const isWalk = walking && v > 0; if (isWalk) { lastStepT = t - rnd() * 500; if (rnd() < 0.95) walkSeenT = t; }
    fix.push({ t, lat: LAT0 + ey / KY, lng: 127 + (x + ex) / KX, acc, speed: dev, truth: v * 3.6, isWalk, lastStepT, walkSeenT });
  }
  const motionAt = (f, tt) => walking ? { available: true, walkingNow: f.isWalk && f.walkSeenT === f.t, lastStepAgo: tt - f.lastStepT, cadence: f.isWalk ? 110 : 0, walkContext: tt - f.walkSeenT <= 60000 } : null;
  const res = {};
  for (const useM of [false, true]) {
    const s = F.create(); if (/자전거/.test(name)) s.mode = 'bike'; let zero = 0, mov = 0, err = 0, fake = 0, st = 0, lag = [], since = null, prev = 0, jerk = 0;
    fix.forEach((f, i) => {
      if (useM) { const m = motionAt(fix[Math.max(0, i - 1)], f.t - 500); if (F.motionTick(s, m)) {} }
      const k = F.step(s, f, useM ? motionAt(f, f.t) : null); const out = k < 0.5 ? 0 : k;
      if (f.truth > 0 && i > 8) { mov++; if (out === 0) zero++; err += Math.abs(out - f.truth); jerk += Math.abs(out - prev); }
      if (f.truth === 0) { st++; if (out > 0) fake++; }
      if (i > 0 && fix[i - 1].truth > 0 && f.truth === 0) since = i;
      if (since != null && out === 0) { lag.push(i - since + 0.5); since = null; }
      prev = out;
    });
    res[useM ? 'M' : 'G'] = { zero: (100 * zero / mov).toFixed(1) + '%', err: (err / mov).toFixed(2), jerk: (jerk / mov).toFixed(2), lag: lag.length ? (lag.reduce((a, b) => a + b, 0) / lag.length).toFixed(1) + 's' : '-', fake: (100 * fake / st).toFixed(1) + '%' };
  }
  console.log(name.padEnd(28), '| 이동중0 GPS만', res.G.zero.padStart(6), '+걸음', res.M.zero.padStart(6), '| 오차', res.G.err, '→', res.M.err, '| 정지지연', res.G.lag, '→', res.M.lag, '| 정지중속도', res.G.fake, '→', res.M.fake);
}
const walk = (v) => [[10, 0], [120, v], [15, 0], [120, v], [15, 0], [90, v], [10, 0]];
run('걷기 3km/h 정확도8', walk(0.83), 8, 0.25, 0.95, true);
run('걷기 2km/h 정확도10', walk(0.56), 10, 0.25, 0.95, true);
run('걷기 4km/h 정확도15', walk(1.11), 15, 0.3, 0.9, true);
run('걷기 3km/h 정확도18', walk(0.83), 18, 0.35, 0.9, true);
run('걷기 3km/h 도플러없음 정확도10', walk(0.83), 10, 0.3, 0, true);
run('자전거 20km/h(걸음없음)', [[10, 0], [60, 2], [120, 5.6], [20, 0]], 6, 0.3, 0.95, false);
