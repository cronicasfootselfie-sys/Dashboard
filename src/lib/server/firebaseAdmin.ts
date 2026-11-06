// Inicialización de Firebase Admin SDK para las rutas API (solo servidor).
//
// Credenciales, en este orden:
//   1. Emuladores (FIRESTORE_EMULATOR_HOST): no se necesita credencial.
//   2. FIREBASE_SERVICE_ACCOUNT_KEY: JSON de la cuenta de servicio, en texto o en base64.
//      Es la opción para Vercel.
//   3. GOOGLE_APPLICATION_CREDENTIALS: ruta a un archivo JSON (útil en local).
import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export class ServerConfigError extends Error {}

function projectIdFromEnv() {
  return (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  );
}

function parseServiceAccount(raw: string) {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ServerConfigError("FIREBASE_SERVICE_ACCOUNT_KEY no es un JSON válido (ni en texto ni en base64)");
  }
}

function createApp(): App {
  const projectId = projectIdFromEnv();

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw && raw.trim()) {
    const sa = parseServiceAccount(raw);
    return initializeApp({ credential: cert(sa), projectId: sa.project_id ?? projectId });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault(), projectId });
  }

  throw new ServerConfigError(
    "Falta la credencial de servidor: configura FIREBASE_SERVICE_ACCOUNT_KEY (o GOOGLE_APPLICATION_CREDENTIALS en local)"
  );
}

let app: App | null = null;

export function adminApp(): App {
  if (!app) app = getApps()[0] ?? createApp();
  return app;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
