/**
 * React Native 앱에서 @react-native-firebase/firestore 로 기존 쓰기/읽기를 연결하는 예시.
 * 실제 앱의 trainingResultService / saveStravaActivity 구현을 이 포트에 맞게 옮기세요.
 *
 * 사용:
 *   import { initDbService } from './services/db';
 *   import { createFirebasePorts } from './services/db/firebasePorts.example';
 *
 *   initDbService({
 *     firebase: createFirebasePorts(),
 *     config: { dualWriteEnabled: true, supabaseUrl: '...', supabaseAnonKey: '...' },
 *     authStorage: AsyncStorage,
 *   });
 */

import type { FirebasePorts } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FirestoreModule = any;

export function createFirebasePorts(
  firestore: FirestoreModule = require("@react-native-firebase/firestore").default()
): FirebasePorts {
  return {
    async saveTrainingSession(userId, data) {
      const mod = await import(
        /* webpackIgnore: true */ "../../../path-to-your/saveTrainingSession"
      );
      return mod.saveTrainingSession(userId, data, firestore);
    },

    async saveStravaActivity(activity) {
      const userLogsRef = firestore
        .collection("users")
        .doc(activity.user_id)
        .collection("logs");

      const activityId = String(activity.activity_id || activity.id);
      const existing = await userLogsRef
        .where("activity_id", "==", activityId)
        .limit(1)
        .get();

      if (!existing.empty) {
        return {
          success: true,
          id: existing.docs[0]!.id,
          activityId,
          isNew: false,
        };
      }

      const docRef = await userLogsRef.add({
        ...activity,
        activity_id: activityId,
        source: activity.source ?? "strava",
        tss_applied: false,
        created_at: activity.created_at ?? new Date().toISOString(),
      });

      return {
        success: true,
        id: docRef.id,
        activityId,
        isNew: true,
      };
    },

    async updateUserProfile(userId, patch) {
      await firestore.collection("users").doc(userId).update(patch);
    },

    async getUserTrainingLogs(userId, options = {}) {
      let q = firestore
        .collection("users")
        .doc(userId)
        .collection("logs")
        .orderBy("date", "desc");

      const limit = options.limit ?? 50;
      q = q.limit(limit);

      const snap = await q.get();
      return snap.docs.map(
        (doc: { id: string; data: () => Record<string, unknown> }) => ({
          id: doc.id,
          user_id: userId,
          ...doc.data(),
        })
      );
    },

    async getUserProfile(userId) {
      const snap = await firestore.collection("users").doc(userId).get();
      if (!snap.exists) return null;
      return { id: userId, ...snap.data() };
    },
  };
}
