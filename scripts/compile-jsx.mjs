#!/usr/bin/env node
/**
 * 브라우저에서 실시간으로 돌아가는 @babel/standalone의 "stelvio-react-classic" 프리셋
 * (assets/js/babelReactClassicBoot.js 참고: preset-env modules:false + preset-react classic runtime)
 * 과 동일한 설정으로 .jsx 파일을 사전 컴파일한다.
 *
 * 사용법:
 *   node scripts/compile-jsx.mjs <입력.jsx> [출력.js]   — 파일 1개 지정 컴파일
 *   node scripts/compile-jsx.mjs --all                  — JSX_MANIFEST 전체 재컴파일 (git pre-commit 훅에서 사용)
 *   출력 생략 시 <입력파일명>.compiled.js 로 저장된다.
 *
 * 500KB를 넘는 JSX는 브라우저 Babel 코드 생성기가 deoptimize되어 매 페이지 로드마다
 * 변환 비용이 크므로, 이런 파일은 빌드 시점에 한 번 컴파일해두고 index.html에서
 * type="text/babel" 대신 일반 <script src="...compiled.js">로 로드한다.
 *
 * 새로 500KB를 넘는 JSX가 생기면 JSX_MANIFEST 배열에 경로만 추가하면 --all / pre-commit 훅에 자동 포함된다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export const JSX_MANIFEST = ['assets/js/openRiding/OpenRidingScreens.jsx'];

function compileOne(inputArg, outputArg) {
  const inputPath = resolve(repoRoot, inputArg);
  const outputPath = outputArg
    ? resolve(repoRoot, outputArg)
    : resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + '.compiled.js');

  const source = readFileSync(inputPath, 'utf8');

  const result = babel.transformSync(source, {
    filename: inputPath,
    babelrc: false,
    configFile: false,
    presets: [
      [require('@babel/preset-env'), { modules: false }],
      [
        require('@babel/preset-react'),
        { runtime: 'classic', pragma: 'React.createElement', pragmaFrag: 'React.Fragment' },
      ],
    ],
    retainLines: false,
  });

  if (!result || typeof result.code !== 'string') {
    throw new Error('컴파일 실패(출력 없음): ' + inputArg);
  }

  const header =
    '/* AUTO-GENERATED — 직접 수정 금지.\n' +
    ' * 원본: ' + inputArg.replace(/\\/g, '/') + '\n' +
    ' * 재생성: node scripts/compile-jsx.mjs ' + inputArg.replace(/\\/g, '/') + '\n' +
    ' */\n';

  writeFileSync(outputPath, header + result.code + '\n');
  const relOut = outputPath.replace(repoRoot + '/', '');
  console.log('컴파일 완료: ' + inputArg + ' -> ' + relOut + ' (' + result.code.length + ' bytes)');
  return relOut;
}

/** git pre-commit 훅 전용: staged 파일 중 JSX_MANIFEST 원본이 있으면 재컴파일 후 결과물을 같이 staging */
function runPreCommit() {
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const stagedSet = new Set(staged);
  const toCompile = JSX_MANIFEST.filter((src) => stagedSet.has(src));
  if (!toCompile.length) return;

  console.log('[pre-commit] 변경된 대용량 JSX 재컴파일: ' + toCompile.join(', '));
  const outputs = toCompile.map((src) => compileOne(src));
  execFileSync('git', ['add', ...outputs], { cwd: repoRoot });
}

function main() {
  const [, , first, second] = process.argv;
  if (!first) {
    console.error(
      '사용법: node scripts/compile-jsx.mjs <입력.jsx> [출력.js]  또는  node scripts/compile-jsx.mjs --all'
    );
    process.exit(1);
  }
  if (first === '--pre-commit') {
    runPreCommit();
    return;
  }
  if (first === '--all') {
    for (const src of JSX_MANIFEST) compileOne(src);
    return;
  }
  compileOne(first, second);
}

// ESM 진입점 판별: 이 파일이 직접 실행됐을 때만 main() 수행 (다른 스크립트가 import해서 JSX_MANIFEST만 재사용할 수 있도록)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
