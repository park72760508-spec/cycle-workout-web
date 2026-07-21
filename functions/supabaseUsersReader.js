/**
 * Firestore users 전체 스캔(db.collection("users").get())을 대체하는 Supabase public.users 페이지네이션 리더.
 * public.users는 onUserProfileWritten 트리거로 Firestore users/{uid}와 동기화되므로, 실시간성이
 * 크게 중요하지 않은 배치/집계 잡(헵타곤 코호트 랭킹 등)에서 안전하게 사용할 수 있다.
 *
 * 반환 필드는 랭킹 집계에서 실제로 쓰는 것만 선별(name/display_name/birth_year/challenge/is_private +
 * rankingEligibility.isRankingEligibleUserData()를 재현하기 위한 is_active/account_status/legacy_status).
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const { isRankingEligibleUserData } = require("./rankingEligibility");

const SUPABASE_PAGE_SIZE = 1000;

/**
 * @returns {Promise<Array<{id:string, name:string, displayName:string, birthYear:number|null, challenge:string, isPrivate:boolean}>>}
 */
async function fetchRankingEligibleUsersFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const out = [];
  let from = 0;
  for (let page = 0; page < 500; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("users")
      .select("firebase_uid, name, display_name, birth_year, challenge, is_private, account_status, is_active, legacy_status")
      .not("firebase_uid", "is", null)
      .order("firebase_uid", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;

    for (const row of data || []) {
      const eligibilityProbe = {
        is_active: row.is_active,
        account_status: row.account_status,
        status: row.legacy_status,
      };
      if (!isRankingEligibleUserData(eligibilityProbe)) continue;
      out.push({
        id: String(row.firebase_uid),
        name: row.name || "",
        displayName: row.display_name || "",
        birthYear: row.birth_year != null ? Number(row.birth_year) : null,
        challenge: row.challenge || "Fitness",
        isPrivate: row.is_private === true,
      });
    }

    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return out;
}

module.exports = { fetchRankingEligibleUsersFromSupabase };
