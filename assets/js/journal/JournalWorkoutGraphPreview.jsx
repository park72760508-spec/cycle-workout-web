/**
 * JournalWorkoutGraphPreview — 인도어 훈련(코스 없음) 시 워크아웃 화면과 동일한 세그먼트 막대 그래프
 * renderSegmentedWorkoutGraph (workoutManager.js) 재사용
 */
/* global React */

(function () {
  'use strict';

  if (!window.React) {
    console.warn('[JournalWorkoutGraphPreview] React not loaded');
    return;
  }

  var useState = window.React.useState;
  var useEffect = window.React.useEffect;
  var useRef = window.React.useRef;

  function JournalWorkoutGraphPreview(props) {
    var p = props || {};
    var workoutId = p.workoutId != null ? String(p.workoutId).trim() : '';
    var maxHeight = p.maxHeight != null ? Number(p.maxHeight) : 200;
    var className = p.className || 'journal-workout-graph-wrap';
    var actualSegmentAvgWatts = Array.isArray(p.actualSegmentAvgWatts) ? p.actualSegmentAvgWatts : null;
    var actualFtp = p.actualFtp != null ? Number(p.actualFtp) : null;
    var stravaFallbackId = p.stravaFallbackId != null ? String(p.stravaFallbackId).trim() : '';
    var graphRef = useRef(null);
    /* 워크아웃 요약(WU … | n X (…) | CD …) + 파워미터 아이콘(% ↔ W) — 워크아웃 화면 카드와 동일, 상태는 워크아웃 ID별로 유지 */
    var _wst = useState(function () {
      return !!(window.__workoutFlowW && window.__workoutFlowW[workoutId]);
    });
    var showW = _wst[0];
    var setShowW = _wst[1];

    var utils = window.journalWorkoutGraphUtils || {};
    function cachedFor(wid) {
      var c = wid && typeof utils.getCachedWorkoutSegmentsForJournal === 'function'
        ? utils.getCachedWorkoutSegmentsForJournal(wid)
        : null;
      return c && c.segments && c.segments.length ? c : null;
    }

    /* 이미 불러온 워크아웃이면 첫 렌더부터 바로 그래프(로딩 표시 없음) */
    var _st = useState(function () {
      var c = cachedFor(workoutId);
      return c
        ? { loading: false, title: c.title || '', segments: c.segments, error: null }
        : { loading: !!workoutId, title: '', segments: null, error: null };
    });
    var state = _st[0];
    var setState = _st[1];

    function userFtp() {
      try {
        var cu = window.currentUser || (typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null);
        var f = cu ? Number(cu.ftp || 0) : 0;
        if (f > 0) return f;
      } catch (e) {}
      return actualFtp > 0 ? actualFtp : 0;
    }
    function flowSummaryEl(segments) {
      if (typeof window.buildWorkoutFlowSummary !== 'function' || !segments || !segments.length) return null;
      var ftp = userFtp();
      var useW = showW && ftp > 0;
      var text = window.buildWorkoutFlowSummary({ segments: segments }, useW ? ftp : 0);
      if (!text) return null;
      return React.createElement(
        'div',
        { className: 'workout-card__flow journal-workout-flow' },
        React.createElement('p', { className: 'workout-card__flow-text' }, text),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'workout-card__flow-btn',
            'data-w': useW ? '1' : '0',
            disabled: ftp <= 0,
            title: ftp > 0 ? (useW ? '% 로 보기' : '내 FTP 기준 W 로 보기') : 'FTP 정보 없음',
            'aria-label': '파워 W 값으로 보기',
            onClick: function (ev) {
              ev.stopPropagation();
              var nv = !showW;
              window.__workoutFlowW = window.__workoutFlowW || {};
              window.__workoutFlowW[workoutId] = nv;
              setShowW(nv);
            }
          },
          React.createElement('img', {
            src: useW ? 'assets/img/power_b.png' : 'assets/img/power_i.png',
            alt: '파워미터'
          })
        )
      );
    }

    useEffect(function () {
      if (!workoutId) {
        setState({ loading: false, title: '', segments: null, error: 'no-id' });
        return;
      }
      var hit = cachedFor(workoutId);
      if (hit) {
        setState(function (prev) {
          return prev.segments === hit.segments && !prev.loading
            ? prev
            : { loading: false, title: hit.title || '', segments: hit.segments, error: null };
        });
        return;
      }
      var cancelled = false;
      setState({ loading: true, title: '', segments: null, error: null });

      var loadFn =
        window.journalWorkoutGraphUtils &&
        typeof window.journalWorkoutGraphUtils.loadWorkoutSegmentsForJournal === 'function'
          ? window.journalWorkoutGraphUtils.loadWorkoutSegmentsForJournal
          : null;

      var promise = loadFn
        ? loadFn(workoutId)
        : Promise.resolve({ segments: [], title: '' });

      Promise.resolve(promise)
        .then(function (result) {
          if (cancelled) return;
          var segs = (result && result.segments) || [];
          var title = (result && result.title) || '';
          if (!segs.length) {
            setState({ loading: false, title: title, segments: null, error: 'no-segments' });
            return;
          }
          setState({ loading: false, title: title, segments: segs, error: null });
        })
        .catch(function () {
          if (!cancelled) {
            setState({ loading: false, title: '', segments: null, error: 'load-fail' });
          }
        });

      return function () {
        cancelled = true;
      };
    }, [workoutId]);

    /* 저장된 구간별 결과가 없으면(저장 실패·지연 등) 같은 날 Strava 활동의 파워 스트림으로 구간별 평균 계산(서버 함수) */
    var _fb = useState(null);
    var fbAvg = _fb[0];
    var setFbAvg = _fb[1];
    useEffect(function () {
      if (actualSegmentAvgWatts || !stravaFallbackId || state.loading || !state.segments || !state.segments.length) return;
      var segs = state.segments;
      var ftp = userFtp();
      function pctOf(v) {
        if (typeof v === 'string') v = v.split(/[~/]/).map(Number).filter(function (x) { return isFinite(x) && x > 0; });
        else v = [Number(v)];
        if (!v.length) return 0;
        return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
      }
      var payload = segs.map(function (sg) {
        var sec = Number(sg.duration_sec != null ? sg.duration_sec : sg.duration) || 0;
        var t = sg.target_type || 'ftp_pct';
        var pct = t === 'cadence_rpm' ? 0 : pctOf(sg.target_value);
        if (pct && sg.ramp && sg.ramp !== 'none' && sg.ramp_to_value != null) pct = (pct + (pctOf(sg.ramp_to_value) || pct)) / 2;
        return { sec: Math.round(sec), targetW: ftp > 0 ? Math.round(pct * ftp / 100) : 0 };
      });
      var cacheKey = 'segAvgStrava:' + stravaFallbackId + ':' + payload.map(function (x) { return x.sec; }).join(',');
      try {
        var c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (Array.isArray(c) && c.length) { setFbAvg(c); return; }
      } catch (e) {}
      var cancelled = false;
      (async function () {
        try {
          var au = window.authV9 && window.authV9.currentUser;
          if (!au || typeof au.getIdToken !== 'function') return;
          var tok = await au.getIdToken();
          var pid = (window.authV9.app && window.authV9.app.options && window.authV9.app.options.projectId) || 'stelvio-ai';
          var r = await fetch('https://us-central1-' + pid + '.cloudfunctions.net/getStravaSegmentAvgWatts', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stravaActivityId: stravaFallbackId, segments: payload })
          });
          var j = await r.json().catch(function () { return null; });
          if (cancelled || !j || !j.success || !Array.isArray(j.segmentAvgWatts)) return;
          try { localStorage.setItem(cacheKey, JSON.stringify(j.segmentAvgWatts)); } catch (e) {}
          setFbAvg(j.segmentAvgWatts);
        } catch (e) { console.warn('[WorkoutGraph] Strava 구간 평균 보완 실패:', e && e.message); }
      })();
      return function () { cancelled = true; };
    }, [actualSegmentAvgWatts, stravaFallbackId, state.loading, state.segments]);

    useEffect(function () {
      var el = graphRef.current;
      if (!el || state.loading || state.error || !state.segments || !state.segments.length) return;
      var render = window.renderSegmentedWorkoutGraph;
      if (typeof render !== 'function') {
        el.innerHTML = '<div class="segmented-workout-graph-empty">그래프를 표시할 수 없습니다</div>';
        return;
      }
      render(el, state.segments, {
        maxHeight: maxHeight,
        actualSegmentAvgWatts: actualSegmentAvgWatts || fbAvg,
        actualFtp: actualFtp > 0 ? actualFtp : userFtp()
      });
    }, [state.loading, state.error, state.segments, maxHeight, actualSegmentAvgWatts, actualFtp, fbAvg]);

    if (!workoutId) return null;

    if (state.loading) {
      return React.createElement(
        'div',
        { className: className + ' journal-workout-graph-wrap--loading' },
        React.createElement('div', { className: 'journal-loading-spinner' }),
        React.createElement('p', { className: 'journal-workout-graph-status' }, '워크아웃 그래프 불러오는 중…')
      );
    }

    if (state.error) {
      return React.createElement(
        'div',
        { className: className + ' journal-workout-graph-wrap--empty' },
        React.createElement(
          'p',
          { className: 'journal-course-preview-empty' },
          state.error === 'no-segments'
            ? '워크아웃 세그먼트 정보가 없습니다.'
            : '워크아웃 그래프를 불러올 수 없습니다.'
        )
      );
    }

    return React.createElement(
      'div',
      { className: className },
      state.title
        ? React.createElement('p', { className: 'journal-workout-graph-title' }, state.title)
        : React.createElement('p', { className: 'journal-workout-graph-title' }, '인도어 훈련 워크아웃'),
      React.createElement('div', {
        className: 'journal-workout-graph-inner workout-card__graph',
        ref: graphRef
      }),
      flowSummaryEl(state.segments)
    );
  }

  window.JournalWorkoutGraphPreview = JournalWorkoutGraphPreview;
})();
