/**
 * 라이딩/러닝 모임 "출발 지역" 날씨 — 기상청 단기예보(getVilageFcst)를 우선 사용하고,
 * 실패하거나(연결 문제 등) 해당 날짜에 값이 없으면 Open-Meteo(무료·API 키 불필요)로
 * 자동 전환한다. 위경도 → 격자(nx,ny) 변환은 기상청 공식 LCC DFS 격자 변환 공식
 * (RE=6371.00877 등)을 그대로 사용(Open-Meteo는 위경도를 그대로 받아 변환이 필요 없음).
 */
const { KOREA_REGION_WEATHER_COORDS } = require("./koreaRegionWeatherCoords");

const KMA_BASE_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const KMA_BASE_TIMES = ["0200", "0500", "0800", "1100", "1400", "1700", "2000", "2300"];
const TARGET_HOURS = [6, 8, 10, 12, 14, 16, 18];
/** 기상청 발표 주기(3시간)와 동일하게 캐시 — 같은 모임을 여러 명이 봐도 API 호출 1회로 절감 */
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

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
  return Object.assign({ region: key, lat: coord.lat, lon: coord.lon }, latLonToGrid(coord.lat, coord.lon));
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

/**
 * 기상청 API(apis.data.go.kr)는 Cloud Functions 쪽 아웃바운드 연결이 장시간(2026-08-26
 * 확인 — asia-northeast3에서 50분 넘게 지속) 타임아웃되는 경우가 있다. 원인이 기상청 쪽
 * IP 정책 변경인지 GCP 아웃바운드 라우팅 문제인지 원격에서 특정할 수 없어 근본 해결이
 * 불확실하므로, 실패 시 즉시 Open-Meteo(무료·API 키 불필요·글로벌 CDN이라 도달성이 훨씬
 * 안정적)로 자동 전환한다(getDepartureWeatherForRegion 참고). 여기서는 빨리 실패해
 * 폴백으로 넘어가도록 타임아웃을 8초로 줄였다(기존 15초 × 재시도 1회 = 최대 30초 대기는
 * 사용자 체감상 너무 길었음).
 */
async function fetchKmaVilageFcstOnce(nx, ny, baseDate, baseTime, serviceKey) {
  const url =
    KMA_BASE_URL +
    "?serviceKey=" + encodeURIComponent(serviceKey) +
    "&pageNo=1&numOfRows=1000&dataType=JSON" +
    "&base_date=" + baseDate +
    "&base_time=" + baseTime +
    "&nx=" + nx +
    "&ny=" + ny;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    const cause = e && e.cause ? " (" + (e.cause.code || e.cause.message || e.cause) + ")" : "";
    throw new Error("KMA fetch 실패: " + (e && e.message ? e.message : String(e)) + cause);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error("KMA HTTP " + res.status);
  const json = await res.json();
  const header = json && json.response && json.response.header;
  if (!header || header.resultCode !== "00") {
    throw new Error("KMA resultCode " + (header && header.resultCode) + " " + (header && header.resultMsg));
  }
  const items = json.response.body && json.response.body.items && json.response.body.items.item;
  return Array.isArray(items) ? items : [];
}

// 실패 시 곧바로 Open-Meteo 폴백으로 넘어가므로(같은 죽은 호스트에 재시도하는 대신),
// 여기서 재시도는 하지 않는다 — 실패 경로 최대 대기 시간을 8초로 묶어 사용자 체감을 개선.
async function fetchKmaVilageFcst(nx, ny, baseDate, baseTime, serviceKey) {
  return fetchKmaVilageFcstOnce(nx, ny, baseDate, baseTime, serviceKey);
}

// ── Open-Meteo 폴백(무료, API 키 불필요) ──────────────────────────────────
// WMO 일기 코드(weathercode) → 기존 SKY/PTY 아이콘 체계와 톤을 맞춘 이모지·라벨.
// https://open-meteo.com/en/docs 의 "WMO Weather interpretation codes" 표 기준.
const WMO_ICON_LABEL = [
  { codes: [0], icon: "☀️", label: "맑음" },
  { codes: [1, 2], icon: "⛅", label: "구름많음" },
  { codes: [3], icon: "☁️", label: "흐림" },
  { codes: [45, 48], icon: "🌫️", label: "안개" },
  { codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], icon: "🌧️", label: "비" },
  { codes: [71, 73, 75, 77, 85, 86], icon: "❄️", label: "눈" },
  { codes: [95, 96, 99], icon: "⛈️", label: "뇌우" },
];
function wmoIconAndLabel(code) {
  const n = Number(code);
  const hit = WMO_ICON_LABEL.find((g) => g.codes.indexOf(n) !== -1);
  return hit ? { icon: hit.icon, label: hit.label } : { icon: "🌡️", label: "" };
}

/**
 * Open-Meteo는 위경도를 그대로 받아 격자 변환이 필요 없고, API 키 없이 무료로 시간별
 * 예보(최대 16일)를 제공한다 — KMA가 실패했을 때의 폴백 소스.
 */
async function fetchOpenMeteoHours(lat, lon, targetYmd) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + encodeURIComponent(lat) +
    "&longitude=" + encodeURIComponent(lon) +
    "&hourly=temperature_2m,weathercode" +
    "&timezone=" + encodeURIComponent("Asia/Seoul") +
    "&start_date=" + targetYmd +
    "&end_date=" + targetYmd;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    const cause = e && e.cause ? " (" + (e.cause.code || e.cause.message || e.cause) + ")" : "";
    throw new Error("Open-Meteo fetch 실패: " + (e && e.message ? e.message : String(e)) + cause);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error("Open-Meteo HTTP " + res.status);
  const json = await res.json();
  const times = json && json.hourly && json.hourly.time;
  const temps = json && json.hourly && json.hourly.temperature_2m;
  const codes = json && json.hourly && json.hourly.weathercode;
  if (!Array.isArray(times)) throw new Error("Open-Meteo 응답 형식 오류");

  const byHour = {};
  times.forEach((iso, i) => {
    const hh = Number(String(iso).slice(11, 13));
    byHour[hh] = { tempC: temps ? Number(temps[i]) : null, code: codes ? codes[i] : null };
  });

  return TARGET_HOURS.map((h) => {
    const row = byHour[h];
    if (!row) return { hour: h, tempC: null, sky: null, pty: null, icon: null, label: null };
    const meta = wmoIconAndLabel(row.code);
    return {
      hour: h,
      tempC: isFinite(row.tempC) ? row.tempC : null,
      sky: null,
      pty: null,
      icon: meta.icon,
      label: meta.label,
    };
  });
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
          return { success: true, region: grid.region, date: targetYmd, hours: d.hours, note: d.note || null, source: d.source || null, cached: true };
        }
      }
    } catch (eCache) {
      console.warn("[kmaWeatherService] cache read failed:", eCache && eCache.message);
    }
  }

  const { baseDate, baseTime } = getLatestBaseDateTime(today);
  let hours = null;
  let source = null;

  try {
    const items = await fetchKmaVilageFcst(grid.nx, grid.ny, baseDate, baseTime, serviceKey);
    const byFcstTime = {};
    items.forEach((it) => {
      if (it.fcstDate !== targetCompact) return;
      if (it.category !== "TMP" && it.category !== "SKY" && it.category !== "PTY") return;
      const t = it.fcstTime;
      if (!byFcstTime[t]) byFcstTime[t] = {};
      byFcstTime[t][it.category] = it.fcstValue;
    });
    const availableFcstTimes = Object.keys(byFcstTime);

    /**
     * 기상청 단기예보는 예보 지평선 끝자락(발표 시점 기준 약 2.5~3일 뒤)에서 시간별이 아니라
     * 6·12·18시처럼 3~6시간 간격으로만 값을 제공하는 경우가 있다(실측 확인 — 정확히 이
     * 증상으로 06/08/10/12/14/16/18시 중 06·12·18시만 채워짐). 정확히 그 시각이 없으면
     * 같은 날짜 안에서 가장 가까운 시각의 예보로 대체해 빈 칸("-")이 남지 않게 한다.
     */
    const nearestRow = (h) => {
      const exact = byFcstTime[pad2(h) + "00"];
      if (exact) return exact;
      const targetMin = h * 60;
      let nearestKey = null;
      let nearestDiff = Infinity;
      availableFcstTimes.forEach((t) => {
        const tMin = Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
        const diff = Math.abs(tMin - targetMin);
        if (diff < nearestDiff) {
          nearestDiff = diff;
          nearestKey = t;
        }
      });
      return nearestKey ? byFcstTime[nearestKey] : null;
    };

    const kmaHours = TARGET_HOURS.map((h) => {
      const row = nearestRow(h);
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
    if (kmaHours.some((h) => h.tempC != null)) {
      hours = kmaHours;
      source = "kma";
    }
  } catch (eFetch) {
    console.warn("[kmaWeatherService] KMA 조회 실패, Open-Meteo로 폴백:", eFetch && eFetch.message);
  }

  // KMA가 실패했거나(연결 문제 등) 그 날짜에 값이 전혀 없으면(아직 예보 지평선 밖) 무료·키
  // 불필요·글로벌 CDN이라 도달성이 훨씬 안정적인 Open-Meteo로 자동 전환해, 사용자에게
  // "날씨 정보를 불러올 수 없습니다"가 뜨는 상황을 최대한 피한다.
  if (!hours) {
    try {
      hours = await fetchOpenMeteoHours(grid.lat, grid.lon, targetYmd);
      source = "open-meteo";
    } catch (eOpenMeteo) {
      console.warn("[kmaWeatherService] Open-Meteo 폴백도 실패:", eOpenMeteo && eOpenMeteo.message);
    }
  }

  if (!hours) {
    return { success: false, error: "weather_fetch_failed", message: "기상청·Open-Meteo 모두 조회에 실패했습니다." };
  }

  const hasAny = hours.some((h) => h.tempC != null);
  const note = hasAny ? null : "아직 예보가 제공되지 않는 기간입니다 (약 3일 이내 일정만 제공)";

  if (cacheRef) {
    try {
      await cacheRef.set({ hours, note, source, fetchedAtMs: Date.now(), baseDate, baseTime });
    } catch (eWrite) {
      console.warn("[kmaWeatherService] cache write failed:", eWrite && eWrite.message);
    }
  }

  return { success: true, region: grid.region, date: targetYmd, hours, note, source };
}

module.exports = {
  resolveRegionGrid,
  getLatestBaseDateTime,
  getDepartureWeatherForRegion,
  latLonToGrid,
};
