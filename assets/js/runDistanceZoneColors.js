/**
 * RUN 거리·에너지존 색상 (Z7–Z1) — 톤다운 서피스 + 참조 HEX
 * 다른 화면에서 window.runDistanceZoneColors / CSS var(--run-dist-*) 재사용
 */
(function () {
  'use strict';

  /**
   * base: 스포츠 과학 참조색(원색) — UI 직접 사용 금지, 문서·범례용
   * bg / border / label: 리스트·칩 등에 쓰는 톤다운 토큰
   */
  var ZONES = {
    '1k': {
      key: '1k',
      label: '1k',
      zone: 'Z7',
      zoneName: 'Neuromuscular Power / Sprint',
      nameKo: '스프린트',
      base: '#E53935',
      bg: '#FBE9E9',
      border: 'rgba(229, 57, 53, 0.22)',
      label: '#B85C5A'
    },
    '3k': {
      key: '3k',
      label: '3k',
      zone: 'Z6',
      zoneName: 'Anaerobic Capacity',
      nameKo: '무산소 역치',
      base: '#FF5722',
      bg: '#FFEDE6',
      border: 'rgba(255, 87, 34, 0.20)',
      label: '#C4684F'
    },
    '5k': {
      key: '5k',
      label: '5k',
      zone: 'Z5',
      zoneName: 'VO2 Max',
      nameKo: '최대산소',
      base: '#FF9800',
      bg: '#FFF3E3',
      border: 'rgba(255, 152, 0, 0.22)',
      label: '#B87A2E'
    },
    '7k': {
      key: '7k',
      label: '7k',
      zone: 'Z4',
      zoneName: 'Lactate Threshold',
      nameKo: '젖산 역치',
      base: '#FDD835',
      bg: '#FDF8E5',
      border: 'rgba(253, 216, 53, 0.35)',
      label: '#9A8724'
    },
    '10k': {
      key: '10k',
      label: '10k',
      zone: 'Z3',
      zoneName: 'Tempo / Aerobic High',
      nameKo: '템포',
      base: '#4CAF50',
      bg: '#E9F5EB',
      border: 'rgba(76, 175, 80, 0.22)',
      label: '#3D8B45'
    },
    '20k': {
      key: '20k',
      label: '20k',
      zone: 'Z2',
      zoneName: 'Aerobic Endurance / Base',
      nameKo: '유산소 지구력',
      base: '#2196F3',
      bg: '#E6F3FD',
      border: 'rgba(33, 150, 243, 0.20)',
      label: '#1A7ABD'
    },
    '42k': {
      key: '42k',
      label: '42k',
      zone: 'Z1',
      zoneName: 'Ultra Long / Deep Stability',
      nameKo: '초장거리',
      base: '#3F51B5',
      bg: '#EAECF6',
      border: 'rgba(63, 81, 181, 0.20)',
      label: '#3A4899'
    }
  };

  var ORDER = ['1k', '3k', '5k', '7k', '10k', '20k', '42k'];

  function getZone(key) {
    return ZONES[key] || null;
  }

  function segmentChipClass(key) {
    var k = key ? String(key) : '';
    return 'running-ranking-segment-chip running-ranking-segment-chip--' + k;
  }

  function segmentTitlePrefix(key) {
    var z = getZone(key);
    if (!z) return key || '';
    return z.label + ' · ' + z.zone + ' ' + z.nameKo;
  }

  function injectCssVariables(root) {
    root = root || document.documentElement;
    if (!root || !root.style) return;
    var i;
    for (i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      var z = ZONES[k];
      if (!z) continue;
      root.style.setProperty('--run-dist-' + k + '-base', z.base);
      root.style.setProperty('--run-dist-' + k + '-bg', z.bg);
      root.style.setProperty('--run-dist-' + k + '-border', z.border);
      root.style.setProperty('--run-dist-' + k + '-label', z.label);
    }
  }

  window.runDistanceZoneColors = {
    ZONES: ZONES,
    ORDER: ORDER,
    getZone: getZone,
    segmentChipClass: segmentChipClass,
    segmentTitlePrefix: segmentTitlePrefix,
    injectCssVariables: injectCssVariables
  };

  if (document.documentElement) {
    injectCssVariables(document.documentElement);
  }
})();
