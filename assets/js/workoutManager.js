

const GAS_URL = (window.CONFIG && window.CONFIG.GAS_WEB_APP_URL) || '';

async function apiGet(action, params={}) {
  const q = new URLSearchParams({ action, ...params });
  const r = await fetch(`${GAS_URL}?${q.toString()}`, { method:'GET' });
  return r.json();
}
async function apiPost(action, body={}) {
  const r = await fetch(`${GAS_URL}?action=${action}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
