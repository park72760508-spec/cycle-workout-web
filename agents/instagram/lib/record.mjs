import { mkdirSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { env, sleep } from './util.mjs';

/** 카탈로그 steps 실행: screen / eval / click / wait / scroll */
async function runStep(page, st) {
  if (st.screen) await page.evaluate((id) => window.showScreen(id), st.screen);
  else if (st.eval) await page.evaluate(st.eval);
  else if (st.click) await page.click(st.click, { timeout: 8000 });
  else if (st.scroll != null) await page.evaluate((y) => { const s = document.querySelector('.screen.active') || document.scrollingElement; (s.scrollBy ? s : window).scrollBy(0, y); }, st.scroll);
  else if (st.wait) await sleep(st.wait);
}

/** 한 게시물의 장면을 한 번에 녹화. 반환 { webm, trimStart, scenes:[{sub,start,end}] } (초 단위, 영상 시작 기준) */
export async function recordPost(post, cfg, outDir) {
  mkdirSync(outDir, { recursive: true });
  const stateB64 = env('STELVIO_STORAGE_STATE', false);
  let storageState;
  if (stateB64) { storageState = join(outDir, 'state.json'); writeFileSync(storageState, Buffer.from(stateB64, 'base64')); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: cfg.viewport, recordVideo: { dir: outDir, size: cfg.viewport }, storageState, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  await page.goto(cfg.site, { waitUntil: 'domcontentloaded' });
  await sleep(3500);
  for (let i = 0; i < 4; i++) { // 앱 시작 안내 팝업 닫기
    const closed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.innerText.trim() === '닫기'); if (b) b.click(); return !!b; });
    if (!closed) break;
    await sleep(500);
  }
  const trimStart = now();
  const scenes = [];
  for (const sc of post.scenes) {
    const item = cfg.catalog.find((c) => c.id === sc.ref);
    const start = now();
    for (const st of item.steps) await runStep(page, st);
    const spent = now() - start;
    if (spent < item.sec) await sleep((item.sec - spent) * 1000);
    scenes.push({ sub: sc.sub, start, end: now() });
  }
  const video = page.video();
  await ctx.close(); // 닫아야 영상 파일이 확정된다
  await browser.close();
  const webm = join(outDir, `${post.id}.webm`);
  renameSync(await video.path(), webm);
  return { webm, trimStart, scenes };
}

/** 로그인 세션 저장(사람이 직접 로그인) → STELVIO_STORAGE_STATE 비밀값용 base64 출력 */
export async function loginAndExport(cfg, outFile) {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.goto(cfg.site);
  console.log('열린 브라우저에서 영상 촬영용 계정으로 로그인한 뒤, 홈 화면이 보이면 이 터미널에서 Enter 를 누르세요.');
  await new Promise((r) => process.stdin.once('data', r));
  await ctx.storageState({ path: outFile, indexedDB: true });
  await browser.close();
  console.log(`저장됨: ${outFile}\n비밀값 등록: base64 -i ${outFile} | gh secret set STELVIO_STORAGE_STATE`);
}
