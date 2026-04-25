/**
 * STELVIO 헵타곤 7축·종합(포지션 점수) — Firestore heptagon_rank_log 동기화
 * - `heptagon_cohort_ranks`: 서버 일괄 집계(전원 순위·이웃/탑 쿼리)
 * - `heptagon_rank_log/{uid}`: 대시보드가 마지막으로 캐시한 본인 요약(merge)
 */
/* global window */
(function () {
  'use strict';

  var COL = 'heptagon_rank_log';
  /** 랭킹·이웃: Cloud Function `scheduledHeptagonCohortRanks`가 채움 */
  var COL_COHORT = 'heptagon_cohort_ranks';

  /** `scheduledHeptagonCohortRanks`가 쓰는 문서 ID — 이웃 표 집계 순위용 */
  /**
   * Supremo가 아닐 때: 문서의 ageCategory가 선택 부문과 같을 때만 집계 행으로 인정(구버전 가상부문 문서 제외).
   */
  function stelvioCohortRowMatchesFilter(cohortData, filterCategory) {
    if (!cohortData) return false;
    var f = String(filterCategory != null ? filterCategory : 'Supremo');
    if (f === 'Supremo') return true;
    var ac = cohortData.ageCategory != null ? String(cohortData.ageCategory) : '';
    if (f === 'Assoluto') {
      return ac === 'Assoluto';
    }
    return ac === f;
  }

  function heptagonCohortDocId(monthKey, filterCategory, filterGender, userId) {
    var m = String(monthKey || '');
    var c = String(filterCategory != null ? filterCategory : 'Supremo');
    var g = String(filterGender != null ? filterGender : 'all');
    var u = String(userId != null ? userId : '').replace(/\//g, '_');
    return m + '_' + c + '_' + g + '_' + u;
  }

  /**
   * @param {{ userId: string, monthKey?: string, filterCategory?: string, filterGender?: string }} o
   * @returns {Promise<{ ok: boolean, exists?: boolean, data?: object|null, error?: string }>}
   */
  function getStelvioHeptagonCohortEntry(o) {
    o = o || {};
    if (!o.userId || !window.firestoreV9) {
      return Promise.resolve({ ok: false, data: null, error: 'no-uid' });
    }
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.getDoc || !mod.doc || !mod.collection) {
          return { __cohortErr: 'no-mod' };
        }
        var id = heptagonCohortDocId(o.monthKey, o.filterCategory, o.filterGender, o.userId);
        var ref = mod.doc(mod.collection(window.firestoreV9, COL_COHORT), id);
        return mod.getDoc(ref);
      })
      .then(function (snap) {
        if (snap && snap.__cohortErr) {
          return { ok: false, data: null, error: snap.__cohortErr };
        }
        if (snap == null) return { ok: false, data: null, error: 'no-snap' };
        if (typeof snap.exists === 'boolean' && !snap.exists) {
          return { ok: true, exists: false, data: null };
        }
        if (typeof snap.exists !== 'boolean') {
          return { ok: false, data: null, error: 'no-snap' };
        }
        var d = snap.data() || null;
        if (d && !stelvioCohortRowMatchesFilter(d, o.filterCategory)) {
          return { ok: true, exists: false, data: null };
        }
        return { ok: true, exists: true, data: d };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[getStelvioHeptagonCohortEntry]', e && e.message ? e.message : e);
        }
        return { ok: false, data: null, error: String(e && e.message ? e.message : e) };
      });
  }

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
   * @param {boolean} [p.isPrivate] 프로필 이름 비공개(랭킹보드 표기와 연동)
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
        if (p.isPrivate === true) {
          data.is_private = true;
        } else {
          data.is_private = false;
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
          mod.collection(window.firestoreV9, COL_COHORT),
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
          if (!x || !stelvioCohortRowMatchesFilter(x, filterCategory)) {
            return;
          }
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
   * 헵타곤 팝업: 동일 월·필터에서 **환산 점수 합** 높은 순(1,2,3…). 랭킹보드와 동일 집계 소스.
   * 인덱스: filterCategory, filterGender, monthKey, sumPositionScores desc
   * @param {{ monthKey: string, filterCategory: string, filterGender: string, limit?: number }} o
   */
  function queryStelvioHeptagonCohortBySumDesc(o) {
    o = o || {};
    if (!window.firestoreV9) {
      return Promise.resolve({ ok: false, items: [] });
    }
    var monthKey = o.monthKey != null ? String(o.monthKey) : monthKeyKst();
    var filterCategory = o.filterCategory != null ? String(o.filterCategory) : 'Supremo';
    var filterGender = o.filterGender != null ? String(o.filterGender) : 'all';
    var lim = o.limit | 0;
    if (lim < 1) {
      lim = 200;
    }
    if (lim > 500) {
      lim = 500;
    }
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.query || !mod.getDocs || !mod.collection) {
          return { ok: false, items: [] };
        }
        var col = mod.collection(window.firestoreV9, COL_COHORT);
        var qy = mod.query(
          col,
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('monthKey', '==', monthKey),
          mod.orderBy('sumPositionScores', 'desc'),
          mod.limit(lim)
        );
        return mod.getDocs(qy);
      })
      .then(function (qs) {
        var items = [];
        qs.forEach(function (d) {
          var x = d.data();
          if (!x || !stelvioCohortRowMatchesFilter(x, filterCategory)) {
            return;
          }
          x._id = d.id;
          items.push(x);
        });
        return { ok: true, items: items };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[queryStelvioHeptagonCohortBySumDesc]', e && e.message ? e.message : e);
        }
        return { ok: false, items: [], error: String(e && e.message ? e.message : e) };
      });
  }

  /**
   * 동일 월·필터 코호트의 **최고 boardRank(=집계 인원 N)**. 집계 레벨% = (boardRank / N)·100 에 사용.
   * 인덱스: filterCategory, filterGender, monthKey, boardRank desc
   * @param {{ monthKey: string, filterCategory: string, filterGender: string }} o
   * @returns {Promise<{ ok: boolean, nTotal: number, error?: string }>}
   */
  function queryStelvioHeptagonCohortBoardN(o) {
    o = o || {};
    if (!window.firestoreV9) {
      return Promise.resolve({ ok: false, nTotal: 0 });
    }
    var monthKey = o.monthKey != null ? String(o.monthKey) : monthKeyKst();
    var filterCategory = o.filterCategory != null ? String(o.filterCategory) : 'Supremo';
    var filterGender = o.filterGender != null ? String(o.filterGender) : 'all';
    return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
      .then(function (mod) {
        if (!mod || !mod.query || !mod.getDocs || !mod.collection) {
          return { __empty: 'no-mod' };
        }
        var col = mod.collection(window.firestoreV9, COL_COHORT);
        var qy = mod.query(
          col,
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('monthKey', '==', monthKey),
          mod.orderBy('boardRank', 'desc'),
          mod.limit(1)
        );
        return mod.getDocs(qy);
      })
      .then(function (qs) {
        if (qs && qs.__empty) {
          return { ok: false, nTotal: 0 };
        }
        if (!qs || !qs.size || !qs.forEach) {
          return { ok: true, nTotal: 0 };
        }
        var maxN = 0;
        qs.forEach(function (d) {
          var x = d.data();
          if (!x || !stelvioCohortRowMatchesFilter(x, filterCategory)) {
            return;
          }
          var b = x.boardRank;
          if (b == null && x.comprehensiveRank != null) {
            b = x.comprehensiveRank;
          }
          if (b != null && isFinite(b)) {
            var bi = Math.floor(Number(b));
            if (bi > maxN) maxN = bi;
          }
        });
        return { ok: true, nTotal: maxN };
      })
      .catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[queryStelvioHeptagonCohortBoardN]', e && e.message ? e.message : e);
        }
        return { ok: false, nTotal: 0, error: String(e && e.message ? e.message : e) };
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
        var col = mod.collection(window.firestoreV9, COL_COHORT);
        var qUp = mod.query(
          col,
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('monthKey', '==', monthKey),
          mod.where('sumPositionScores', '>', mySum),
          mod.orderBy('sumPositionScores', 'asc'),
          mod.limit(lim)
        );
        var qDown = mod.query(
          col,
          mod.where('filterCategory', '==', filterCategory),
          mod.where('filterGender', '==', filterGender),
          mod.where('monthKey', '==', monthKey),
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
          if (!stelvioCohortRowMatchesFilter(d, filterCategory)) {
            return null;
          }
          return {
            userId: d.userId != null ? String(d.userId) : doc.id,
            displayName: (d.displayName && String(d.displayName).trim()) || '—',
            sumPositionScores: d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : null,
            rank:
              d.boardRank != null && isFinite(Number(d.boardRank))
                ? Math.floor(Number(d.boardRank))
                : d.comprehensiveRank != null && isFinite(Number(d.comprehensiveRank))
                  ? Math.floor(Number(d.comprehensiveRank))
                  : null,
            isPrivate: d.is_private === true
          };
        };
        var above = [];
        var below = [];
        if (qsUp && qsUp.forEach) {
          qsUp.forEach(function (d) {
            if (!d || !d.id) return;
            var rowUid = d.data() && d.data().userId != null ? String(d.data().userId) : '';
            if (myUserId && rowUid === String(myUserId)) return;
            var item = mapItem(d);
            if (item) {
              above.push(item);
            }
          });
        }
        if (qsDown && qsDown.forEach) {
          qsDown.forEach(function (d) {
            if (!d || !d.id) return;
            var rowUid2 = d.data() && d.data().userId != null ? String(d.data().userId) : '';
            if (myUserId && rowUid2 === String(myUserId)) return;
            var item2 = mapItem(d);
            if (item2) {
              below.push(item2);
            }
          });
        }
        // sum > mySum, orderBy sum asc 쿼리 결과 — 표시: 나에 **가장 가까운(점수 차 작은)** 이웃이 먼저(위쪽)
        above.sort(function (a, b) {
          var sa = a.sumPositionScores;
          var sb = b.sumPositionScores;
          if (sa == null) return 1;
          if (sb == null) return -1;
          return sa - sb;
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
  window.queryStelvioHeptagonCohortBySumDesc = queryStelvioHeptagonCohortBySumDesc;
  window.queryStelvioHeptagonCohortBoardN = queryStelvioHeptagonCohortBoardN;
  window.getStelvioHeptagonRankLogCollectionName = function () {
    return COL;
  };
  window.getStelvioHeptagonCohortCollectionName = function () {
    return COL_COHORT;
  };
  window.getStelvioHeptagonCohortEntry = getStelvioHeptagonCohortEntry;
  window.heptagonCohortDocId = heptagonCohortDocId;
  window.stelvioCohortRowMatchesFilter = stelvioCohortRowMatchesFilter;
})();
