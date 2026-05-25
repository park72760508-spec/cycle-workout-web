/**
 * STELVIO 랭킹보드 — 네트워크 fetch + JSON parse (메인 스레드 오프로드)
 * postMessage: { id, type:'fetchJson', url, timeoutMs }
 * reply: { id, ok, data } | { id, ok:false, error }
 */
'use strict';

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.type === 'parseJson') {
    var parseId = msg.id;
    try {
      var parsed = msg.text ? JSON.parse(String(msg.text)) : null;
      self.postMessage({ id: parseId, ok: true, data: parsed });
    } catch (parseErrOnly) {
      self.postMessage({
        id: parseId,
        ok: false,
        error: 'json-parse:' + (parseErrOnly && parseErrOnly.message),
      });
    }
    return;
  }
  if (msg.type !== 'fetchJson' || !msg.url) return;
  var id = msg.id;
  var timeoutMs = Math.max(1000, Number(msg.timeoutMs) || 30000);

  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  if (controller) {
    timer = setTimeout(function () {
      try {
        controller.abort();
      } catch (_) {}
    }, timeoutMs);
  }

  fetch(msg.url, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    signal: controller ? controller.signal : undefined,
  })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        if (res.ok && text) {
          try {
            data = JSON.parse(text);
          } catch (parseErr) {
            self.postMessage({
              id: id,
              ok: false,
              error: 'json-parse:' + (parseErr && parseErr.message),
            });
            return;
          }
        }
        self.postMessage({ id: id, ok: res.ok, data: data });
      });
    })
    .catch(function (err) {
      if (timer) clearTimeout(timer);
      self.postMessage({
        id: id,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    });
};
