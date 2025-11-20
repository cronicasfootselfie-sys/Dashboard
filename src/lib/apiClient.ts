// web/src/lib/apiClient.ts
import { auth } from "@/lib/firebaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;
if (!API_BASE) {
  throw new Error("Falta NEXT_PUBLIC_API_BASE en .env.local");
}

/** Espera a que Firebase Auth tenga un usuario o lanza tras timeout. */
async function waitForAuth(timeoutMs = 8000) {
  const u = auth.currentUser;
  if (u) return u;
  return new Promise<NonNullable<typeof auth.currentUser>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("NO_AUTH_TIMEOUT")), timeoutMs);
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        clearTimeout(t);
        unsub();
        resolve(user);
      }
    });
  });
}

async function authedFetch(path: string, init?: RequestInit) {
  // 1) asegúrate de tener usuario
  const user = auth.currentUser ?? (await waitForAuth());

  // 2) pide token (no forces refresh siempre; reintentas luego si 401)
  let token = await user.getIdToken();

  // 3) función que hace el fetch con un token dado
  const doFetch = async (bearer: string) => {
    const res = await fetch(`${API_BASE}/${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
        ...(init?.headers || {}),
      },
    });
    return res;
  };

  // 4) primer intento
  let res = await doFetch(token);

  // 5) si 401, fuerza refresh y reintenta una vez
  if (res.status === 401) {
    try {
      token = await user.getIdToken(true);
      res = await doFetch(token);
    } catch {
      // deja que pase a parseo de error
    }
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      // intenta leer texto/JSON del body para mostrar detalle (p. ej. NOT_ADMIN, NO_TOKEN, etc.)
      msg = await res.text();
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// helper para anexar opcionalmente profileId
function pid(profileId?: string) {
  return profileId ? `&profileId=${encodeURIComponent(profileId)}` : "";
}

/** KPI semanal; (global o por perfil) */
export const getWeeklyKpis = (profileId?: string) =>
  authedFetch(`weeklyKpis${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`);

/** Actividad de cámara */
export const getCameraUsage = (days: number | "all" = 30, profileId?: string) =>
  authedFetch(`cameraUsage?days=${days}${pid(profileId)}`);

/** Resultados de IA */
export const getAiResults = (days: number | "all" = 30, profileId?: string) =>
  authedFetch(`aiResults?days=${days}${pid(profileId)}`);

/** Altas por mes (global) */
export const getNewUsersPerMonth = () => authedFetch("newUsersPerMonth");

/** WAU / MAU (global) */
export const getActiveUsers = () => authedFetch("activeUsers");

/** Uso sostenido (global o por perfil) */
export const getSustainedUsage = (weeks = 8, minPerWeek = 1, profileId?: string) =>
  authedFetch(`sustainedUsage?weeks=${weeks}&minPerWeek=${minPerWeek}${pid(profileId)}`);

/** Sesiones REALES desde `sessions` (global o por perfil) */
export const getSessionStats = (days: number | "all" = 30, profileId?: string) =>
  authedFetch(`sessionStats?days=${days}${pid(profileId)}`);

/** Calidad (good/bad por sesiones y tomas) */
export const getQualityStats = (days: number | "all" = 30, profileId?: string) =>
  authedFetch(`qualityStats?days=${days}${pid(profileId)}`);
