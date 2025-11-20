/* eslint-disable @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";
import { requireAuth, stats, addDays } from "./_utils";

const db = admin.firestore();

/**
 * GET /sessionStats?days=30&thresholdMin=30&profileId=optional
 * Devuelve:
 * - sessions: número de sesiones en la ventana
 * - durationSec: descriptivos de duración
 * - photosPerSession: descriptivos de fotos por sesión
 */
export async function sessionStatsHandler(req: any, res: any) {
  try {
    await requireAuth(req);

    const days = Math.max(1, parseInt(String(req.query.days ?? "30")));
    const thresholdMin = Math.max(1, parseInt(String(req.query.thresholdMin ?? "30")));
    const profileId = (req.query.profileId as string) || null;

    const now = new Date();
    const since = addDays(now, -days);

    let qs: FirebaseFirestore.Query = db.collection("sessions")
      .where("startedAt", ">=", since)
      .where("startedAt", "<=", now);
    if (profileId) qs = qs.where("profileId", "==", profileId);

    const snap = await qs.get();

    const durations: number[] = [];
    const photosPerSession: number[] = [];

    const maxDuration = thresholdMin * 60 * 4; 

    snap.forEach(doc => {
      const d = doc.data();
      const dur = Number(d.durationSec || 0);
      const photos = Number(d.photosTaken || 0);
      if (dur >= 0 && dur <= maxDuration) durations.push(dur);
      if (photos >= 0) photosPerSession.push(photos);
    });

    return res.json({
      sessions: snap.size,
      durationSec: stats(durations),
      photosPerSession: stats(photosPerSession),
    });
  } catch (e: any) {
    return res.status(400).send(e?.message || "error");
  }
}
