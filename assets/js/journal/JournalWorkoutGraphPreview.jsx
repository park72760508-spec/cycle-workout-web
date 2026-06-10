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
    var graphRef = useRef(null);

    var _st = useState({ loading: !!workoutId, title: '', segments: null, error: null });
    var state = _st[0];
    var setState = _st[1];

    useEffect(function () {
      if (!workoutId) {
        setState({ loading: false, title: '', segments: null, error: 'no-id' });
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

    useEffect(function () {
      var el = graphRef.current;
      if (!el || state.loading || state.error || !state.segments || !state.segments.length) return;
      var render = window.renderSegmentedWorkoutGraph;
      if (typeof render !== 'function') {
        el.innerHTML = '<div class="segmented-workout-graph-empty">그래프를 표시할 수 없습니다</div>';
        return;
      }
      render(el, state.segments, { maxHeight: maxHeight });
    }, [state.loading, state.error, state.segments, maxHeight]);

    if (!workoutId) return null;

    if (state.loading) {
      return React.createElement(
        'div',
        { className: className + ' journal-workout-graph-wrap--loading' },
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
      })
    );
  }

  window.JournalWorkoutGraphPreview = JournalWorkoutGraphPreview;
})();
