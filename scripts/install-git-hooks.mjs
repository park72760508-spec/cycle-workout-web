#!/usr/bin/env node
/**
 * scripts/git-hooks/* 를 .git/hooks/ 로 설치한다.
 * .git/hooks 디렉터리는 git으로 버전 관리되지 않으므로, 이 저장소를 새로 clone하거나
 * 다른 작업 폴더에서 작업할 때는 한 번씩 다시 실행해야 훅이 활성화된다.
 *
 * 사용법: node scripts/install-git-hooks.mjs  (또는 npm --prefix scripts run install-hooks)
 */
import { copyFileSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
const srcDir = resolve(__dirname, 'git-hooks');
const destDir = resolve(repoRoot, '.git', 'hooks');

if (!existsSync(destDir)) {
  console.error('.git/hooks 디렉터리를 찾을 수 없습니다: ' + destDir);
  process.exit(1);
}

for (const name of readdirSync(srcDir)) {
  const src = join(srcDir, name);
  const dest = join(destDir, name);
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log('설치됨: ' + name + ' -> ' + dest);
}
