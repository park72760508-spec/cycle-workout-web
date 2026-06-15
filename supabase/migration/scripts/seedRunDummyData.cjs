/**
 * RUN 테스터용 더미 데이터 — activities + run_activity_efforts
 * Usage: node scripts/seedRunDummyData.cjs [firebase_uid]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const { v5: uuidv5 } = require("uuid");
const crypto = require("crypto");

const FIREBASE_UID = process.argv[2] || "Ys8GQZYyf3ZoEunSVGKnWNbtSkv2";
const NAMESPACE = process.env.STELVIO_UID_NAMESPACE || "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function resolveUserUuid(firebaseUid) {
  return uuidv5(String(firebaseUid).trim(), NAMESPACE);
}

/** pace "m:ss" per km → m/s */
function paceToSpeed(paceStr) {
  const [m, s] = paceStr.split(":").map(Number);
  const sec = m * 60 + s;
  return 1000 / sec;
}

/** m/s → km/h */
function speedToKmh(speed) {
  return Math.round(speed * 3.6 * 100) / 100;
}

/** 거리·페이스로 duration_sec */
function durationFromKmPace(km, paceStr) {
  const [m, s] = paceStr.split(":").map(Number);
  return Math.round(km * (m * 60 + s));
}

function estimateTss(durationSec, avgHr) {
  // 중간 강도 러닝 추정 TSS (간단 모델)
  const intensity = Math.min(1.2, Math.max(0.5, (avgHr - 120) / 60));
  return Math.round((durationSec / 3600) * intensity * 100 * 10) / 10;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/** 동호인 중간 수준 베이스 페이스 (짧을수록 빠름, 단조 감소 보장) */
const BASE_PACES = {
  "1k": "4:48",
  "3k": "5:05",
  "5k": "5:22",
  "7k": "5:35",
  "10k": "5:48",
  "20k": "6:08",
  "42k": "6:22",
};

const RUN_TEMPLATES = [
  { type: "easy", distKm: [5, 6, 7, 8], paceKey: "10k", title: ["아침 조깅", "회복런", "이지런", "저녁 러닝"] },
  { type: "tempo", distKm: [8, 10, 12], paceKey: "7k", title: ["템포런", "역치런", "빌드업"] },
  { type: "long", distKm: [15, 18, 21], paceKey: "20k", title: ["롱런", "주말 장거리", "LSD"] },
  { type: "interval", distKm: [6, 8], paceKey: "5k", title: ["인터벌", "트랙 세션", "스피드워크"] },
  { type: "race5k", distKm: [5], paceKey: "5k", title: ["5K 레이스", "공원 마라톤 5K", "동호회 대회 5K"] },
  { type: "race10k", distKm: [10], paceKey: "10k", title: ["10K 레이스", "하프 시리즈 10K", "봄 마라톤 10K"] },
  { type: "raceHM", distKm: [21.1], paceKey: "20k", title: ["하프 마라톤", "21K 챌린지", "반마라톤 대회"] },
  { type: "raceFM", distKm: [42.2], paceKey: "42k", title: ["풀 마라톤", "42K 완주", "서울 마라톤"] },
];

function buildEfforts(distKm, fitnessJitter = 0) {
  const jitter = () => 1 + randomBetween(-fitnessJitter, fitnessJitter);
  const efforts = {};
  const thresholds = [
    ["1k", 1],
    ["3k", 3],
    ["5k", 5],
    ["7k", 7],
    ["10k", 10],
    ["20k", 20],
    ["42k", 42],
  ];

  for (const [key, minKm] of thresholds) {
    if (distKm + 0.5 < minKm) {
      efforts[`speed_${key}`] = null;
      efforts[`hr_${key}`] = null;
      continue;
    }
    const baseSpeed = paceToSpeed(BASE_PACES[key]) * jitter();
    efforts[`speed_${key}`] = Math.round(baseSpeed * 1000) / 1000;
    const isLong = key === "20k" || key === "42k";
    const hrBase = isLong ? 178 : 162 + (key === "1k" ? 8 : key === "3k" ? 5 : 0);
    efforts[`hr_${key}`] = Math.round(hrBase + randomBetween(-6, 8));
  }

  // 단조 감소 보정: speed_1k >= ... >= speed_42k
  const keys = ["1k", "3k", "5k", "7k", "10k", "20k", "42k"];
  let prev = Infinity;
  for (const k of keys) {
    const col = `speed_${k}`;
    if (efforts[col] == null) continue;
    if (efforts[col] > prev) efforts[col] = Math.round((prev - 0.02) * 1000) / 1000;
    prev = efforts[col];
  }

  return efforts;
}

function generateSchedule(startDate, endDate) {
  const activities = [];
  let cursor = new Date(startDate);
  const end = new Date(endDate);
  let weekFitness = 0;

  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow === 1 || dow === 3 || dow === 5 || (dow === 0 && Math.random() < 0.85)) {
      weekFitness = randomBetween(-0.03, 0.03);
      let template;
      if (dow === 0) {
        template = Math.random() < 0.15 ? pick(RUN_TEMPLATES.filter((t) => t.type.startsWith("race"))) : pick(RUN_TEMPLATES.filter((t) => t.type === "long" || t.type === "easy"));
      } else if (dow === 3 && Math.random() < 0.35) {
        template = pick(RUN_TEMPLATES.filter((t) => t.type === "tempo" || t.type === "interval"));
      } else {
        template = pick(RUN_TEMPLATES.filter((t) => t.type === "easy" || t.type === "tempo"));
      }

      const distKm = pick(template.distKm);
      const paceKey = template.paceKey;
      const paceStr = BASE_PACES[paceKey];
      const durationSec = durationFromKmPace(distKm, paceStr);
      const avgSpeed = distKm * 1000 / durationSec;
      const avgHr = Math.round(155 + randomBetween(-8, 12) + (paceKey === "5k" ? 8 : 0));
      const maxHr = Math.round(avgHr + randomBetween(8, 18));
      const efforts = buildEfforts(distKm, 0.04 + Math.abs(weekFitness));

      activities.push({
        date: formatDate(cursor),
        title: pick(template.title),
        distKm: Math.round(distKm * 10) / 10,
        durationSec,
        avgSpeedKmh: speedToKmh(avgSpeed),
        elevationGainM: Math.round(randomBetween(5, distKm * 8)),
        avgHr,
        maxHr,
        tss: estimateTss(durationSec, avgHr),
        efforts,
        type: template.type,
      });
    }

    cursor = addDays(cursor, 1);
  }

  const guaranteed = [
    { offsetDays: 14, template: RUN_TEMPLATES.find((t) => t.type === "race5k") },
    { offsetDays: 45, template: RUN_TEMPLATES.find((t) => t.type === "race10k") },
    { offsetDays: 90, template: RUN_TEMPLATES.find((t) => t.type === "raceHM") },
    { offsetDays: 150, template: RUN_TEMPLATES.find((t) => t.type === "raceFM") },
  ];
  for (const g of guaranteed) {
    const d = formatDate(addDays(startDate, g.offsetDays));
    if (activities.some((a) => a.date === d)) continue;
    const template = g.template;
    const distKm = pick(template.distKm);
    const paceStr = BASE_PACES[template.paceKey];
    const durationSec = durationFromKmPace(distKm, paceStr);
    const avgSpeed = (distKm * 1000) / durationSec;
    const avgHr = Math.round(162 + randomBetween(-5, 10));
    activities.push({
      date: d,
      title: pick(template.title),
      distKm: Math.round(distKm * 10) / 10,
      durationSec,
      avgSpeedKmh: speedToKmh(avgSpeed),
      elevationGainM: Math.round(randomBetween(10, distKm * 5)),
      avgHr,
      maxHr: Math.round(avgHr + randomBetween(10, 20)),
      tss: estimateTss(durationSec, avgHr),
      efforts: buildEfforts(distKm, 0.02),
      type: template.type,
    });
  }

  activities.sort((a, b) => a.date.localeCompare(b.date));
  return activities;
}

async function main() {
  const userId = resolveUserUuid(FIREBASE_UID);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const userCheck = await client.query(
    `SELECT id, name, firebase_uid FROM public.users WHERE id = $1 OR firebase_uid = $2`,
    [userId, FIREBASE_UID]
  );

  if (userCheck.rows.length === 0) {
    console.error(`사용자 없음: firebase_uid=${FIREBASE_UID}, uuid=${userId}`);
    await client.end();
    process.exit(1);
  }

  const row = userCheck.rows[0];
  const actualUserId = row.id;
  console.log(`대상 사용자: ${row.name || "(이름없음)"} uuid=${actualUserId} firebase_uid=${row.firebase_uid || FIREBASE_UID}`);

  const endDate = new Date("2026-06-14");
  const startDate = addDays(endDate, -180);
  const schedule = generateSchedule(startDate, endDate);
  console.log(`생성 활동 수: ${schedule.length}`);

  const prefix = `dummy_run_${FIREBASE_UID.slice(0, 8)}_`;
  await client.query(
    `DELETE FROM public.run_activity_efforts WHERE user_id = $1 AND activity_id LIKE $2`,
    [actualUserId, prefix + "%"]
  );
  await client.query(
    `DELETE FROM public.activities WHERE user_id = $1 AND activity_id LIKE $2`,
    [actualUserId, prefix + "%"]
  );

  const maxAct = await client.query(`SELECT COALESCE(MAX(id), 0)::bigint AS v FROM public.activities`);
  let nextActId = Number(maxAct.rows[0].v) + 1;

  let inserted = 0;
  for (let i = 0; i < schedule.length; i++) {
    const a = schedule[i];
    const activityId = `${prefix}${String(i + 1).padStart(4, "0")}_${crypto.randomBytes(4).toString("hex")}`;
    const e = a.efforts;
    const startDate = `${a.date}T07:00:00+09:00`;

    await client.query(
      `INSERT INTO public.activities (
        id, user_id, name, activity_type, distance, moving_time, elapsed_time,
        total_elevation_gain, start_date, source, activity_id, title, activity_date,
        duration_sec, distance_km, elevation_gain_m, avg_speed_kmh, avg_hr, max_hr, tss
      ) VALUES (
        $1, $2, $3, 'Run', $4, $5, $5, $6, $7::timestamptz, 'strava', $8, $3, $9::date,
        $5, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (user_id, activity_id) DO NOTHING`,
      [
        nextActId,
        actualUserId,
        a.title,
        a.distKm,
        a.durationSec,
        a.elevationGainM,
        startDate,
        activityId,
        a.date,
        a.distKm,
        a.elevationGainM,
        a.avgSpeedKmh,
        a.avgHr,
        a.maxHr,
        a.tss,
      ]
    );
    nextActId++;

    await client.query(
      `INSERT INTO public.run_activity_efforts (
        user_id, activity_id, activity_date,
        speed_1k, speed_3k, speed_5k, speed_7k, speed_10k, speed_20k, speed_42k,
        hr_1k, hr_3k, hr_5k, hr_7k, hr_10k, hr_20k, hr_42k
      ) VALUES ($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (user_id, activity_id) DO UPDATE SET
        activity_date=EXCLUDED.activity_date,
        speed_1k=EXCLUDED.speed_1k, speed_3k=EXCLUDED.speed_3k, speed_5k=EXCLUDED.speed_5k,
        speed_7k=EXCLUDED.speed_7k, speed_10k=EXCLUDED.speed_10k, speed_20k=EXCLUDED.speed_20k,
        speed_42k=EXCLUDED.speed_42k,
        hr_1k=EXCLUDED.hr_1k, hr_3k=EXCLUDED.hr_3k, hr_5k=EXCLUDED.hr_5k,
        hr_7k=EXCLUDED.hr_7k, hr_10k=EXCLUDED.hr_10k, hr_20k=EXCLUDED.hr_20k,
        hr_42k=EXCLUDED.hr_42k,
        updated_at=now()`,
      [
        actualUserId,
        activityId,
        startDate,
        e.speed_1k,
        e.speed_3k,
        e.speed_5k,
        e.speed_7k,
        e.speed_10k,
        e.speed_20k,
        e.speed_42k,
        e.hr_1k,
        e.hr_3k,
        e.hr_5k,
        e.hr_7k,
        e.hr_10k,
        e.hr_20k,
        e.hr_42k,
      ]
    );
    inserted++;
  }

  const summary = await client.query(
    `SELECT
       COUNT(*) AS activity_count,
       ROUND(SUM(distance_km)::numeric, 1) AS total_km,
       ROUND(SUM(tss)::numeric, 1) AS total_tss,
       MIN(activity_date) AS from_date,
       MAX(activity_date) AS to_date
     FROM public.activities
     WHERE user_id = $1 AND activity_id LIKE $2`,
    [actualUserId, prefix + "%"]
  );

  const peaks = await client.query(
    `SELECT
       MAX(speed_1k) AS best_1k, MAX(speed_5k) AS best_5k, MAX(speed_10k) AS best_10k,
       MAX(speed_20k) AS best_20k, MAX(speed_42k) AS best_42k
     FROM public.run_activity_efforts
     WHERE user_id = $1 AND activity_id LIKE $2`,
    [actualUserId, prefix + "%"]
  );

  function fmtPace(speed) {
    if (!speed) return "-";
    const sec = Math.round(1000 / speed);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}/km`;
  }

  const p = peaks.rows[0];
  console.log("\n=== 삽입 완료 ===");
  console.log(summary.rows[0]);
  console.log("구간 피크 페이스:");
  console.log(`  1K  ${fmtPace(p.best_1k)}`);
  console.log(`  5K  ${fmtPace(p.best_5k)}`);
  console.log(`  10K ${fmtPace(p.best_10k)}`);
  console.log(`  20K ${fmtPace(p.best_20k)}`);
  console.log(`  42K ${fmtPace(p.best_42k)}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
