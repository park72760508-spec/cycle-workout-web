/* Recharts UMD 로드 전에 실행: defer 체인에서 prop-types 다음에 두세요 */
(function () {
  if (typeof window !== 'undefined' && window.React && window.PropTypes) {
    window.React.PropTypes = window.PropTypes;
  }
})();
