/**
 * STELVIO 오픈 라이딩방 — Firestore 데이터 모델 (TypeScript)
 * 클라이언트/서버 공통 참조용. 번들 미사용 시 IDE 타입 체크에만 활용 가능.
 */

/** Firestore Timestamp (클라이언트 SDK 기준). 필요 시 `import type { Timestamp } from 'firebase/firestore'` 로 교체 가능 */
export interface FirestoreTimestamp {
  toDate(): Date;
  seconds: number;
  nanoseconds: number;
}

/** 라이딩 난이도 (평속 기준은 UI/가이드용 설명) */
export type RidingLevel = '초급' | '중급' | '상급';

/**
 * rides 컬렉션 문서
 * 경로: rides/{rideId}
 */
export interface OpenRide {
  /** 문서 ID (Firestore에 별도 필드로 둘 경우 optional) */
  id?: string;
  title: string;
  /** 라이딩 일자 (자정 기준 권장) */
  date: FirestoreTimestamp;
  departureTime: string;
  departureLocation: string;
  distance: number;
  course: string;
  level: RidingLevel;
  maxParticipants: number;
  hostName: string;
  contactInfo: string;
  isContactPublic: boolean;
  gpxUrl: string | null;
  region: string;
  /** 참석 확정 UID 목록 (호스트 포함 여부는 정책에 따름) */
  participants: string[];
  /** 대기 UID 목록 (순서 = 대기 순번) */
  waitlist: string[];
  /** 생성자 UID (옵션, 보안 규칙·수정 권한용) */
  hostUserId?: string;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

/** rides 생성 시 서버/클라이언트가 채울 입력 타입 */
export type OpenRideCreateInput = Omit<
  OpenRide,
  'id' | 'participants' | 'waitlist' | 'createdAt' | 'updatedAt'
> & {
  participants?: string[];
  waitlist?: string[];
};

/**
 * users 문서에 merge 할 오픈라이딩 관련 선호
 * 경로: users/{userId}
 */
export interface UserOpenRidingPreferences {
  activeRegions: string[];
  preferredLevels: RidingLevel[];
}

/** 참석 처리 결과 */
export type AttendResult =
  | { status: 'joined'; role: 'participant' }
  | { status: 'joined'; role: 'waitlist'; position: number }
  | { status: 'already'; role: 'participant' | 'waitlist'; position?: number }

export type CancelResult =
  | { status: 'left_waitlist' }
  | { status: 'left_participant'; promotedUserId: string | null }
  | { status: 'noop' };
