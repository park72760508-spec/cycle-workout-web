#!/usr/bin/env node
/**
 * cdn.tailwindcss.com 런타임 JIT(브라우저에서 MutationObserver로 문서 전체를 감시하며
 * 매번 CSS를 생성 — Tailwind 공식 문서가 프로덕션에 쓰지 말라고 명시하는 방식이자,
 * iOS Safari에서 발열 요인 중 하나로 지목됨)를 대체하는 정적 CSS 빌드.
 *
 * index.html/assets/js/**\/*.{js,jsx}에서 쓰인 Tailwind 유틸리티 클래스만 스캔해
 * assets/css/tailwind-build.css로 미리 컴파일해둔다. index.html은 이 파일을 <link>로
 * 로드하고, cdn.tailwindcss.com <script>는 제거한다.
 *
 * 사용법: node scripts/build-tailwind.mjs  (또는 npm --prefix scripts run build-tailwind)
 *
 * 새 화면·컴포넌트에 Tailwind 클래스를 추가했다면 이 스크립트를 다시 실행해야
 * assets/css/tailwind-build.css에 반영된다 (pre-commit 훅에서 자동 실행됨).
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const cliBin = resolve(__dirname, 'node_modules', '.bin', 'tailwindcss');
const configPath = resolve(__dirname, 'tailwind.config.js');
const inputPath = resolve(__dirname, 'tailwind-input.css');
const outputPath = resolve(repoRoot, 'assets', 'css', 'tailwind-build.css');

if (!existsSync(cliBin)) {
  console.error('tailwindcss CLI를 찾을 수 없습니다. scripts/에서 `npm install`을 먼저 실행하세요.');
  process.exit(1);
}

execFileSync(
  cliBin,
  ['--config', configPath, '--input', inputPath, '--output', outputPath, '--minify'],
  { cwd: repoRoot, stdio: 'inherit' }
);

const sizeKb = Math.round(statSync(outputPath).size / 1024);
console.log('Tailwind 빌드 완료: assets/css/tailwind-build.css (' + sizeKb + 'KB)');
