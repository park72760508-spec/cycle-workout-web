/**
 * STELVIO 랭킹보드 성능 — structuredClone, morphdom 리스트 갱신, Worker fetch
 */
(function (w) {
  'use strict';

  function stelvioStructuredClone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (eSc) {
        /* fall through */
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (eJson) {
      return value;
    }
  }

  /**
   * 랭킹 행 목록 HTML — morphdom(childrenOnly) 또는 innerHTML 폴백
   */
  function stelvioRankingApplyListHtml(bodyEl, html) {
    if (!bodyEl) return;
    var htmlStr = html == null ? '' : String(html);
    if (!htmlStr) {
      bodyEl.innerHTML = '';
      return;
    }
    var isRankList = htmlStr.indexOf('stelvio-rank-row') !== -1;
    if (!isRankList) {
      bodyEl.innerHTML = htmlStr;
      return;
    }
    var morph = w.morphdom;
    if (typeof morph === 'function') {
      try {
        var template = document.createElement('div');
        template.innerHTML = htmlStr;
        morph(bodyEl, template, { childrenOnly: true });
        return;
      } catch (eMorph) {
        console.warn('[StelvioRanking] morphdom failed, fallback innerHTML', eMorph);
      }
    }
    bodyEl.innerHTML = htmlStr;
  }

  var worker = null;
  var workerReqId = 0;
  var workerPending = Object.create(null);

  function ensureRankingWorker() {
    if (worker) return worker;
    if (typeof Worker === 'undefined') return null;
    try {
      worker = new Worker('assets/js/stelvioRankingWorker.js');
      worker.onmessage = function (ev) {
        var m = ev.data || {};
        var p = workerPending[m.id];
        if (!p) return;
        delete workerPending[m.id];
        if (m.ok !== false && m.data !== undefined) {
          p.resolve(m.data);
        } else {
          p.reject(new Error(m.error || 'ranking-worker-fetch-failed'));
        }
      };
      worker.onerror = function () {
        worker = null;
      };
    } catch (eW) {
      worker = null;
    }
    return worker;
  }

  function fetchRankingJsonInWorker(url, timeoutMs) {
    var wk = ensureRankingWorker();
    if (!wk) return Promise.reject(new Error('no-worker'));
    var id = ++workerReqId;
    return new Promise(function (resolve, reject) {
      workerPending[id] = { resolve: resolve, reject: reject };
      wk.postMessage({
        id: id,
        type: 'fetchJson',
        url: url,
        timeoutMs: timeoutMs,
      });
      setTimeout(function () {
        if (!workerPending[id]) return;
        delete workerPending[id];
        reject(new Error('ranking-worker-timeout'));
      }, timeoutMs + 800);
    });
  }

  /**
   * fetchStelvioPeakPowerRanking용 — Worker 우선, 실패 시 null(호출부가 메인 fetch)
   */
  async function stelvioRankingBoardFetchJsonViaWorker(url, timeoutMs, myGen, mainFetchGenCheck) {
    try {
      var data = await fetchRankingJsonInWorker(url, timeoutMs);
      if (typeof mainFetchGenCheck === 'function' && !mainFetchGenCheck(myGen)) {
        return null;
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  w.stelvioStructuredClone = stelvioStructuredClone;
  w.stelvioRankingApplyListHtml = stelvioRankingApplyListHtml;
  w.stelvioRankingBoardFetchJsonViaWorker = stelvioRankingBoardFetchJsonViaWorker;
})(typeof window !== 'undefined' ? window : globalThis);
