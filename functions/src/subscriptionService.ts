/**
 * STELVIO AI - 구독 처리 서비스
 * Firestore: users 읽기/쓰기, 만료일 계산, 중복 처리 체크, 유저 매칭
 */
import type { Firestore } from "firebase-admin/firestore";

const USERS_COLLECTION = "users";
const PROCESSED_ORDERS_COLLECTION = "processed_orders";
const ORDERS_SUBCOLLECTION = "orders";

/** 전화번호 정규화: 하이픈·공백 제거 후 숫자만 (매칭 시 필수). 10자리 이상이면 숫자만 반환 */
function normalizePhoneOrId(value: string): string {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 10) return digitsOnly;
  return trimmed;
}

/** DB contact 포맷: "010-XXXX-XXXX" (13자). 숫자만 추출 후 010-앞4자-뒤4자로 변환 */
export function normalizeToContactFormat(phone: string): string {
  const digits = (phone ?? "").toString().trim().replace(/\D/g, "");
  if (digits.length !== 11 || !digits.startsWith("010")) return "";
  return "010-" + digits.slice(3, 7) + "-" + digits.slice(7, 11);
}

/** 1순위 shippingAddress.tel1, 2순위 ordererTel, 3순위 shippingMemo. contact(010-XXXX-XXXX)로 where 절 비교, 1순위 매칭 시 2·3순위 생략 */
export async function findUserByContactWithPriority(
  db: Firestore,
  shippingAddressTel1: string | null,
  ordererTel: string | null,
  shippingMemo: string | null
): Promise<{ userId: string; priority: 1 | 2 | 3 } | null> {
  const candidates: Array<{ formatted: string; priority: 1 | 2 | 3 }> = [];
  const add = (raw: string | null, priority: 1 | 2 | 3) => {
    if (!raw || !raw.trim()) return;
    const formatted = normalizeToContactFormat(raw);
    if (formatted) candidates.push({ formatted, priority });
  };
  add(shippingAddressTel1, 1);
  add(ordererTel, 2);
  add(shippingMemo, 3);

  for (const { formatted, priority } of candidates) {
    const snap = await db.collection(USERS_COLLECTION).where("contact", "==", formatted).limit(1).get();
    if (!snap.empty) {
      return { userId: snap.docs[0].id, priority };
    }
  }
  return null;
}

/** (레거시) 1순위 ordererTel, 2순위 shippingMemo. 숫자 아닌 문자 제거 후 비교. DB는 contact·phoneNumber·phone·tel 대조 */
export async function findUserByContact(
  db: Firestore,
  optionPhoneOrId: string | null,
  ordererTel: string | null,
  memoOrOptionId?: string | null,
  ordererNo?: string | null,
  shippingMemo?: string | null
): Promise<{ userId: string } | null> {
  const candidates: string[] = [];
  if (ordererTel) {
    const normalized = normalizePhoneOrId(ordererTel);
    if (!candidates.includes(normalized)) candidates.push(normalized);
    if (!candidates.includes(ordererTel.trim())) candidates.push(ordererTel.trim());
  }
  if (shippingMemo) {
    const normalized = normalizePhoneOrId(shippingMemo);
    if (normalized.length >= 10 && !candidates.includes(normalized)) candidates.push(normalized);
    const trimmed = shippingMemo.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  }
  if (optionPhoneOrId) {
    const n = normalizePhoneOrId(optionPhoneOrId);
    if (!candidates.includes(n)) candidates.push(n);
    if (!candidates.includes(optionPhoneOrId.trim())) candidates.push(optionPhoneOrId.trim());
  }
  if (ordererNo) {
    const normalized = normalizePhoneOrId(ordererNo);
    if (!candidates.includes(normalized)) candidates.push(normalized);
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
    const contact = (data.contact ?? data.phoneNumber ?? data.phone ?? data.tel ?? "").toString().trim();
    const normalizedContact = normalizePhoneOrId(contact);
    const email = (data.email ?? "").toString().trim();
    const idField = (data.id ?? data.uid ?? uid).toString().trim();

    for (const c of candidates) {
      if (!c) continue;
      if (c === contact || c === normalizedContact || c === idField || c === uid || c === email) {
        return { userId: uid };
      }
      if (normalizedContact && c === normalizedContact) return { userId: uid };
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
  let endDate = (data.expiry_date ?? data.subscription_end_date ?? "").toString().trim();
  if (!endDate) {
    await markOrderRevoked(db, productOrderId);
    return { revoked: true, userId: info.userId };
  }

  const end = new Date(endDate);
  end.setDate(end.getDate() - info.addedDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // 차감 후 만료일이 과거면 오늘 날짜로 맞춤(구독 만료 처리)
  const newEnd = end.getTime() < today.getTime() ? today : end;
  const newEndDate = newEnd.toISOString().split("T")[0];

  await userRef.update({
    expiry_date: newEndDate,
    ...(data.subscription_end_date !== undefined ? { subscription_end_date: newEndDate } : {}),
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

/** 유저 문서에 구독 만료일 적용. 대상 필드: expiry_date (YYYY-MM-DD). 기존이 미래면 기존+일수, 과거/없으면 현재+일수 */
export async function applySubscription(
  db: Firestore,
  userId: string,
  productOrderId: string,
  addDays: number
): Promise<{ success: boolean; newEndDate: string; previousEndDate: string | null }> {
  const userRef = db.collection(USERS_COLLECTION).doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new Error(`User not found: ${userId}`);
  }

  const data = userSnap.data()!;
  const previousEndDate = (data.expiry_date ?? data.subscription_end_date ?? "").toString().trim() || null;
  const newEndDate = computeNewSubscriptionEndDate(previousEndDate, addDays);

  await userRef.update({
    expiry_date: newEndDate,
    ...(data.subscription_end_date !== undefined ? { subscription_end_date: newEndDate } : {}),
  });
  await markOrderProcessed(db, productOrderId, userId, addDays);

  return { success: true, newEndDate, previousEndDate };
}

/** 구매 로그 저장: users/{userId}/orders/{productOrderId} (PAYED 성공 시). status: "PAYED" | "CANCELLED" | "RETURNED" */
export interface OrderLogPayload {
  orderId: string;
  productOrderId: string;
  productName: string;
  productOption: string;
  quantity: number;
  totalPaymentAmount?: number;
  paymentDate: string;
  processedAt?: string;
  status: "PAYED" | "CANCELLED" | "RETURNED";
}

export async function saveOrderLog(
  db: Firestore,
  userId: string,
  productOrderId: string,
  payload: OrderLogPayload
): Promise<void> {
  await db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(ORDERS_SUBCOLLECTION)
    .doc(productOrderId)
    .set(payload);
}

/** 구매 로그 조회 (취소 중복 방지용) */
export async function getOrderLog(
  db: Firestore,
  userId: string,
  productOrderId: string
): Promise<{ status: string } | null> {
  const doc = await db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(ORDERS_SUBCOLLECTION)
    .doc(productOrderId)
    .get();
  if (!doc.exists) return null;
  const d = doc.data();
  return d ? { status: String(d.status ?? "") } : null;
}

/** 취소/반품 시 구매 로그 상태 업데이트 (status: CANCELLED | RETURNED, claimDate, claimReason). 문서 없으면 merge로 생성 */
export async function updateOrderLogClaim(
  db: Firestore,
  userId: string,
  productOrderId: string,
  status: "CANCELLED" | "RETURNED",
  claimDate: string,
  claimReason?: string
): Promise<void> {
  const ref = db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(ORDERS_SUBCOLLECTION)
    .doc(productOrderId);
  const payload: Record<string, unknown> = { status, claimDate, productOrderId };
  if (claimReason != null) payload.claimReason = claimReason;
  await ref.set(payload, { merge: true });
}
