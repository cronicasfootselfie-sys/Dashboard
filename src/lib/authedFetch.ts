// Llamadas autenticadas desde el navegador: añaden el ID token de Firebase.
"use client";
import type { User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

/** Espera a que Firebase Auth tenga un usuario o falla tras el timeout. */
export async function waitForUser(timeoutMs = 8000): Promise<User> {
  if (auth?.currentUser) return auth.currentUser;
  if (!auth) throw new Error("NO_AUTH");
  return new Promise<User>((resolve, reject) => {
    const t = setTimeout(() => {
      unsub();
      reject(new Error("NO_AUTH_TIMEOUT"));
    }, timeoutMs);
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        clearTimeout(t);
        unsub();
        resolve(user);
      }
    });
  });
}

/** Igual que `fetch`, con `Authorization: Bearer <idToken>`. Reintenta una vez si responde 401. */
export async function fetchWithAuth(input: string, init?: RequestInit): Promise<Response> {
  const user = await waitForUser();
  const doFetch = async (token: string) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  let res = await doFetch(await user.getIdToken());
  if (res.status === 401) res = await doFetch(await user.getIdToken(true));
  return res;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  NO_TOKEN: "No hay sesión activa. Vuelve a iniciar sesión.",
  INVALID_TOKEN: "La sesión expiró o no es válida. Vuelve a iniciar sesión.",
  NOT_ADMIN: "Tu cuenta no tiene permisos de administrador en el dashboard (falta admins/<uid> en Firestore).",
  SERVER_MISCONFIGURED: "El servidor del dashboard no tiene configurada la credencial de Firebase.",
  NO_AUTH_TIMEOUT: "No se pudo confirmar la sesión. Recarga la página.",
};

/** Mensaje legible para mostrar en pantalla. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) return FRIENDLY[e.code] ?? e.message;
  const msg = (e as any)?.message ?? String(e);
  return FRIENDLY[msg] ?? msg;
}

/** `fetchWithAuth` + JSON. Si la respuesta no es 2xx lanza `ApiError` con el código del servidor. */
export async function fetchJsonWithAuth<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = typeof body?.error === "string" ? body.error : `HTTP_${res.status}`;
    throw new ApiError(res.status, code, body?.message || (body ? code : text) || `HTTP ${res.status}`);
  }
  return body as T;
}
