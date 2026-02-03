/**
 * 관리자 비밀번호 초기화 Callable Function
 * - 호출자는 Firestore users/{uid}.grade === 1 (관리자) 여야 함
 * - targetUserId 대상의 Firebase Auth 비밀번호를 newPassword로 변경
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.adminResetUserPassword = functions.https.onCall(async (data, context) => {
  // 인증 필수
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '로그인한 후에만 비밀번호 초기화를 할 수 있습니다.'
    );
  }

  const callerUid = context.auth.uid;
  const targetUserId = data && data.targetUserId ? String(data.targetUserId).trim() : null;
  const newPassword = data && data.newPassword ? String(data.newPassword) : null;

  if (!targetUserId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '대상 사용자 ID(targetUserId)가 필요합니다.'
    );
  }

  if (!newPassword || newPassword.length < 6) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '새 비밀번호는 6자 이상이어야 합니다.'
    );
  }

  // Firestore에서 호출자 등급 확인 (관리자만 허용)
  const callerDoc = await admin.firestore().collection('users').doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      '호출자 정보를 찾을 수 없습니다.'
    );
  }

  const grade = callerDoc.data().grade;
  const isAdmin = grade === 1 || grade === '1';
  if (!isAdmin) {
    throw new functions.https.HttpsError(
      'permission-denied',
      '관리자(grade=1)만 다른 사용자의 비밀번호를 초기화할 수 있습니다.'
    );
  }

  // Firebase Auth에서 대상 사용자 비밀번호 변경
  try {
    await admin.auth().updateUser(targetUserId, { password: newPassword });
    return { success: true, message: '비밀번호가 초기화되었습니다.' };
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new functions.https.HttpsError('not-found', '대상 사용자를 Firebase Auth에서 찾을 수 없습니다.');
    }
    if (err.code === 'auth/weak-password') {
      throw new functions.https.HttpsError('invalid-argument', '비밀번호가 너무 약합니다. 6자 이상 입력해주세요.');
    }
    console.error('[adminResetUserPassword]', err);
    throw new functions.https.HttpsError(
      'internal',
      err.message || '비밀번호 변경 중 오류가 발생했습니다.'
    );
  }
});
