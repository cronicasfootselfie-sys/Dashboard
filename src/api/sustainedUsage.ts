/* eslint-disable @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";
import { requireAuth, toDate, startOfDay, startOfWeek, addDays, stats } from "./_utils";

const db = admin.firestore();

/**
 * GET /sustainedUsage?weeks=8&minPerWeek=1&profileId=optional
 * - Frecuencia de uso (descriptivos diarios/semanales)
 * - % con uso sostenido (>= minPerWeek cada semana de la ventana)
 * - Serie semanal (activos y fotos)
 * - Fotos por perfil (ranking)
 */
export async function sustainedUsageHandler(req: any, res: any) {
  try {
    await requireAuth(req);

    const weeks = Math.max(1, parseInt(String(req.query.weeks ?? "8")));
    const minPerWeek = Math.max(1, parseInt(String(req.query.minPerWeek ?? "1")));
    const profileId = (req.query.profileId as string) || null;

    const now = new Date();
    const windowStart = addDays(now, -7 * weeks);

    // Sesiones dentro de la ventana
    let qs: FirebaseFirestore.Query = db.collection("sessions")
      .where("startedAt", ">=", windowStart)
      .where("startedAt", "<=", now);
    if (profileId) qs = qs.where("profileId", "==", profileId);

    const snap = await qs.get();

    type Sess = {
      profileId: string;
      startedAt: Date;
      durationSec: number;
      good: number;
      bad: number;
      photosTaken: number;
    };
    const sessions: Sess[] = [];
    const profilesSet = new Set<string>();

    snap.forEach(doc => {
      const d = doc.data();
      const pid = String(d.profileId || "");
      if (!pid) return;
      profilesSet.add(pid);
      sessions.push({
        profileId: pid,
        startedAt: toDate(d.startedAt || d.lastActiveAt || new Date()),
        durationSec: Number(d.durationSec || 0),
        good: Number(d.goodPhotos || 0),
        bad: Number(d.badPhotos || 0),
        photosTaken: Number(d.photosTaken || 0),
      });
    });

    // Conteos diarios y semanales por perfil
    const mapDaily = new Map<string, number>();  // pid|YYYY-MM-DD -> count
    const mapWeekly = new Map<string, number>(); // pid|YYYY-MM-DD(weekStart) -> count
    for (const s of sessions) {
      const d0 = startOfDay(s.startedAt);
      const w0 = startOfWeek(s.startedAt);
      const kD = `${s.profileId}|${d0.toISOString().slice(0, 10)}`;
      const kW = `${s.profileId}|${w0.toISOString().slice(0, 10)}`;
      mapDaily.set(kD, (mapDaily.get(kD) || 0) + 1);
      mapWeekly.set(kW, (mapWeekly.get(kW) || 0) + 1);
    }
    const dailyCounts = [...mapDaily.values()];
    const weeklyCounts = [...mapWeekly.values()];

    // Uso sostenido: para cada perfil, todas las semanas deben cumplir >= minPerWeek
    const perProfileWeeks = new Map<string, Map<string, number>>();
    for (const [k, v] of mapWeekly.entries()) {
      const [pid, weekIso] = k.split("|");
      if (!perProfileWeeks.has(pid)) perProfileWeeks.set(pid, new Map());
      perProfileWeeks.get(pid)!.set(weekIso, v);
    }
    let sustainedCount = 0;
    for (const pid of perProfileWeeks.keys()) {
      let ok = true;
      for (let i = 0; i < weeks; i++) {
        const ws = startOfWeek(addDays(now, -7 * i)).toISOString().slice(0, 10);
        const c = perProfileWeeks.get(pid)!.get(ws) || 0;
        if (c < minPerWeek) { ok = false; break; }
      }
      if (ok) sustainedCount++;
    }
    const profiles = profileId ? (profilesSet.size || (sustainedCount ? 1 : 0)) : profilesSet.size;
    const sustainedRate = profiles ? (sustainedCount / profiles) * 100 : 0;

    // Serie semanal (activos y fotos buenas)
    const weeklySeries: { weekStart: string; activeProfiles: number; photos: number }[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = startOfWeek(addDays(now, -7 * i));
      const we = addDays(ws, 7);
      const wIso = ws.toISOString().slice(0, 10);

      // activos (>=1 sesión)
      const act = new Set<string>();
      for (const s of sessions) {
        if (s.startedAt >= ws && s.startedAt < we) act.add(s.profileId);
      }

      // fotos buenas en photoHistory
      let qh: FirebaseFirestore.Query = db.collection("photoHistory")
        .where("date", ">=", ws)
        .where("date", "<", we);
      if (profileId) qh = qh.where("profileId", "==", profileId);
      const hs = await qh.get();
      const photos = hs.size;

      weeklySeries.push({ weekStart: wIso, activeProfiles: act.size, photos });
    }

    // Fotos por perfil en la ventana (buenas - photoHistory)
    let qph: FirebaseFirestore.Query = db.collection("photoHistory")
      .where("date", ">=", windowStart)
      .where("date", "<=", now);
    if (profileId) qph = qph.where("profileId", "==", profileId);
    const ph = await qph.get();
    const photosPerProfileMap = new Map<string, number>();
    ph.forEach(d => {
      const pid = String(d.data().profileId || "");
      if (!pid) return;
      photosPerProfileMap.set(pid, (photosPerProfileMap.get(pid) || 0) + 1);
    });
    const photosPerProfile = [...photosPerProfileMap.entries()].map(([profileId, count]) => ({ profileId, count }));

    // Descriptivos
    const daily = stats(dailyCounts);
    const weekly = stats(weeklyCounts);

    return res.json({
      windowWeeks: weeks,
      profiles,
      daily,
      weekly,
      sustained: { count: sustainedCount, ratePct: Math.round(sustainedRate * 10) / 10 },
      weeklySeries,
      photosPerProfile,
    });
  } catch (e: any) {
    return res.status(400).send(e?.message || "error");
  }
}
