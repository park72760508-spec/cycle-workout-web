import { env, sleep } from './util.mjs';

/** 페이지 연결 계정: https://graph.facebook.com/v23.0 (기본), Instagram 로그인 토큰이면 GRAPH_HOST 로 지정 */
const host = () => process.env.GRAPH_HOST || 'https://graph.facebook.com/v23.0';

async function call(method, path, params = {}) {
  const url = new URL(host() + path);
  const body = new URLSearchParams();
  const p = { ...params, access_token: env('IG_ACCESS_TOKEN') };
  for (const [k, v] of Object.entries(p)) (method === 'GET' ? url.searchParams : body).set(k, String(v));
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Graph ${method} ${path}: ${(j.error && j.error.message) || res.status}`);
  return j;
}

/** 릴스 게시: 컨테이너 생성 → 처리 완료 대기 → 게시. 반환 { id, permalink } */
export async function publishReel({ videoUrl, caption }) {
  const igId = env('IG_USER_ID');
  const c = await call('POST', `/${igId}/media`, { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' });
  for (let i = 0; i < 60; i++) { // 최대 ~10분
    const s = await call('GET', `/${c.id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`릴스 처리 실패: ${s.status || s.status_code}`);
    await sleep(10000);
  }
  const m = await call('POST', `/${igId}/media_publish`, { creation_id: c.id });
  const info = await call('GET', `/${m.id}`, { fields: 'permalink' });
  return { id: m.id, permalink: info.permalink };
}

/** 최근 게시물 성과 */
export async function recentInsights(limit = 12) {
  const igId = env('IG_USER_ID');
  const list = await call('GET', `/${igId}/media`, { fields: 'id,caption,permalink,timestamp,like_count,comments_count', limit });
  const out = [];
  for (const m of list.data || []) {
    let reach, saved, plays;
    try {
      const ins = await call('GET', `/${m.id}/insights`, { metric: 'reach,saved,plays' });
      for (const d of ins.data || []) { const v = d.values && d.values[0] && d.values[0].value; if (d.name === 'reach') reach = v; if (d.name === 'saved') saved = v; if (d.name === 'plays') plays = v; }
    } catch { /* 일부 게시물은 지표 미지원 */ }
    out.push({ id: m.id, title: String(m.caption || '').split('\n')[0].slice(0, 40), permalink: m.permalink, at: m.timestamp, likes: m.like_count, comments: m.comments_count, reach, saved, plays });
  }
  return out;
}

export const checkToken = () => call('GET', `/${env('IG_USER_ID')}`, { fields: 'username,media_count' });
