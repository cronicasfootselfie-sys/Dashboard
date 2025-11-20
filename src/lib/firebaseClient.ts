/* eslint-disable @typescript-eslint/no-explicit-any */
// web/src/lib/firebaseClient.ts
"use client";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

// Lee config desde .env.local
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

function ensureApp() {
  if (typeof window === "undefined") return null;
  return getApps().length ? getApp() : initializeApp(config);
}

const app = ensureApp();
export const auth = app ? getAuth(app) : (undefined as unknown as ReturnType<typeof getAuth>);

/** Suscripción a cambios de usuario.
 *  Devuelve un unsubscribe. En SSR/Node no hace nada. */
export function onUser(cb: (user: User | null) => void) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, cb);
}

export async function loginWithGoogle(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!auth) throw new Error("Auth no inicializado");
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "No se pudo iniciar sesión" };
  }
}

export async function logout() {
  if (!auth) return;
  await signOut(auth);
}

/** Obtiene el ID token actual (o null si no hay sesión) */
export async function currentIdToken(forceRefresh = false) {
  if (!auth || !auth.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
}
