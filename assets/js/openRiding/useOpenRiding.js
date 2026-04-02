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
      const prof =
        typeof window !== 'undefined' && typeof window.getOpenRidingProfileDefaults === 'function'
          ? window.getOpenRidingProfileDefaults()
          : {};
      var dn = String(prof.hostName || '').trim().slice(0, 80);
      var phone = String(prof.contactInfo || '').trim().slice(0, 80);
      /** 참석 신청: Firestore users/{uid}가 최종 원천 — 로컬/세션 불일치 시에도 동일 userId 행의 name·contact만 기록 */
      try {
        if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function') {
          const row = await window.getUserByUid(String(userId));
          if (row && typeof row === 'object') {
            const n = String(row.name != null ? row.name : '').trim().slice(0, 80);
            const ph =
              String(row.contact != null ? row.contact : '').trim() ||
              String(row.phone != null ? row.phone : '').trim();
            if (n) dn = n;
            if (ph) phone = ph.slice(0, 80);
          }
        }
      } catch (eFetch) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[openRiding] join getUserByUid:', eFetch);
      }
      var cuJoin =
        typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser
          ? window.authV9.currentUser
          : typeof window !== 'undefined' && window.auth && window.auth.currentUser
            ? window.auth.currentUser
            : null;
      if (!phone && cuJoin && cuJoin.uid === String(userId) && cuJoin.phoneNumber) {
        phone = String(cuJoin.phoneNumber).trim().slice(0, 80);
      }
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
