/**
 * STELVIO 헵타곤 7축·종합(포지션 점수) — Firestore heptagon_rank_log 동기화
 * - 랭킹보드/필터(성별·부문)용: gender, ageCategory(부문), monthKey, avgPositionScore(높을수록 상위) 등
 */
/* global window */
(function () {
  'use strict';

  var COL = 'heptagon_rank_log';

  function monthKeyKst() {
    var t = new Date();
    var y = t.getFullYear();
    var m = String(t.getMonth() + 1).padStart(2, '0');
    return y + '-' + m;
  }

  /**
   * @param {Object} p
   * @param {string} p.userId
   * @param {string} [p.displayName]
   * @param {string} p.filterGender
   * @param {string} p.filterCategory
   * @param {string} [p.ageCategory] API currentUser.ageCategory
   * @param {string} p.period
   * @param {string} p.monthKey
   * @param {number[]} p.ranks
   * @param {number[]} p.cohortNPerAxis
   * @param {number[]} p.positionScores100
   * @param {number} p.sumPositionScores
   * @param {number} p.avgPositionScore
   * @param {number} p.pTier
   * @param {string} p.tierId
   * @param {number} p.nRef
   * @param {number} [p.pComprehensive]
   */
  function saveStelvioHeptagonRankLog(p) {
    if (!p || !p.userId) return Promise.resolve(false);
    if (!window.firestoreV9) return Promise.resolve(false);
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.setDoc || !mod.doc || !mod.collection) return false;
        var ref = mod.doc(mod.collection(window.firestoreV9, COL), String(p.userId));
        var data = {
          userId: String(p.userId),
          displayName: (p.displayName && String(p.displayName).trim()) || '',
          filterGender: p.filterGender != null ? String(p.filterGender) : 'all',
          filterCategory: p.filterCategory != null ? String(p.filterCategory) : 'Supremo',
          ageCategory: p.ageCategory != null ? String(p.ageCategory) : '',
          period: p.period != null ? String(p.period) : 'monthly',
          monthKey: p.monthKey != null ? String(p.monthKey) : monthKeyKst(),
          updatedAt: mod.serverTimestamp(),
          ranks: Array.isArray(p.ranks) ? p.ranks : [],
          cohortNPerAxis: Array.isArray(p.cohortNPerAxis) ? p.cohortNPerAxis : [],
          positionScores100: Array.isArray(p.positionScores100) ? p.positionScores100 : [],
          sumPositionScores: Number(p.sumPositionScores) || 0,
          avgPositionScore: Number(p.avgPositionScore) || 0,
          pTier: Number(p.pTier) || 0,
          tierId: p.tierId != null ? String(p.tierId) : 'C6',
          nRef: Math.floor(Number(p.nRef)) || 0,
        };
        if (p.pComprehensive != null && isFinite(Number(p.pComprehensive))) {
          data.pComprehensive = Number(p.pComprehensive);
        }
        return mod.setDoc(ref, data, { merge: true });
      })
      .then(function () {
        return true;
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[heptagon_rank_log]', e && e.message ? e.message : e);
        }
        return false;
      });
  }

  /**
   * 랭킹보드·모달: 월·성별·부문별 상위 (avgPositionScore 내림). 인덱스: firestore.indexes.json 참고.
   * @param {{ monthKey: string, filterCategory: string, filterGender: string, limit?: number }} o
   */
  function queryStelvioHeptagonRankTop(o) {
    o = o || {};
    if (!window.firestoreV9) return Promise.resolve({ ok: false, items: [] });
    var monthKey = o.monthKey != null ? String(o.monthKey) : monthKeyKst();
    var filterCategory = o.filterCategory != null ? String(o.filterCategory) : 'Supremo';
    var filterGender = o.filterGender != null ? String(o.filterGender) : 'all';
    var lim = o.limit | 0;
    if (lim < 1) lim = 50;
    if (lim > 200) lim = 200;
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.query || !mod.getDocs) return { ok: false, items: [] };
        var qy = mod.query(
          mod.collection(window.firestoreV9, COL),
          mod.where('monthKey', '==', monthKey),
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.orderBy('avgPositionScore', 'desc'),
          mod.limit(lim)
        );
        return mod.getDocs(qy);
      })
      .then(function (qs) {
        var items = [];
        qs.forEach(function (d) {
          var x = d.data();
          x._id = d.id;
          items.push(x);
        });
        return { ok: true, items: items };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[queryStelvioHeptagonRankTop]', e && e.message ? e.message : e);
        }
        return { ok: false, items: [], error: String(e && e.message ? e.message : e) };
      });
  }

  window.saveStelvioHeptagonRankLog = saveStelvioHeptagonRankLog;
  window.queryStelvioHeptagonRankTop = queryStelvioHeptagonRankTop;
  window.getStelvioHeptagonRankLogCollectionName = function () {
    return COL;
  };
})();
