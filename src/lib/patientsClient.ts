// Pacientes (usuario con código REDCap + su perfil), vía /api/patients.
// Reemplaza a redcapFirestore.ts, que leía Firestore desde el navegador y dejó de
// funcionar cuando las reglas de seguridad pasaron a "solo el dueño" (2026-09-24).
"use client";
import { fetchJsonWithAuth, waitForUser } from "@/lib/authedFetch";

export type PatientRow = { userId: string; profileId: string; redcapCode: string };

let cache: { uid: string; promise: Promise<PatientRow[]> } | null = null;

/** Una sola petición por usuario y sesión; si falla, el siguiente intento vuelve a pedir. */
export async function fetchPatients(force = false): Promise<PatientRow[]> {
  const user = await waitForUser();
  if (!force && cache && cache.uid === user.uid) return cache.promise;

  const promise = fetchJsonWithAuth<{ patients: PatientRow[] }>("/api/patients").then((r) => r.patients ?? []);
  const entry = { uid: user.uid, promise };
  cache = entry;
  promise.catch(() => {
    if (cache === entry) cache = null;
  });
  return promise;
}

/** Códigos REDCap que tienen al menos un perfil, únicos y ordenados. */
export async function getRedcapCodesWithProfiles(): Promise<string[]> {
  const rows = await fetchPatients();
  return Array.from(new Set(rows.map((r) => r.redcapCode))).sort((a, b) => a.localeCompare(b));
}

/** profileId → redcap_code */
export async function getProfileToRedcapMap(): Promise<Record<string, string>> {
  const rows = await fetchPatients();
  return Object.fromEntries(rows.map((r) => [r.profileId, r.redcapCode]));
}

/** redcap_code → [profileId, ...] */
export async function getProfileIdsByRedcap(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const r of await fetchPatients()) (out[r.redcapCode] ||= []).push(r.profileId);
  for (const code of Object.keys(out)) out[code] = Array.from(new Set(out[code]));
  return out;
}

export async function getSingleProfileIdByRedcap(redcapCode: string): Promise<{
  status: "ok" | "none" | "many";
  profileId?: string;
  count: number;
}> {
  const code = redcapCode.trim();
  const matches = (await fetchPatients()).filter((r) => r.redcapCode === code);
  if (matches.length === 1) return { status: "ok", profileId: matches[0].profileId, count: 1 };
  if (matches.length === 0) return { status: "none", count: 0 };
  return { status: "many", count: matches.length };
}
