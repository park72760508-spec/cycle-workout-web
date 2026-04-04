/**
 * TrainingTimerModule - 훈련 화면 타이머 공통 모듈
 *
 * [핵심 원리]
 * 1. 절대 시간 기반: performance.now()/Date.now()로 실제 시작 시각 대비 경과 시간(Delta) 계산
 *    → setInterval 배제, 메인 스레드 지연 시에도 시간 자체는 정확
 * 2. requestAnimationFrame: 브라우저 렌더링 주기에 맞춰 부드럽게 1초 단위 갱신
 * 3. DOM 최소 업데이트: 값 변경 시에만 textContent 갱신 (Reflow/Repaint 최소화)
 * 4. 완벽한 해제: stop() 시 cancelAnimationFrame으로 메모리 누수 방지
 *
 * [대상 화면]
 * - #mobileDashboardScreen, #trainingScreen, #bluetoothIndividualScreen, individual.html
 *
 * [시간 SSOT — 경과·세그 연동]
 * - onTick(wholeWorkoutElapsedSec) 한 가지 값만 전달. 노트북은 trainingState.elapsedSec, 모바일은 mobileTrainingState.elapsedSec.
 * - 랩/세그 진행: 명목 cum 과 벽시계 불일치(건너뛰기) 시 app.js getWallClockSegmentElapsedForLap +
 *   _lapBaselineBySegIndex(노트북 trainingState / 모바일 mobileTrainingState 공통).
 */
(function (global) {
  'use strict';

  /** 인스턴스별 상태: { instanceId: { rafId, lastDisplayedSec } } */
  var _instances = {};

  /**
   * 초 → "hh:mm:ss" 또는 "mm:ss" 포맷
   * @param {number} totalSeconds
   * @param {boolean} [useHms=true] - true: hh:mm:ss, false: mm:ss
   * @returns {string}
   */
  function formatElapsed(totalSeconds, useHms) {
    var sec = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    if (useHms !== false && h > 0) {
      return pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    return pad(m) + ':' + pad(s);
  }

  /**
   * DOM 텍스트 노드 - 값 변경 시에만 업데이트 (Reflow/Repaint 최소화)
   * @param {HTMLElement|string} el - 요소 또는 ID
   * @param {string} newText
   * @param {string} [attr] - 예: 'fill' (SVG text)
   * @param {string} [attrValue]
   */
  function safeUpdateText(el, newText, attr, attrValue) {
    var node = typeof el === 'string' ? document.getElementById(el) : el;
    if (!node) return;
    if (node.textContent !== newText) {
      node.textContent = newText;
    }
    if (attr && attrValue !== undefined && node.getAttribute(attr) !== attrValue) {
      node.setAttribute(attr, attrValue);
    }
  }

  /**
   * rAF 기반 타이머 루프 (절대 시간 + 부드러운 갱신)
   * @param {Object} options
   * @param {number} options.startMs - 훈련 시작 시각 (Date.now() 또는 performance.now())
   * @param {function(): number} [options.getPausedMs] - 일시정지 누적 ms 반환 (없으면 0)
   * @param {function(number): void} options.onTick - elapsedSec 변경 시 호출 (1초 단위)
   * @param {function(): boolean} options.isActive - false 반환 시 루프 중지
   * @param {string} [options.screenId] - 화면 ID (활성 체크용, 없으면 스킵)
   * @param {string} [options.instanceId] - 인스턴스 식별 (다중 타이머 구분)
   * @returns {function} stop 함수
   */
  function start(options) {
    var startMs = options.startMs;
    var getPausedMs = options.getPausedMs || function () { return 0; };
    var onTick = options.onTick;
    var isActive = options.isActive;
    var screenId = options.screenId;
    var instanceId = options.instanceId || 'default';

    if (!startMs || typeof onTick !== 'function' || typeof isActive !== 'function') {
      console.warn('[TrainingTimer] start: startMs, onTick, isActive 필수');
      return function () {};
    }

    stop(instanceId);

    var inst = { rafId: null, lastDisplayedSec: -1 };
    _instances[instanceId] = inst;

    function tick() {
      if (!isActive()) {
        stop(instanceId);
        return;
      }

      if (screenId) {
        var screen = document.getElementById(screenId);
        var isVisible = screen && (screen.classList.contains('active') || (typeof window.getComputedStyle === 'function' ? window.getComputedStyle(screen).display !== 'none' : true));
        if (!isVisible) {
          stop(instanceId);
          return;
        }
      }

      var now = Date.now();
      var pausedMs = getPausedMs();
      var elapsedSec = Math.floor((now - startMs - pausedMs) / 1000);

      if (elapsedSec < 0) elapsedSec = 0;

      if (elapsedSec !== inst.lastDisplayedSec) {
        inst.lastDisplayedSec = elapsedSec;
        try {
          onTick(elapsedSec);
        } catch (e) {
          console.warn('[TrainingTimer] onTick error:', e);
        }
      }

      if (!_instances[instanceId]) return;
      inst.rafId = requestAnimationFrame(tick);
    }

    inst.rafId = requestAnimationFrame(tick);
    return function () { stop(instanceId); };
  }

  /**
   * 타이머 정지 (rAF 해제)
   * @param {string} [instanceId] - 지정 시 해당 인스턴스만, 없으면 전체 정지
   */
  function stop(instanceId) {
    if (instanceId) {
      var inst = _instances[instanceId];
      if (!inst) return;
      if (inst.rafId != null) {
        cancelAnimationFrame(inst.rafId);
        inst.rafId = null;
      }
      delete _instances[instanceId];
    } else {
      Object.keys(_instances).forEach(function (id) {
        stop(id);
      });
    }
  }

  /**
   * 특정 인스턴스가 실행 중인지 여부
   */
  function isRunning(instanceId) {
    var inst = instanceId ? _instances[instanceId] : null;
    if (instanceId) return inst && inst.rafId != null;
    return Object.keys(_instances).some(function (id) { return _instances[id].rafId != null; });
  }

  var TrainingTimer = {
    start: start,
    stop: stop,
    isRunning: isRunning,
    formatElapsed: formatElapsed,
    safeUpdateText: safeUpdateText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrainingTimer;
  } else {
    global.TrainingTimer = TrainingTimer;
  }
})(typeof window !== 'undefined' ? window : this);
