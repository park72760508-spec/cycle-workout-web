import { readFileSync } from 'node:fs';
import { env } from './util.mjs';

const BUCKET = 'instagram-media';

/** Supabase Storage(공개 버킷)에 올리고 공개 URL 반환 — 인스타 API 는 공개 URL 의 영상을 가져간다 */
export async function uploadPublic(localPath, remotePath, contentType = 'video/mp4') {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_KEY');
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${remotePath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'content-type': contentType, 'x-upsert': 'true' },
    body: readFileSync(localPath)
  });
  if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${await res.text()}`);
  return `${base}/storage/v1/object/public/${BUCKET}/${remotePath}`;
}
