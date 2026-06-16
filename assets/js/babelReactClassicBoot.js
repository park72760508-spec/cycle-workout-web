/**
 * @babel/standalone 기본 react 프리셋이 automatic JSX runtime(import 삽입)을 쓰면
 * type="text/babel" 결과가 일반 <script>로 실행되어
 * "Cannot use import statement outside a module" 오류가 납니다.
 * React.createElement(classic)로 고정합니다.
 */
(function () {
  'use strict';

  function registerStelvioReactClassicPreset() {
    if (typeof Babel === 'undefined' || !Babel.registerPreset || !Babel.availablePresets) {
      return false;
    }
    if (Babel.__stelvioReactClassicPresetRegistered) return true;

    Babel.registerPreset('stelvio-react-classic', {
      presets: [
        [Babel.availablePresets.env, { modules: false }],
        [
          Babel.availablePresets.react,
          {
            runtime: 'classic',
            pragma: 'React.createElement',
            pragmaFrag: 'React.Fragment'
          }
        ]
      ]
    });
    Babel.__stelvioReactClassicPresetRegistered = true;
    return true;
  }

  if (!registerStelvioReactClassicPreset()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (registerStelvioReactClassicPreset() || attempts > 200) {
        clearInterval(timer);
      }
    }, 25);
  }
})();
