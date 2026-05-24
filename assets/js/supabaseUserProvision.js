/**
 * 프로필 입력 완료 후 Supabase auth.users + public.users 프로비저닝 (비차단).
 */
(function () {
  function getProvisionUrl() {
    var cfg =
      typeof window !== "undefined" && window.STELVIO_SUPABASE_CONFIG
        ? window.STELVIO_SUPABASE_CONFIG
        : {};
    if (cfg.provisionUserAfterProfileUrl) {
      return String(cfg.provisionUserAfterProfileUrl).trim();
    }
    var projectId =
      (window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.projectId) ||
      "stelvio-ai";
    return (
      "https://us-central1-" +
      projectId +
      ".cloudfunctions.net/provisionSupabaseUserAfterProfileHttp"
    );
  }

  /**
   * @returns {Promise<object|null>}
   */
  async function provisionSupabaseUserAfterProfile() {
    var user =
      (window.auth && window.auth.currentUser) ||
      (window.authV9 && typeof window.authV9.currentUser !== "undefined"
        ? window.authV9.currentUser
        : null);
    if (!user || typeof user.getIdToken !== "function") {
      console.warn("[supabaseUserProvision] 로그인 없음 — 스킵");
      return { skipped: true, reason: "no_auth" };
    }

    var url = getProvisionUrl();
    try {
      var token = await user.getIdToken(true);
      var res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
      });
      var json = null;
      try {
        json = await res.json();
      } catch (_) {
        json = { success: false, error: "invalid_json" };
      }
      if (!res.ok) {
        console.warn(
          "[supabaseUserProvision] HTTP " + res.status,
          json && json.error ? json.error : json
        );
        return Object.assign({ success: false, httpStatus: res.status }, json || {});
      }
      console.log("[supabaseUserProvision] OK", json);
      return json;
    } catch (e) {
      console.warn("[supabaseUserProvision] 요청 실패 (Firebase 프로필 저장은 유지):", e);
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
  }

  if (typeof window !== "undefined") {
    window.provisionSupabaseUserAfterProfile = provisionSupabaseUserAfterProfile;
  }
})();
