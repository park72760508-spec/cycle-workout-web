import { readFileSync } from "node:fs";
import { initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | undefined;

export function initFirestore(): Firestore {
  if (app) return getFirestore(app);

  const jsonPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (jsonInline) {
    const sa = JSON.parse(jsonInline) as object;
    app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  } else if (jsonPath) {
    const sa = JSON.parse(readFileSync(jsonPath, "utf8")) as object;
    app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  } else {
    app = initializeApp();
  }

  return getFirestore(app);
}

export type PageCallback<T> = (items: T[]) => Promise<void>;

/**
 * collection / collectionGroup 페이징 (startAfter 커서)
 */
export async function paginateCollection<T>(
  db: Firestore,
  buildQuery: (
    db: Firestore
  ) => FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  batchSize: number,
  mapDoc: (doc: FirebaseFirestore.QueryDocumentSnapshot) => T | null,
  onBatch: PageCallback<T>
): Promise<void> {
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = buildQuery(db).orderBy("__name__").limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const items: T[] = [];
    for (const doc of snap.docs) {
      try {
        const mapped = mapDoc(doc);
        if (mapped != null) items.push(mapped);
      } catch {
        /* mapper throws — caller logs */
      }
    }
    if (items.length > 0) await onBatch(items);

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < batchSize) break;
  }
}
