/**
 * cdn.tailwindcss.com 런타임 JIT(index.html에서 로드)을 대체하는 정적 빌드용 설정.
 * 커스텀 theme.extend 없음 — 기존 CDN도 기본(default) 팔레트만 썼다(index.html에
 * `tailwind.config = {...}` 커스텀 설정이 전혀 없었음, 2026-08 확인).
 * CDN이 서빙하던 버전과 동일한 3.4.17을 devDependency로 고정해 동일 유틸리티 세트를 보장한다.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  /* content 경로는 CLI 실행 시 cwd(=repo root, scripts/build-tailwind.mjs가 고정)를 기준으로 풀린다. */
  content: [
    './index.html',
    './assets/js/**/*.jsx',
    './assets/js/**/*.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
