/**
 * Supabase Dual-Write (웹) — 공개 설정만.
 * 운영 배포: 설정은 firebaseConfig.js 맨 아래에 포함됨 (별도 script 불필요).
 * 이 파일은 로컬/문서용. stelvio.ai.kr 에 올리지 않아도 됨.
 */
(function () {
  var defaults = {
    supabaseUrl: 'https://eacrwhtbdqanaxpicqsm.supabase.co',
    supabaseAnonKey: 'sb_publishable_H4woEe6KlAnkz9jGoVbjOQ_cyUHk8v4',
    authBridgeUrl:
      'https://us-central1-stelvio-ai.cloudfunctions.net/mintSupabaseSessionHttp',
    provisionUserAfterProfileUrl:
      'https://us-central1-stelvio-ai.cloudfunctions.net/provisionSupabaseUserAfterProfileHttp',
    uidNamespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  };
  var over = typeof window !== 'undefined' && window.__STELVIO_SUPABASE__;
  window.STELVIO_SUPABASE_CONFIG = Object.assign(
    {},
    defaults,
    over && typeof over === 'object' ? over : {}
  );
})();
