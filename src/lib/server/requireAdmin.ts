// Verificación de acceso para las rutas API del dashboard (solo servidor).
//
// Un usuario es administrador si su ID token trae el custom claim `admin: true`
// o si existe el documento `admins/{uid}`. Es el mismo criterio que usaban las
// reglas de Firestore antes del 2026-09-24 y que usan las funciones de KPI.
import { NextResponse } from "next/server";
import { adminAuth, adminDb, ServerConfigError } from "./firebaseAdmin";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export type AdminUser = {
  uid: string;
  email: string | null;
  role: string | null;
};

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function requireAdmin(req: Request): Promise<AdminUser> {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "NO_TOKEN");

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch (e) {
    if (e instanceof ServerConfigError) throw e;
    throw new HttpError(401, "INVALID_TOKEN");
  }

  const base = { uid: decoded.uid, email: decoded.email ?? null };

  if (decoded.admin === true) {
    return { ...base, role: typeof decoded.role === "string" ? decoded.role : "full" };
  }

  const snap = await adminDb().collection("admins").doc(decoded.uid).get();
  if (!snap.exists) throw new HttpError(403, "NOT_ADMIN");

  const role = snap.get("role");
  return { ...base, role: typeof role === "string" ? role : null };
}

/** Para rutas existentes: respuesta de error si el usuario no es admin, o `null` si puede seguir. */
export async function rejectIfNotAdmin(req: Request): Promise<Response | null> {
  try {
    await requireAdmin(req);
    return null;
  } catch (e) {
    return errorResponse(e);
  }
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Convierte cualquier error en una respuesta JSON `{ error: CODIGO }`. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return jsonResponse({ error: e.code, message: e.message !== e.code ? e.message : undefined }, e.status);
  }
  if (e instanceof ServerConfigError) {
    console.error("[api] configuración de servidor:", e.message);
    return jsonResponse({ error: "SERVER_MISCONFIGURED", message: e.message }, 500);
  }
  console.error("[api] error inesperado:", e);
  return jsonResponse({ error: "INTERNAL" }, 500);
}
