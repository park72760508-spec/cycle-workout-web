/**
 * 화면 단위 React 오류 경계 (2026-09-30).
 *
 * React 18 은 렌더 중 오류가 한 번이라도 나면 루트 전체를 지운다 — 오류 경계가 없던 클럽 하우스·라이딩 기록·
 * 러닝 랭킹·제휴 화면 등은 그때 "백색 화면"으로 멈춰 보였다(특히 네트워크가 불안정한 휴대폰에서 간헐적).
 * 이 경계로 감싸면 오류가 나도 안내 문구와 [다시 시도]·[새로고침] 버튼이 보이고, 다시 시도 시 화면만 새로 그린다.
 *
 * 사용: root.render(window.stelvioSafeScreen(React.createElement(App, props), '클럽 하우스'))
 */
(function () {
  'use strict';

  var BoundaryClass = null;

  function getBoundaryClass() {
    if (BoundaryClass) return BoundaryClass;
    if (typeof React === 'undefined' || !React.Component) return null;
    var h = React.createElement;

    function StelvioScreenErrorBoundary(props) {
      React.Component.call(this, props);
      this.state = { error: null, attempt: 0 };
      this.retry = this.retry.bind(this);
    }
    StelvioScreenErrorBoundary.prototype = Object.create(React.Component.prototype);
    StelvioScreenErrorBoundary.prototype.constructor = StelvioScreenErrorBoundary;
    StelvioScreenErrorBoundary.getDerivedStateFromError = function (error) {
      return { error: error || new Error('render error') };
    };
    StelvioScreenErrorBoundary.prototype.componentDidCatch = function (error, info) {
      try {
        console.error('[StelvioScreenErrorBoundary] ' + (this.props.name || '화면') + ' 렌더 오류:', error, info && info.componentStack);
      } catch (e) {}
    };
    StelvioScreenErrorBoundary.prototype.retry = function () {
      this.setState(function (s) { return { error: null, attempt: s.attempt + 1 }; });
    };
    StelvioScreenErrorBoundary.prototype.render = function () {
      if (!this.state.error) {
        // attempt 가 바뀌면 key 가 바뀌어 하위 화면을 처음부터 다시 마운트
        return h(React.Fragment, { key: 'a' + this.state.attempt }, this.props.children);
      }
      var name = this.props.name || '화면';
      var btn = 'display:inline-block;margin:6px;padding:10px 18px;border-radius:12px;border:0;font-weight:700;font-size:14px;';
      return h('div', { style: { padding: '48px 20px', textAlign: 'center', color: '#334155' } },
        h('p', { style: { fontSize: '16px', fontWeight: 700, margin: '0 0 8px' } }, name + '을(를) 표시하지 못했습니다.'),
        h('p', { style: { fontSize: '13px', color: '#64748b', margin: '0 0 16px' } }, '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'),
        h('button', { type: 'button', onClick: this.retry, style: parseCss(btn + 'background:#7c3aed;color:#fff;') }, '다시 시도'),
        h('button', { type: 'button', onClick: function () { location.reload(); }, style: parseCss(btn + 'background:#e2e8f0;color:#334155;') }, '새로고침')
      );
    };
    BoundaryClass = StelvioScreenErrorBoundary;
    return BoundaryClass;
  }

  function parseCss(str) {
    var o = {};
    String(str).split(';').forEach(function (pair) {
      var i = pair.indexOf(':');
      if (i < 0) return;
      var k = pair.slice(0, i).trim().replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      if (k) o[k] = pair.slice(i + 1).trim();
    });
    return o;
  }

  window.stelvioSafeScreen = function (element, name) {
    var B = getBoundaryClass();
    if (!B || !element) return element;
    return React.createElement(B, { name: name || '' }, element);
  };
})();
