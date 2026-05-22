/**
 * Supabase Dual-Write (웹) — 공개 설정만.
 * anon key는 Supabase Dashboard → API → anon / publishable 키.
 * 배포 전 window.__STELVIO_SUPABASE__ 로 덮어쓸 수 있습니다.
 */
(function () {
  var defaults = {
    supabaseUrl: 'https://eacrwhtbdqanaxpicqsm.supabase.co',
    supabaseAnonKey: 'sb_publishable_H4woEe6KlAnkz9jGoVbjOQ_cyUHk8v4',
    authBridgeUrl:
      'https://us-central1-stelvio-ai.cloudfunctions.net/mintSupabaseSessionHttp',
    uidNamespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  };
  var over = typeof window !== 'undefined' && window.__STELVIO_SUPABASE__;
  window.STELVIO_SUPABASE_CONFIG = Object.assign(
    {},
    defaults,
    over && typeof over === 'object' ? over : {}
  );
})();
