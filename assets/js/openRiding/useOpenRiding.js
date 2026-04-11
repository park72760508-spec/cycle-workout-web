/**
 * 오픈 라이딩방 React Hook
 * @requires React 17+ (전역 window.React 또는 import)
 */
/* global React */
var useState = React.useState;
var useEffect = React.useEffect;
var useCallback = React.useCallback;
var useMemo = React.useMemo;
import {
  saveUserOpenRidingPreferences,
  getUserOpenRidingPreferences,
  fetchRidesInDateRange,
  computeMatchingRideDates,
  computeHostRideDateKeys,
  joinRideTransaction,
  leaveRideTransaction,
  fetchRideById
} from './openRidingService.js';

/**
 * @param {import('firebase/firestore').Firestore | null} db
 * @param {string | null} userId
 * @param {Date} [anchorMonth] 표시 월 기준일
 */
export function useOpenRiding(db, userId, anchorMonth) {
  const [prefs, setPrefs] = useState({ activeRegions: [], preferredLevels: [] });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [ridesMonth, setRidesMonth] = useState([]);
  const [loadingRides, setLoadingRides] = useState(false);
  const [error, setError] = useState(null);

  const monthRange = useMemo(() => {
    const base = anchorMonth ? new Date(anchorMonth) : new Date();
    base.setDate(1);
    base.setHours(0, 0, 0, 0);
    const start = new Date(base);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }, [anchorMonth]);

  useEffect(() => {
    if (!db || !userId) {
      setPrefsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await getUserOpenRidingPreferences(db, userId);
        if (!cancelled) setPrefs(p);
      } catch (e) {
        if (!cancelled) setError((e && e.message) || 'prefs_load_failed');
      } finally {
        if (!cancelled) setPrefsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [db, userId]);

  const refreshMonth = useCallback(async () => {
    if (!db) return;
    setLoadingRides(true);
    setError(null);
    try {
      const list = await fetchRidesInDateRange(db, monthRange.start, monthRange.end);
      setRidesMonth(list);
    } catch (e) {
      setError((e && e.message) || 'rides_load_failed');
      setRidesMonth([]);
    } finally {
      setLoadingRides(false);
    }
  }, [db, monthRange.start, monthRange.end]);

  useEffect(() => {
    refreshMonth();
  }, [refreshMonth]);

  const matchingDateKeys = useMemo(
    () => computeMatchingRideDates(ridesMonth, prefs),
    [ridesMonth, prefs]
  );

  const hostDateKeys = useMemo(
    () => computeHostRideDateKeys(ridesMonth, userId),
    [ridesMonth, userId]
  );

  const savePrefs = useCallback(
    async (next) => {
      if (!db || !userId) return;
      await saveUserOpenRidingPreferences(db, userId, next);
      setPrefs(next);
    },
    [db, userId]
  );

  return {
    prefs,
    prefsLoaded,
    savePrefs,
    ridesMonth,
    loadingRides,
    error,
    matchingDateKeys,
    hostDateKeys,
    refreshMonth,
    monthRange
  };
}

/**
 * 상세 + 참석 액션
 * @param {import('firebase/firestore').Firestore | null} db
 * @param {string | null} rideId
 * @param {string | null} userId
 */
export function useOpenRideDetail(db, rideId, userId) {
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState(null);

  const reload = useCallback(async () => {
    if (!db || !rideId) {
      setRide(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchRideById(db, rideId);
      setRide(r);
    } finally {
      setLoading(false);
    }
  }, [db, rideId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const join = useCallback(async (joinOptions) => {
    if (!db || !rideId || !userId) return;
    setActionError(null);
    try {
      var uid = String(userId);
      var dn = '';
      var phone = '';
      var cuJoin =
        typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser
          ? window.authV9.currentUser
          : typeof window !== 'undefined' && window.auth && window.auth.currentUser
            ? window.auth.currentUser
            : null;
      /** 1) Firebase Auth 전화 — 세션 UID == 참가 userId 일 때만 */
      if (cuJoin && String(cuJoin.uid) === uid && cuJoin.phoneNumber) {
        phone = String(cuJoin.phoneNumber).trim().slice(0, 80);
      }
      /** 2) 앱 전화 DB 인증 직후 저장값(authUser·currentUser) — UID 일치할 때만, Firebase phone 미사용 앱 대비 */
      try {
        if (typeof window !== 'undefined') {
          var au2 = null;
          try { au2 = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch (eA2) { au2 = null; }
          if (au2 && String(au2.id != null ? au2.id : au2.uid != null ? au2.uid : '') === uid) {
            if (!dn) dn = String(au2.name || '').trim().slice(0, 80);
            if (!phone) {
              phone = (
                String(au2.contact != null ? au2.contact : '').trim() ||
                String(au2.phone != null ? au2.phone : '').trim()
              ).slice(0, 80);
            }
          }
          if (
            (!dn || !phone) &&
            window.currentUser &&
            String(window.currentUser.id != null ? window.currentUser.id : window.currentUser.uid != null ? window.currentUser.uid : '') ===
              uid
          ) {
            var c2 = window.currentUser;
            if (!dn) dn = String(c2.name || '').trim().slice(0, 80);
            if (!phone) {
              phone = (
                String(c2.contact != null ? c2.contact : '').trim() ||
                String(c2.phone != null ? c2.phone : '').trim()
              ).slice(0, 80);
            }
          }
        }
      } catch (eLoc) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[openRiding] join local profile:', eLoc);
      }
      /** 3) Firestore users/{uid} — 이름·번호 보강(문서 contact가 오래됐거나 비어 있을 수 있음) */
      try {
        if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function') {
          const row = await window.getUserByUid(uid);
          if (row && typeof row === 'object') {
            const n = String(row.name != null ? row.name : '').trim().slice(0, 80);
            const ph = (
              String(row.contact != null ? row.contact : '').trim() ||
              String(row.phone != null ? row.phone : '').trim()
            ).slice(0, 80);
            if (n) dn = n;
            if (!phone && ph) phone = ph;
          }
        }
      } catch (eFetch) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[openRiding] join getUserByUid:', eFetch);
      }
      /** 4) 마지막 수단 — getOpenRidingProfileDefaults(절대 먼저 쓰지 않음: users 문서 contact 비어 있을 때 방장 번호가 들어가던 버그) */
      var prof =
        typeof window !== 'undefined' && typeof window.getOpenRidingProfileDefaults === 'function'
          ? window.getOpenRidingProfileDefaults()
          : {};
      if (!dn) dn = String(prof.hostName || '').trim().slice(0, 80);
      if (!phone) phone = String(prof.contactInfo || '').trim().slice(0, 80);

      const jopt = joinOptions && typeof joinOptions === 'object' ? joinOptions : {};
      const res = await joinRideTransaction(db, rideId, userId, dn || '라이더', phone, {
        contactPublicToParticipants: !!jopt.contactPublicToParticipants,
        joinPasswordAttempt: String(jopt.joinPasswordAttempt != null ? jopt.joinPasswordAttempt : '')
          .replace(/\D/g, '')
          .slice(0, 4)
      });
      await reload();
      return res;
    } catch (e) {
      const raw = (e && e.message) || 'join_failed';
      const msg =
        raw === 'RIDE_CANCELLED'
          ? '취소된 라이딩에는 참석할 수 없습니다.'
          : raw === 'INVITE_ONLY'
            ? '초대받은 사용자만 참석 신청할 수 있습니다.'
            : raw === 'RIDE_JOIN_CLOSED'
              ? '이 모임은 일정이 지났거나, 오늘 일정은 방장 라이딩 기록(모임 거리 ±10% 또는 모임보다 긴 거리)이 확인되어 참석 신청이 마감되었습니다.'
              : raw;
      setActionError(msg);
      throw e;
    }
  }, [db, rideId, userId, reload]);

  const leave = useCallback(async () => {
    if (!db || !rideId || !userId) return;
    setActionError(null);
    try {
      const res = await leaveRideTransaction(db, rideId, userId);
      await reload();
      return res;
    } catch (e) {
      const msg = (e && e.message) || 'leave_failed';
      setActionError(msg);
      throw e;
    }
  }, [db, rideId, userId, reload]);

  const role = useMemo(() => {
    if (!ride || !userId) return null;
    const p = Array.isArray(ride.participants) ? ride.participants : [];
    const w = Array.isArray(ride.waitlist) ? ride.waitlist : [];
    if (p.includes(userId)) return 'participant';
    const wi = w.indexOf(userId);
    if (wi >= 0) return { type: 'waitlist', position: wi + 1 };
    return null;
  }, [ride, userId]);

  return { ride, loading, actionError, join, leave, reload, role };
}

if (typeof window !== 'undefined') {
  window.useOpenRiding = useOpenRiding;
  window.useOpenRideDetail = useOpenRideDetail;
}
