/**
 * 나의 기록 화면 8아이콘 PNG → WebP 일괄 변환 (assets/img 기준)
 *
 * 사용법 (이 폴더에서):
 *   npm install
 *   node convert-career-icons-to-webp.mjs
 *
 * 옵션:
 *   node convert-career-icons-to-webp.mjs --report-small
 *     → 10KB 이하 PNG는 Base64 data URL로 인라인할 후보로 stdout에 안내
 *
 * Base64 인라인 예시 (요청 수 줄이기, HTML 길이는 증가):
 *   const src = 'data:image/png;base64,' + fs.readFileSync('X.png').toString('base64');
 *   <img src={src} width="256" height="256" alt="" fetchpriority="high" />
 *   WebP도 동일하게 data:image/webp;base64,... 가능 (브라우저 호환만 확인)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets', 'img');

const CAREER_ICON_NAMES = [
  'WORKOUT',
  'LOGS',
  'SCHEDULE',
  'DASHBOARD',
  'INFO',
  'SUBSCRIBE',
  'RANKING1',
  'SETTINGS2',
];

const SMALL_PNG_BYTES = 10 * 1024;
const reportSmall = process.argv.includes('--report-small');

async function main() {
  if (!fs.existsSync(IMG_DIR)) {
    console.error('폴더 없음:', IMG_DIR);
    process.exit(1);
  }

  for (const base of CAREER_ICON_NAMES) {
    const pngPath = path.join(IMG_DIR, `${base}.png`);
    if (!fs.existsSync(pngPath)) {
      console.warn('[skip] PNG 없음:', pngPath);
      continue;
    }

    const stat = fs.statSync(pngPath);
    if (reportSmall && stat.size <= SMALL_PNG_BYTES) {
      const b64 = fs.readFileSync(pngPath).toString('base64');
      console.log(
        `[small ${stat.size}B] ${base}.png → data URL 길이 ${b64.length}자 — 인라인 후보`
      );
    }

    const webpPath = path.join(IMG_DIR, `${base}.webp`);
    await sharp(pngPath)
      .webp({ quality: 82, effort: 6 })
      .toFile(webpPath);

    const outStat = fs.statSync(webpPath);
    console.log(`OK ${base}.webp (${outStat.size} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
