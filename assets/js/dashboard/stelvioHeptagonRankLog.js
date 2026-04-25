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
   * @param {number} [p.comprehensiveRank] 화면 툴팁과 동일한 **종합 N위**(정수, 1~nRef)
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
        if (p.comprehensiveRank != null && isFinite(Number(p.comprehensiveRank))) {
          var crr = Math.floor(Number(p.comprehensiveRank));
          if (crr >= 1) {
            data.comprehensiveRank = crr;
          }
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

  /**
   * 본인 문서 읽기(종합 N위·티어 캐시). 룰: read public.
   * @param {string} userId
   * @returns {Promise<{ ok: boolean, exists?: boolean, data?: object|null, error?: string }>}
   */
  function getStelvioHeptagonRankLog(userId) {
    if (!userId || !window.firestoreV9) {
      return Promise.resolve({ ok: false, data: null, error: 'no-uid' });
    }
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.getDoc || !mod.doc || !mod.collection) {
          return { __heptagonGetErr: 'no-mod' };
        }
        var ref = mod.doc(mod.collection(window.firestoreV9, COL), String(userId));
        return mod.getDoc(ref);
      })
      .then(function (snap) {
        if (snap && snap.__heptagonGetErr) {
          return { ok: false, data: null, error: snap.__heptagonGetErr };
        }
        if (snap == null) return { ok: false, data: null, error: 'no-snap' };
        if (typeof snap.exists === 'boolean' && !snap.exists) {
          return { ok: true, exists: false, data: null };
        }
        if (typeof snap.exists !== 'boolean') {
          return { ok: false, data: null, error: 'no-snap' };
        }
        var d = snap.data() || null;
        return { ok: true, exists: true, data: d };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[getStelvioHeptagonRankLog]', e && e.message ? e.message : e);
        }
        return { ok: false, data: null, error: String(e && e.message ? e.message : e) };
      });
  }

  window.saveStelvioHeptagonRankLog = saveStelvioHeptagonRankLog;
  /**
   * 모달: 동일 month·필터에서 환산점수 합(sumPositionScores)이 나보다 **바로** 높/낮은 사용자 최대 3명씩.
   * - 위: sum > mySum, orderBy sum ASC(가장 낮은 증가부터=나에 가장 가까운 3) → UI에서 점수 높은 순으로 표시
   * - 아래: sum < mySum, orderBy sum DESC(가장 높은 감소부터=가장 가까운 3)
   */
  function queryStelvioHeptagonSumNeighbors(o) {
    o = o || {};
    if (!window.firestoreV9) {
      return Promise.resolve({ ok: false, above: [], below: [], error: 'no-db' });
    }
    var mySum = Number(o.mySum);
    if (!isFinite(mySum)) {
      return Promise.resolve({ ok: false, above: [], below: [], error: 'bad-sum' });
    }
    var monthKey = o.monthKey != null ? String(o.monthKey) : monthKeyKst();
    var filterCategory = o.filterCategory != null ? String(o.filterCategory) : 'Supremo';
    var filterGender = o.filterGender != null ? String(o.filterGender) : 'all';
    var myUserId = o.myUserId != null ? String(o.myUserId) : '';
    var lim = o.limit | 0;
    if (lim < 1) lim = 3;
    if (lim > 10) lim = 10;

    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.query || !mod.getDocs || !mod.collection) {
          return { ok: false, above: [], below: [], error: 'no-mod' };
        }
        var col = mod.collection(window.firestoreV9, COL);
        var qUp = mod.query(
          col,
          mod.where('monthKey', '==', monthKey),
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('sumPositionScores', '>', mySum),
          mod.orderBy('sumPositionScores', 'asc'),
          mod.limit(lim)
        );
        var qDown = mod.query(
          col,
          mod.where('monthKey', '==', monthKey),
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('sumPositionScores', '<', mySum),
          mod.orderBy('sumPositionScores', 'desc'),
          mod.limit(lim)
        );
        return Promise.all([mod.getDocs(qUp), mod.getDocs(qDown)]);
      })
      .then(function (ress) {
        if (!ress || ress.length < 2) {
          return { ok: false, above: [], below: [], error: 'no-result' };
        }
        var qsUp = ress[0];
        var qsDown = ress[1];
        var mapItem = function (doc) {
          var d = doc.data() || {};
          return {
            userId: d.userId != null ? String(d.userId) : doc.id,
            displayName: (d.displayName && String(d.displayName).trim()) || '—',
            sumPositionScores: d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : null,
            rank: d.comprehensiveRank != null && isFinite(Number(d.comprehensiveRank)) ? Math.floor(Number(d.comprehensiveRank)) : null
          };
        };
        var above = [];
        var below = [];
        if (qsUp && qsUp.forEach) {
          qsUp.forEach(function (d) {
            if (!d || !d.id) return;
            if (myUserId && d.id === myUserId) return;
            above.push(mapItem(d));
          });
        }
        if (qsDown && qsDown.forEach) {
          qsDown.forEach(function (d) {
            if (!d || !d.id) return;
            if (myUserId && d.id === myUserId) return;
            below.push(mapItem(d));
          });
        }
        above.sort(function (a, b) {
          var sa = a.sumPositionScores;
          var sb = b.sumPositionScores;
          if (sa == null) return 1;
          if (sb == null) return -1;
          return sb - sa;
        });
        return { ok: true, above: above, below: below, error: null };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[queryStelvioHeptagonSumNeighbors]', e && e.message ? e.message : e);
        }
        return { ok: false, above: [], below: [], error: String(e && e.message ? e.message : e) };
      });
  }

  window.getStelvioHeptagonRankLog = getStelvioHeptagonRankLog;
  window.queryStelvioHeptagonSumNeighbors = queryStelvioHeptagonSumNeighbors;
  window.queryStelvioHeptagonRankTop = queryStelvioHeptagonRankTop;
  window.getStelvioHeptagonRankLogCollectionName = function () {
    return COL;
  };
})();
