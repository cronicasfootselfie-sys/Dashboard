// Lecturas y escrituras de Firestore que el dashboard hace desde el servidor.
import { DocumentReference, FieldValue, GeoPoint, Timestamp, type Firestore } from "firebase-admin/firestore";
import { computeConsensus, type TrainingVote } from "@/lib/trainingLabels";
import { HttpError, type AdminUser } from "./requireAdmin";

/** Solo se muestran datos desde esta fecha (la misma que usaba la galería). */
export const PHOTOS_CUTOFF_DATE = new Date("2025-12-18T00:00:00.000Z");
export const MAX_PAGE_SIZE = 200;

export type PatientRow = { userId: string; profileId: string; redcapCode: string };

/**
 * Usuarios con `redcap_code` no vacío y su primer perfil (`users/{uid}/profiles`).
 * Mismo criterio que la versión anterior, que leía Firestore desde el navegador.
 */
export async function listPatients(db: Firestore): Promise<PatientRow[]> {
  const users = await db.collection("users").where("redcap_code", "!=", "").get();

  const rows = await Promise.all(
    users.docs.map(async (u) => {
      const redcapCode = String(u.get("redcap_code") ?? "").trim();
      if (!redcapCode) return null;
      const profiles = await u.ref.collection("profiles").limit(1).get();
      const first = profiles.docs[0];
      return first ? { userId: u.id, profileId: first.id, redcapCode } : null;
    })
  );

  return rows
    .filter((r): r is PatientRow => r !== null)
    .sort((a, b) => a.redcapCode.localeCompare(b.redcapCode) || a.profileId.localeCompare(b.profileId));
}

/** Convierte valores de Firestore a JSON plano. Los Timestamp quedan como `{ seconds, nanoseconds }`. */
export function toPlain(value: unknown): unknown {
  if (value instanceof Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return value.path;
  if (value instanceof Date) return { seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 };
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

export function parsePageSize(raw: string | null, fallback = 20) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "BAD_LIMIT");
  return Math.min(n, MAX_PAGE_SIZE);
}

export async function listPhotos(
  db: Firestore,
  opts: { profileId: string; pageSize: number; cursor?: string | null }
) {
  const col = db.collection("photoHistory");
  let q = col
    .where("profileId", "==", opts.profileId)
    .where("date", ">=", PHOTOS_CUTOFF_DATE)
    .orderBy("date", "desc");

  if (opts.cursor) {
    const cursorSnap = await col.doc(opts.cursor).get();
    if (!cursorSnap.exists || cursorSnap.get("profileId") !== opts.profileId) {
      throw new HttpError(400, "BAD_CURSOR");
    }
    q = q.startAfter(cursorSnap);
  }

  const snap = await q.limit(opts.pageSize + 1).get();
  const docs = snap.docs.slice(0, opts.pageSize);
  const hasMore = snap.docs.length > opts.pageSize;

  return {
    photos: docs.map((d) => ({ ...(toPlain(d.data()) as Record<string, unknown>), id: d.id })),
    nextCursor: hasMore ? docs[docs.length - 1].id : null,
  };
}

/** Registra el voto del usuario sobre una foto y recalcula el consenso. */
export async function labelPhoto(db: Firestore, user: AdminUser, photoId: string, isCorrectFoot: boolean) {
  if (!user.email) throw new HttpError(400, "NO_EMAIL", "La cuenta no tiene email; no se puede registrar el voto");
  const email = user.email;
  const ref = db.collection("photoHistory").doc(photoId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "PHOTO_NOT_FOUND");

    const existing: Record<string, TrainingVote & Record<string, unknown>> = snap.get("trainingLabels") || {};
    if (existing[email]?.isCorrectFoot === isCorrectFoot) return; // mismo voto: nada que cambiar

    const now = FieldValue.serverTimestamp();
    const labels = {
      ...existing,
      [email]: { isCorrectFoot, labeledBy: email, labeledAt: now, userId: user.uid },
    };

    tx.update(ref, {
      trainingLabels: labels,
      trainingLabelStatus: {
        ...computeConsensus(Object.values(labels)),
        lastLabeledBy: email,
        lastLabeledAt: now,
      },
    });
  });

  const after = await ref.get();
  return {
    id: after.id,
    trainingLabels: toPlain(after.get("trainingLabels") ?? {}),
    trainingLabelStatus: toPlain(after.get("trainingLabelStatus") ?? null),
  };
}
