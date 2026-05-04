/**
 * 알리고 Secret/환경 변수 복사-붙여넣기 시 흔한 오류(BOM, 따옴표, 개행) 제거.
 * 값 자체는 로그에 남기지 않는다.
 */
export declare function scrubAligoCredential(raw: string | undefined | null): string;
/**
 * 알림톡 API JSON 응답 code/message 기준 운영 힌트 (Firestore 로그·콘솔용)
 * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
 */
export declare function aligoApiFailureHint(code: unknown, message: string): string;
/** 로그용: 비밀 값 노출 없이 길이만 (ALIGO_DEBUG_AUTH=1 일 때) */
export declare function logAligoAuthShape(label: string, apikey: string, userid: string, token: string): void;
