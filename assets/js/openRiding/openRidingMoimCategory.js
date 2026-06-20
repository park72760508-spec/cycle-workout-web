/**
 * 오픈 모임(CYCLE/RUN) — 카테고리·레벨·팩 룰 공통 헬퍼
 */
(function (global) {
  'use strict';

  var CYCLE = 'CYCLE';
  var RUN = 'RUN';

  var RUN_LEVEL_OPTIONS = [
    { value: '입문', hint: '페이스 8:00/km 이상 또는 펀런' },
    { value: '초급', hint: '페이스 6:00 ~ 7:59/km' },
    { value: '중급', hint: '페이스 5:00 ~ 5:59/km' },
    { value: '중상급', hint: '페이스 4:30 ~ 4:59/km' },
    { value: '상급', hint: '페이스 4:30/km 미만 · 서브3 타깃 레이스' }
  ];

  var RUN_ROTATION_OPTIONS = [
    { value: 'pacer_fixed', label: '페이서 고정 주행' },
    { value: 'group_pack', label: '그룹 팩 러닝' },
    { value: 'free_run', label: '자율 주행' }
  ];

  var RUN_GEAR_FIELDS = [
    { key: 'packRunGearRunningShoes', label: '러닝화 필수 착용' },
    { key: 'packRunGearNightSafety', label: '야간 안전 용품' },
    { key: 'packRunGearPersonalSupply', label: '개인 식수 및 보급식' },
    { key: 'packRunGearCapSunglasses', label: '캡 모자 및 선글라스' },
    { key: 'packRunGearSpareClothes', label: '여벌 옷/수건' }
  ];

  function normalizeMoimCategory(raw) {
    var c = raw != null ? String(raw).trim().toUpperCase() : '';
    return c === RUN ? RUN : CYCLE;
  }

  function resolveInitialMoimCategory(props) {
    props = props || {};
    if (props.moimCategory) return normalizeMoimCategory(props.moimCategory);
    if (global.resolveOpenRidingMoimCategory) return normalizeMoimCategory(global.resolveOpenRidingMoimCategory());
    if (global.sportCategoryRoutes && typeof global.sportCategoryRoutes.getActiveSport === 'function') {
      return global.sportCategoryRoutes.getActiveSport() === 'run' ? RUN : CYCLE;
    }
    return CYCLE;
  }

  function runPackFormDefaults() {
    var out = {
      packRunRotation: '',
      packRunGearRunningShoes: false,
      packRunGearNightSafety: false,
      packRunGearPersonalSupply: false,
      packRunGearCapSunglasses: false,
      packRunGearSpareClothes: false
    };
    return out;
  }

  function readRunThresholdPaceDisplay() {
    try {
      var u = global.currentUser;
      if (!u) {
        u = JSON.parse(global.localStorage.getItem('currentUser') || 'null');
      }
      if (global.runDashboardPace && typeof global.runDashboardPace.computeThresholdPaceFromPeaks === 'function') {
        var peaks = u && u.peak_performances ? u.peak_performances : null;
        var computed = global.runDashboardPace.computeThresholdPaceFromPeaks(peaks);
        if (computed && computed.display) return String(computed.display);
        if (computed && computed.paceValue) return String(computed.paceValue);
      }
      if (u && u.threshold_pace) return String(u.threshold_pace).trim();
    } catch (e0) {}
    return null;
  }

  function isValidLevelForCategory(level, category) {
    var cat = normalizeMoimCategory(category);
    var lv = String(level || '').trim();
    if (!lv) return false;
    if (cat === RUN) {
      for (var i = 0; i < RUN_LEVEL_OPTIONS.length; i++) {
        if (RUN_LEVEL_OPTIONS[i].value === lv) return true;
      }
      return false;
    }
    var opts = global.RIDING_LEVEL_OPTIONS || [];
    for (var j = 0; j < opts.length; j++) {
      if (String(opts[j].value) === lv) return true;
    }
    return false;
  }

  function buildPackRidingRulesPayloadFromForm(form, category) {
    form = form || {};
    var cat = normalizeMoimCategory(category);
    var base = {
      minorsAllowed: form.packMinorsAllowed || '',
      openSectionText: form.packOpenSectionText || '',
      supplySectionText: form.packSupplySectionText || '',
      feeText: form.packFeeText || '',
      cancelConditionText: form.packCancelConditionText || ''
    };
    if (cat === RUN) {
      return Object.assign(base, {
        rotation: form.packRunRotation || '',
        nodrop: form.packNodrop || '',
        gear: {
          helmet: false,
          lights: false,
          puncture: false,
          water: false,
          runningShoes: !!form.packRunGearRunningShoes,
          nightSafety: !!form.packRunGearNightSafety,
          personalSupply: !!form.packRunGearPersonalSupply,
          capSunglasses: !!form.packRunGearCapSunglasses,
          spareClothes: !!form.packRunGearSpareClothes
        }
      });
    }
    return Object.assign(base, {
      rotation: form.packRotation || '',
      nodrop: form.packNodrop || '',
      gear: {
        helmet: !!form.packGearHelmet,
        lights: !!form.packGearLights,
        puncture: !!form.packGearPuncture,
        water: !!form.packGearWater,
        runningShoes: false,
        nightSafety: false,
        personalSupply: false,
        capSunglasses: false,
        spareClothes: false
      }
    });
  }

  function applyPackRulesToFormFromRide(ride, existingFormFields) {
    existingFormFields = existingFormFields || {};
    var cat = normalizeMoimCategory(ride && ride.category);
    var svc = global.openRidingService || {};
    var n =
      typeof svc.normalizePackRidingRules === 'function'
        ? svc.normalizePackRidingRules(ride && ride.packRidingRules)
        : { rotation: '', nodrop: '', gear: {}, minorsAllowed: '', openSectionText: '', supplySectionText: '', feeText: '', cancelConditionText: '' };
    var g = n.gear && typeof n.gear === 'object' ? n.gear : {};
    var common = {
      packNodrop: n.nodrop,
      packOpenSectionText: n.openSectionText != null ? String(n.openSectionText) : '',
      packSupplySectionText: n.supplySectionText != null ? String(n.supplySectionText) : '',
      packFeeText: n.feeText != null ? String(n.feeText) : '',
      packCancelConditionText: n.cancelConditionText != null ? String(n.cancelConditionText) : '',
      packMinorsAllowed: n.minorsAllowed
    };
    if (cat === RUN) {
      return Object.assign(existingFormFields, common, runPackFormDefaults(), {
        packRunRotation: n.rotation || '',
        packRunGearRunningShoes: !!g.runningShoes,
        packRunGearNightSafety: !!g.nightSafety,
        packRunGearPersonalSupply: !!g.personalSupply,
        packRunGearCapSunglasses: !!g.capSunglasses,
        packRunGearSpareClothes: !!g.spareClothes,
        packRotation: '',
        packGearHelmet: false,
        packGearLights: false,
        packGearPuncture: false,
        packGearWater: false
      });
    }
    return Object.assign(existingFormFields, common, {
      packRotation: n.rotation,
      packGearHelmet: !!g.helmet,
      packGearLights: !!g.lights,
      packGearPuncture: !!g.puncture,
      packGearWater: !!g.water,
      packRunRotation: '',
      packRunGearRunningShoes: false,
      packRunGearNightSafety: false,
      packRunGearPersonalSupply: false,
      packRunGearCapSunglasses: false,
      packRunGearSpareClothes: false
    });
  }

  function runRotationLabel(value) {
    var v = String(value || '');
    for (var i = 0; i < RUN_ROTATION_OPTIONS.length; i++) {
      if (RUN_ROTATION_OPTIONS[i].value === v) return RUN_ROTATION_OPTIONS[i].label;
    }
    return '';
  }

  global.openRidingMoimCategory = {
    CYCLE: CYCLE,
    RUN: RUN,
    RUN_LEVEL_OPTIONS: RUN_LEVEL_OPTIONS,
    RUN_ROTATION_OPTIONS: RUN_ROTATION_OPTIONS,
    RUN_GEAR_FIELDS: RUN_GEAR_FIELDS,
    normalizeMoimCategory: normalizeMoimCategory,
    resolveInitialMoimCategory: resolveInitialMoimCategory,
    runPackFormDefaults: runPackFormDefaults,
    readRunThresholdPaceDisplay: readRunThresholdPaceDisplay,
    isValidLevelForCategory: isValidLevelForCategory,
    buildPackRidingRulesPayloadFromForm: buildPackRidingRulesPayloadFromForm,
    applyPackRulesToFormFromRide: applyPackRulesToFormFromRide,
    runRotationLabel: runRotationLabel
  };
})(typeof window !== 'undefined' ? window : global);
