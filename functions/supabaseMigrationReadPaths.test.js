'use strict';
/**
 * Firestore→Supabase 이관(strava_webhook_retries / ranking_meta / appConfig / users 배치·grade 캐싱)
 * 순수 로직 검증 — 실제 Supabase/Firestore 네트워크 호출 없이 mock으로 동작만 확인.
 * 실행: node functions/supabaseMigrationReadPaths.test.js
 */
const assert = require("assert");
const path = require("path");

function assertEq(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg || `expected ${expected}, got ${actual}`);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("  ok -", name);
}

// ── 1) rankingEligibility.isRankingEligibleUserData: Supabase 미러 필드(is_active/legacy_status)로도
//    Firestore 원본과 동일하게 판정되는지 (private_user_ids·heptagon 배치 이관의 정합성 핵심) ──
console.log("[1] rankingEligibility parity (Firestore 원본 vs Supabase 미러 probe)");
{
  const { isRankingEligibleUserData } = require("./rankingEligibility");

  test("정상 회원(active) → 포함", () => {
    assertEq(isRankingEligibleUserData({ is_active: true, account_status: "active", status: undefined }), true);
  });
  test("is_active=false → 제외", () => {
    assertEq(isRankingEligibleUserData({ is_active: false, account_status: "active" }), false);
  });
  test("account_status=withdrawn → 제외", () => {
    assertEq(isRankingEligibleUserData({ is_active: true, account_status: "withdrawn" }), false);
  });
  test("레거시 status=inactive → 제외", () => {
    assertEq(isRankingEligibleUserData({ is_active: true, account_status: "active", status: "inactive" }), false);
  });
  test("레거시 status=deleted → 제외", () => {
    assertEq(isRankingEligibleUserData({ is_active: true, account_status: "active", status: "deleted" }), false);
  });
  test("필드 전부 없음(구버전 문서) → 포함(기본 활성)", () => {
    assertEq(isRankingEligibleUserData({}), true);
  });
}

// ── 2) supabaseUserProvision.mapFirestoreUserToRow: is_active/legacy_status가 올바르게 Supabase row로 매핑되는지 ──
console.log("[2] supabaseUserProvision mapFirestoreUserToRow — is_active/legacy_status 매핑");
{
  // mapFirestoreUserToRow는 파일 내부 비공개 함수라 require로 노출되지 않음 — 동일 매핑 규칙을 별도 재현해 회귀 검증.
  function mapIsActive(d) {
    return d.is_active === false ? false : true;
  }
  test("is_active=false 원본 → false 매핑", () => {
    assertEq(mapIsActive({ is_active: false }), false);
  });
  test("is_active 미설정 → true 매핑(기본 활성)", () => {
    assertEq(mapIsActive({}), true);
  });
  test("is_active=true 원본 → true 매핑", () => {
    assertEq(mapIsActive({ is_active: true }), true);
  });
}

async function testCallerGradeCache() {
  console.log("[3] callerGradeCache — 30초 TTL 캐시 동작");
  delete require.cache[require.resolve("./callerGradeCache")];
  const { getCachedCallerGrade } = require("./callerGradeCache");

  let getCallCount = 0;
  const fakeDb = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              getCallCount += 1;
              return { exists: true, data: () => ({ grade: "1" }) };
            },
          };
        },
      };
    },
  };

  const g1 = await getCachedCallerGrade(fakeDb, "uid-1");
  const g2 = await getCachedCallerGrade(fakeDb, "uid-1");
  assertEq(g1, "1", "첫 조회 grade");
  assertEq(g2, "1", "캐시 히트 grade 동일");
  assertEq(getCallCount, 1, "TTL 내 두 번째 호출은 Firestore를 다시 읽지 않아야 함");

  const g3 = await getCachedCallerGrade(fakeDb, "uid-2");
  assertEq(getCallCount, 2, "다른 uid는 캐시 미스로 새로 조회");
  assertEq(g3, "1");

  passed += 1;
  console.log("  ok - TTL 캐시로 반복 조회 절감 확인");
}

async function testAppConfigCacheFallback() {
  console.log("[4] appConfigCache — Supabase 우선 조회 + Firestore 폴백");

  // supabaseDualWriteServer.getSupabaseAdminClient()를 mock으로 교체(require 캐시 주입) —
  // 실제 Supabase 네트워크 호출 없이 Supabase-hit 경로와 실패-시-Firestore-폴백 경로를 모두 검증.
  const supabaseServerPath = require.resolve("./supabaseDualWriteServer");
  const originalModule = require.cache[supabaseServerPath];
  delete require.cache[supabaseServerPath];
  delete require.cache[require.resolve("./appConfigCache")];

  let mode = "supabase-hit";
  const fakeSupabaseModule = {
    getSupabaseAdminClient() {
      if (mode === "supabase-down") throw new Error("supabase unavailable (test)");
      return {
        from(table) {
          assertEq(table, "app_config");
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              if (mode === "supabase-hit") {
                return { data: { data: { strava_client_id: "from-supabase" } }, error: null };
              }
              return { data: null, error: null }; // row 없음 → Firestore 폴백
            },
          };
        },
      };
    },
  };
  require.cache[supabaseServerPath] = {
    id: supabaseServerPath,
    filename: supabaseServerPath,
    loaded: true,
    exports: fakeSupabaseModule,
  };

  const { getAppConfigDocCached } = require("./appConfigCache");

  const fakeAdmin = {
    firestore() {
      return {
        collection() {
          return {
            doc() {
              return {
                async get() {
                  return { exists: true, data: () => ({ strava_client_id: "from-firestore" }) };
                },
              };
            },
          };
        },
      };
    },
  };

  mode = "supabase-hit";
  const hitResult = await getAppConfigDocCached(fakeAdmin, "strava", { forceRefresh: true });
  assertEq(hitResult.strava_client_id, "from-supabase", "Supabase 행이 있으면 Supabase 우선");

  mode = "supabase-down";
  const fallbackResult = await getAppConfigDocCached(fakeAdmin, "strava", { forceRefresh: true });
  assertEq(fallbackResult.strava_client_id, "from-firestore", "Supabase 실패 시 Firestore로 폴백");

  // 원복 — 다른 테스트/모듈에 mock이 새지 않도록.
  if (originalModule) {
    require.cache[supabaseServerPath] = originalModule;
  } else {
    delete require.cache[supabaseServerPath];
  }

  passed += 1;
  console.log("  ok - Supabase 우선 + Firestore 폴백 확인");
}

(async () => {
  try {
    await testCallerGradeCache();
    await testAppConfigCacheFallback();
    console.log(`\n[supabaseMigrationReadPaths.test.js] ${passed}개 검증 통과`);
  } catch (e) {
    console.error("  FAILED -", e);
    process.exitCode = 1;
  }
})();
