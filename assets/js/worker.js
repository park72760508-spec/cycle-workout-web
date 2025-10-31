// worker.js (Cloudflare Worker)
const ALLOWED_ORIGIN = 'https://park72760508-spec.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target'); // ex) https://script.google.com/.../exec?action=saveTrainingResult

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!target) {
      return new Response(JSON.stringify({ error: 'missing target' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // 원 요청을 그대로 전달 (Body/Method/Headers)
    const init = {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : await request.text(),
    };

    const resp = await fetch(target, init);

    // 응답 바디/헤더 복제
    const contentType = resp.headers.get('Content-Type') || 'application/json';
    const respBody = await resp.arrayBuffer();

    return new Response(respBody, {
      status: resp.status,
      headers: {
        'Content-Type': contentType,
        ...corsHeaders()
      }
    });
  }
};
