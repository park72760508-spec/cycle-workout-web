import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT = process.env.FONT_PATH || '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc';

/** 자막 줄바꿈: 공백 기준 한 줄 최대 n자 */
export function wrapSub(text, n = 14) {
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

/** ffmpeg 인자: 녹화(webm) → 9:16 1080x1920 H.264 + 무음 AAC + 장면별 자막. 순수 함수(테스트용) */
export function buildFfmpegArgs({ input, output, trimStart, duration, subs, fontPath = FONT }) {
  const draw = subs.map((s) =>
    `drawtext=fontfile='${fontPath}':textfile='${s.file}':fontcolor=white:fontsize=58:line_spacing=12:box=1:boxcolor=black@0.6:boxborderw=26:x=(w-text_w)/2:y=h-h*0.2:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'`);
  const vf = ['scale=1080:1920:flags=lanczos', 'setsar=1', ...draw, 'format=yuv420p'].join(',');
  return ['-y', '-ss', String(trimStart), '-t', String(duration), '-i', input,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', vf, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', output];
}

export function compose({ input, outDir, name, trimStart, scenes }) {
  mkdirSync(outDir, { recursive: true });
  const subs = scenes.map((s, i) => {
    const file = join(outDir, `${name}-sub${i}.txt`);
    writeFileSync(file, wrapSub(s.sub));
    return { file, start: s.start - trimStart, end: s.end - trimStart };
  });
  const duration = scenes[scenes.length - 1].end - trimStart + 0.8;
  const output = join(outDir, `${name}.mp4`);
  execFileSync('ffmpeg', buildFfmpegArgs({ input, output, trimStart, duration, subs }), { stdio: 'inherit' });
  return { output, duration };
}
