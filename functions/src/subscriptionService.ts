/**
 * STELVIO AI - 구독 처리 서비스
 * Firestore: users 읽기/쓰기, 만료일 계산, 중복 처리 체크, 유저 매칭
 */
import type { Firestore } from "firebase-admin/firestore";

const USERS_COLLECTION = "users";
const PROCESSED_ORDERS_COLLECTION = "processed_orders";

/** 전화번호 정규화: 하이픈·공백 제거 후 숫자만 (매칭 시 필수). 10자리 이상이면 숫자만 반환 */
function normalizePhoneOrId(value: string): string {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 10) return digitsOnly;
  return trimmed;
}

/** 1순위: 전화번호/옵션·요청사항 ID, 2순위: 주문자 연락처. 연락처는 하이픈 제거 후 숫자만 비교, DB는 phoneNumber·phone·tel 모두 대조 */
export async function findUserByContact(
  db: Firestore,
  optionPhoneOrId: string | null,
  ordererTel: string | null,
  memoOrOptionId?: string | null,
  ordererNo?: string | null
): Promise<{ userId: string } | null> {
  const candidates: string[] = [];
  if (optionPhoneOrId) {
    candidates.push(normalizePhoneOrId(optionPhoneOrId), optionPhoneOrId.trim());
  }
  if (ordererTel) {
    const normalized = normalizePhoneOrId(ordererTel);
    if (!candidates.includes(normalized)) candidates.push(normalized);
    if (!candidates.includes(ordererTel.trim())) candidates.push(ordererTel.trim());
  }
  if (ordererNo) {
    const normalized = normalizePhoneOrId(ordererNo);
    if (!candidates.includes(normalized)) candidates.push(normalized);
    if (!candidates.includes(ordererNo.trim())) candidates.push(ordererNo.trim());
  }
  if (memoOrOptionId) {
    const trimmed = memoOrOptionId.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  }

  if (candidates.length === 0) return null;

  const usersSnap = await db.collection(USERS_COLLECTION).get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const uid = doc.id;
    const phone = (data.phoneNumber ?? data.phone ?? data.tel ?? "").toString().trim();
    const normalizedPhone = normalizePhoneOrId(phone);
    const email = (data.email ?? "").toString().trim();
    const idField = (data.id ?? data.uid ?? uid).toString().trim();

    for (const c of candidates) {
      if (!c) continue;
      if (c === phone || c === normalizedPhone || c === idField || c === uid || c === email) {
        return { userId: uid };
      }
      if (normalizedPhone && c === normalizedPhone) return { userId: uid };
    }
  }
  return null;
}

/** 이미 처리된 주문인지 확인 */
export async function isOrderProcessed(
  db: Firestore,
  productOrderId: string
): Promise<boolean> {
  const doc = await db.collection(PROCESSED_ORDERS_COLLECTION).doc(productOrderId).get();
  return doc.exists;
}

/** PAYED 적용 시 처리 기록 저장 (환불 시 회수용으로 addedDays 저장). productOrderId를 문서 ID로 사용하여 upsert: 기존 건은 덮어쓰기, 신규 건은 추가 */
export async function markOrderProcessed(
  db: Firestore,
  productOrderId: string,
  userId: string,
  addedDays: number
): Promise<void> {
  await db.collection(PROCESSED_ORDERS_COLLECTION).doc(productOrderId).set({
    productOrderId,
    userId,
    addedDays,
    type: "PAYED",
    processedAt: new Date().toISOString(),
  });
}

/** CLAIM_COMPLETED(취소/반품) 시 기존 처리 내역 조회 (회수용) */
export async function getProcessedOrderInfo(
  db: Firestore,
  productOrderId: string
): Promise<{ userId: string; addedDays: number } | null> {
  const doc = await db.collection(PROCESSED_ORDERS_COLLECTION).doc(productOrderId).get();
  if (!doc.exists) return null;
  const d = doc.data();
  if (!d || d.type !== "PAYED") return null;
  return {
    userId: String(d.userId),
    addedDays: Number(d.addedDays) || 0,
  };
}

/** 취소/반품 시 구독 일수 회수 후 처리 기록 업데이트 */
export async function revokeSubscriptionByOrder(
  db: Firestore,
  productOrderId: string
): Promise<{ revoked: boolean; userId?: string }> {
  const info = await getProcessedOrderInfo(db, productOrderId);
  if (!info || info.addedDays <= 0) {
    return { revoked: false };
  }

  const userRef = db.collection(USERS_COLLECTION).doc(info.userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return { revoked: false };
  }

  const data = userSnap.data()!;
  let endDate = (data.subscription_end_date || data.expiry_date || "").toString().trim();
  if (!endDate) {
    await markOrderRevoked(db, productOrderId);
    return { revoked: true, userId: info.userId };
  }

  const end = new Date(endDate);
  end.setDate(end.getDate() - info.addedDays);
  const newEndDate = end.toISOString().split("T")[0];

  await userRef.update({
    subscription_end_date: newEndDate,
    ...(data.expiry_date !== undefined ? { expiry_date: newEndDate } : {}),
  });

  await markOrderRevoked(db, productOrderId);
  return { revoked: true, userId: info.userId };
}

async function markOrderRevoked(db: Firestore, productOrderId: string): Promise<void> {
  await db.collection(PROCESSED_ORDERS_COLLECTION).doc(productOrderId).update({
    revoked: true,
    revokedAt: new Date().toISOString(),
  });
}

/** 구독 만료일 계산: 기존 만료일이 남아 있으면 기존+일수, 만료되었으면 오늘+일수 */
export function computeNewSubscriptionEndDate(
  currentEndDate: string | null | undefined,
  addDays: number
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(today);

  if (currentEndDate && currentEndDate.trim()) {
    const end = new Date(currentEndDate.trim());
    end.setHours(0, 0, 0, 0);
    if (end.getTime() >= today.getTime()) {
      base.setTime(end.getTime());
    }
  }

  base.setDate(base.getDate() + addDays);
  return base.toISOString().split("T")[0];
}

/** 상품별 구독 일수 (상품 설정 또는 기본값). 필요 시 Firestore appConfig/naver 에서 상품별 일수 매핑 */
export const DEFAULT_SUBSCRIPTION_DAYS = 30;

/** 유저 문서에 구독 만료일 적용 (subscription_end_date, 필요 시 expiry_date 동기화) */
export async function applySubscription(
  db: Firestore,
  userId: string,
  productOrderId: string,
  addDays: number
): Promise<{ success: boolean; newEndDate: string }> {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new Error(`User not found: ${userId}`);
  }

  const data = userSnap.data()!;
  const currentEnd = (data.subscription_end_date || data.expiry_date || "").toString().trim() || null;
  const newEndDate = computeNewSubscriptionEndDate(currentEnd, addDays);

  const update: Record<string, unknown> = {
    subscription_end_date: newEndDate,
  };
  if (data.expiry_date !== undefined) {
    update.expiry_date = newEndDate;
  }

  await userRef.update(update);
  await markOrderProcessed(db, productOrderId, userId, addDays);

  return { success: true, newEndDate };
}
