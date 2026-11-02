#!/usr/bin/env node
/**
 * 루트맵 지하철·버스 데이터 갱신 후 캐시 버전 올리기 (2026-11-02)
 * 사용: node scripts/bump-transit-data-version.mjs [--subway] [--bus]
 *  --subway : outdoorRide.js 의 kr-subway.json?v= 값
 *  --bus    : outdoorRide.js 의 BUS_DATA_V 값
 *  둘 중 하나라도 바뀌면 index.html 의 outdoorRide.js?v= 도 함께 올린다(GitHub Pages 캐시).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const JS = path.join(ROOT, 'assets/js/outdoorRide.js');
const HTML = path.join(ROOT, 'index.html');
const args = new Set(process.argv.slice(2));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

let js = fs.readFileSync(JS, 'utf8');
let changed = false;
if (args.has('--subway')) {
  js = js.replace(/kr-subway\.json\?v=[\w-]+/, 'kr-subway.json?v=' + stamp + 'auto');
  js = js.replace(/kr-subway-lines\.json\?v=[\w-]+/, 'kr-subway-lines.json?v=' + stamp + 'auto');
  changed = true;
}
if (args.has('--bus')) {
  js = js.replace(/var BUS_DATA_V = '[\w-]+';/, "var BUS_DATA_V = '" + stamp + "auto';");
  changed = true;
}
if (!changed) { console.log('올릴 항목 없음'); process.exit(0); }
fs.writeFileSync(JS, js);

const html = fs.readFileSync(HTML, 'utf8').replace(/assets\/js\/outdoorRide\.js\?v=[\w-]+/, 'assets/js/outdoorRide.js?v=' + stamp + 'transit');
fs.writeFileSync(HTML, html);
console.log('버전 갱신:', [...args].join(' '), stamp);
