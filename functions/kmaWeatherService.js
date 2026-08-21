/**
 * 라이딩/러닝 모임 "출발 지역" 날씨 — 기상청 단기예보(getVilageFcst) 조회.
 * 위경도 → 격자(nx,ny) 변환은 기상청 공식 LCC DFS 격자 변환 공식(RE=6371.00877 등)을 그대로 사용.
 */
const { KOREA_REGION_WEATHER_COORDS } = require("./koreaRegionWeatherCoords");

const KMA_BASE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const KMA_BASE_TIMES = ["0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300"];
const TARGET_HOURS = [6, 8, 10, 12, 14, 16, 18];
/** 1시간 캐시 — 같은 모임을 여러 명이 같은 시간대에 봐도 API 호출은 아껴가며, 갱신 주기는 1시간 단위로 유지 */
const CACHE_TTL_MS = 60 * 60 * 1000;

// 기상청 "단기예보 조회서비스 활용가이드"의 LCC(Lambert Conformal Conic) 격자 변환 상수
const RE = 6371.00877;
const GRID = 5.0;
const SLAT1 = 30.0;
const SLAT2 = 60.0;
const OLON = 126.0;
const OLAT = 38.0;
const XO = 43;
const YO = 136;
const DEGRAD = Math.PI / 180.0;

function latLonToGrid(lat, lon) {
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** koreaRegions.js와 동일한 "시도 구군" 문자열(ride.region)을 격자로 변환 */
function resolveRegionGrid(regionStr) {
  const key = String(regionStr || "").trim();
  if (!key) return null;
  const coord = KOREA_REGION_WEATHER_COORDS[key];
  if (!coord) return null;
  return Object.assign({ region: key }, latLonToGrid(coord.lat, coord.lon));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 서버 TZ와 무관하게 "지금"을 KST 벽시계로 변환 */
function nowKst() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 9 * 60 * 60000);
}

function ymdCompact(d) {
  return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

/**
 * 가장 최근 발표된 base_date/base_time(YYYYMMDD/HHMM).
 * 발표 후 API 반영까지 약 10분 지연되므로 여유를 두고 판단.
 */
function getLatestBaseDateTime(refKstDate) {
  const t = new Date((refKstDate || nowKst()).getTime() - 10 * 60000);
  const hhmm = pad2(t.getHours()) + pad2(t.getMinutes());
  for (let i = KMA_BASE_TIMES.length - 1; i >= 0; i--) {
    if (hhmm >= KMA_BASE_TIMES[i]) {
      return { baseDate: ymdCompact(t), baseTime: KMA_BASE_TIMES[i] };
    }
  }
  // 00:00~02:09 — 전날 23:00 발표분 사용
  const prevDay = new Date(t.getTime() - 24 * 60 * 60000);
  return { baseDate: ymdCompact(prevDay), baseTime: "2300" };
}

const SKY_ICON = { 1: "☀️", 3: "⛅", 4: "☁️" };
const SKY_LABEL = { 1: "맑음", 3: "구름많음", 4: "흐림" };
const PTY_ICON = { 1: "🌧️", 2: "🌨️", 3: "❄️", 4: "🌦️" };
const PTY_LABEL = { 1: "비", 2: "비/눈", 3: "눈", 4: "소나기" };

function iconAndLabelFor(sky, pty) {
  const ptyKey = pty != null ? String(pty) : "";
  if (ptyKey && ptyKey !== "0" && PTY_ICON[ptyKey]) {
    return { icon: PTY_ICON[ptyKey], label: PTY_LABEL[ptyKey] };
  }
  const skyKey = sky != null ? String(sky) : "";
  if (skyKey && SKY_ICON[skyKey]) {
    return { icon: SKY_ICON[skyKey], label: SKY_LABEL[skyKey] };
  }
  return { icon: "🌡️", label: "" };
}

async function fetchKmaVilageFcst(nx, ny, baseDate, baseTime, serviceKey) {
  const url =
    KMA_BASE_URL +
    "?serviceKey=" + encodeURIComponent(serviceKey) +
    "&pageNo=1&numOfRows=1000&dataType=JSON" +
    "&base_date=" + baseDate +
    "&base_time=" + baseTime +
    "&nx=" + nx +
    "&ny=" + ny;
  const res = await fetch(url);
  if (!res.ok) throw new Error("KMA HTTP " + res.status);
  const json = await res.json();
  const header = json && json.response && json.response.header;
  if (!header || header.resultCode !== "00") {
    throw new Error("KMA resultCode " + (header && header.resultCode) + " " + (header && header.resultMsg));
  }
  const items = json.response.body && json.response.body.items && json.response.body.items.item;
  return Array.isArray(items) ? items : [];
}

/**
 * @param {string} regionStr 예: "서울특별시 강남구" (ride.region과 동일 포맷)
 * @param {string} targetYmd 예: "2026-08-25" (모임 당일, KST 기준)
 * @param {string} serviceKey 기상청 단기예보 조회서비스 서비스키(공공데이터포털)
 * @param {FirebaseFirestore.Firestore} [db] 제공 시 3시간 TTL Firestore 캐시 사용
 */
async function getDepartureWeatherForRegion(regionStr, targetYmd, serviceKey, db) {
  const grid = resolveRegionGrid(regionStr);
  if (!grid) {
    return { success: false, error: "unsupported_region" };
  }
  const targetCompact = String(targetYmd || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(targetCompact)) {
    return { success: false, error: "invalid_date" };
  }

  const today = nowKst();
  const todayYmd = ymdCompact(today);
  if (targetCompact < todayYmd) {
    return { success: true, region: grid.region, date: targetYmd, hours: [], note: "지난 일정" };
  }

  const cacheKey = grid.nx + "_" + grid.ny + "_" + targetCompact;
  const cacheRef = db ? db.collection("weather_forecast_cache").doc(cacheKey) : null;
  if (cacheRef) {
    try {
      const snap = await cacheRef.get();
      if (snap.exists) {
        const d = snap.data() || {};
        const fetchedAt = Number(d.fetchedAtMs || 0);
        if (Array.isArray(d.hours) && Date.now() - fetchedAt < CACHE_TTL_MS) {
          return { success: true, region: grid.region, date: targetYmd, hours: d.hours, note: d.note || null, cached: true };
        }
      }
    } catch (eCache) {
      console.warn("[kmaWeatherService] cache read failed:", eCache && eCache.message);
    }
  }

  const { baseDate, baseTime } = getLatestBaseDateTime(today);
  let items;
  try {
    items = await fetchKmaVilageFcst(grid.nx, grid.ny, baseDate, baseTime, serviceKey);
  } catch (eFetch) {
    return { success: false, error: "kma_fetch_failed", message: eFetch && eFetch.message };
  }

  const byFcstTime = {};
  items.forEach((it) => {
    if (it.fcstDate !== targetCompact) return;
    if (it.category !== "TMP" && it.category !== "SKY" && it.category !== "PTY") return;
    const t = it.fcstTime;
    if (!byFcstTime[t]) byFcstTime[t] = {};
    byFcstTime[t][it.category] = it.fcstValue;
  });

  const hours = TARGET_HOURS.map((h) => {
    const row = byFcstTime[pad2(h) + "00"];
    if (!row) return { hour: h, tempC: null, sky: null, pty: null, icon: null, label: null };
    const tempC = row.TMP != null ? Number(row.TMP) : null;
    const meta = iconAndLabelFor(row.SKY, row.PTY);
    return {
      hour: h,
      tempC: isFinite(tempC) ? tempC : null,
      sky: row.SKY != null ? String(row.SKY) : null,
      pty: row.PTY != null ? String(row.PTY) : null,
      icon: meta.icon,
      label: meta.label,
    };
  });

  const hasAny = hours.some((h) => h.tempC != null);
  const note = hasAny ? null : "아직 예보가 제공되지 않는 기간입니다 (약 3일 이내 일정만 제공)";

  if (cacheRef) {
    try {
      await cacheRef.set({ hours, note, fetchedAtMs: Date.now(), baseDate, baseTime });
    } catch (eWrite) {
      console.warn("[kmaWeatherService] cache write failed:", eWrite && eWrite.message);
    }
  }

  return { success: true, region: grid.region, date: targetYmd, hours, note };
}

module.exports = {
  resolveRegionGrid,
  getLatestBaseDateTime,
  getDepartureWeatherForRegion,
  latLonToGrid,
};
