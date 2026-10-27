// 루트맵 걸음 감지기 모의 시험(인공 가속도 신호). 실행: node scripts/diag/outdoor-step-sim.cjs
const D = require('../../assets/js/outdoorStepDetector.js');
let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function run(name, secs, sig) {
  const c = D._createCore(); let steps = 0, walkNowN = 0, n = 0; const hz = 60;
  for (let i = 0; i < secs * hz; i++) { const t = 1e6 + i * 1000 / hz; if (D._feed(c, sig(i / hz), t)) steps++; if (i % hz === 0 && i > 3 * hz) { n++; if (D._stateOf(c, t, true).walkingNow) walkNowN++; } }
  console.log(name.padEnd(30), '걸음', String(steps).padStart(4), '| 초당', (steps / secs).toFixed(2), '| 걷는중 판정', (100 * walkNowN / n).toFixed(0) + '%');
}
const G = 9.81; let ph = 0;
run('보통 걷기 1.8Hz 손에 듦', 60, t => G + 1.8 * Math.sin(2 * Math.PI * 1.8 * t) + 0.6 * Math.sin(2 * Math.PI * 3.6 * t + 1) + gauss() * 0.35);
run('느린 걷기 1.3Hz 약하게', 60, t => G + 0.9 * Math.sin(2 * Math.PI * 1.3 * t) + gauss() * 0.25);
run('주머니 걷기 2.0Hz 강하게', 60, t => G + 4.5 * Math.sin(2 * Math.PI * 2.0 * t) + 1.5 * Math.sin(2 * Math.PI * 4 * t) + gauss() * 0.6);
run('손에 들고 서 있기', 60, t => G + gauss() * 0.12 + 0.15 * Math.sin(2 * Math.PI * 0.3 * t));
run('자전거 핸들 거치 진동', 60, t => G + gauss() * 1.2);
run('자전거 핸들 노면 큰 진동', 60, t => G + gauss() * 2.5);
run('책상 위', 60, t => G + gauss() * 0.03);
run('느린 걷기 1.2Hz 아주 약하게', 60, t => G + 0.6 * Math.sin(2 * Math.PI * 1.2 * t) + gauss() * 0.2);
run('빠른 걷기·조깅 2.6Hz', 60, t => G + 5 * Math.sin(2 * Math.PI * 2.6 * t) + gauss() * 0.8);
