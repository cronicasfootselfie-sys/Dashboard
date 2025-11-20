// lib/redcapFirestore.ts
import {
  getFirestore, collection, getDocs, query, where
} from 'firebase/firestore';

const db = getFirestore();

/** Ya lo tenías */
export async function getProfilesByUserRedcap(redcapCode: string) {
  const usersQ = query(collection(db, 'users'), where('redcap_code', '==', redcapCode));
  const usersSnap = await getDocs(usersQ);

  const results = await Promise.all(
    usersSnap.docs.map(async (u) => {
      const profilesSnap = await getDocs(collection(u.ref, 'profiles'));
      const first = profilesSnap.docs[0];
      if (!first) return null;
      return { userId: u.id, profileId: first.id, redcap_code: redcapCode, ...first.data() };
    })
  );
  return results.filter(Boolean) as Array<{ userId: string; profileId: string; redcap_code: string; [k: string]: any }>;
}

/**
 * NUEVO: Lista de códigos REDCap que SÍ tienen al menos un profile asociado.
 * - Filtra users con redcap_code no vacío.
 * - Verifica que exista al menos 1 profile en la subcolección.
 * - Devuelve únicos y ordenados.
 */
export async function getRedcapCodesWithProfiles(): Promise<string[]> {
  // Nota: Firestore requiere orderBy cuando usas '!='
  const usersQ = query(collection(db, 'users'), where('redcap_code', '!=', ''));
  const usersSnap = await getDocs(usersQ);

  const codes: string[] = [];
  await Promise.all(
    usersSnap.docs.map(async (u) => {
      const data = u.data() as any;
      const code = (data?.redcap_code ?? '').trim();
      if (!code) return;

      const profilesSnap = await getDocs(collection(u.ref, 'profiles'));
      if (profilesSnap.size > 0) codes.push(code);
    })
  );

  // únicos y ordenados
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
}
export async function getAllProfilesWithAnyRedcap(): Promise<string[]> {
  const usersQ = query(collection(db, 'users'), where('redcap_code', '!=', ''));
  const usersSnap = await getDocs(usersQ);

  const ids: string[] = [];
  await Promise.all(
    usersSnap.docs.map(async (u) => {
      const profilesSnap = await getDocs(collection(u.ref, 'profiles'));
      const first = profilesSnap.docs[0];
      if (first) ids.push(first.id);
    })
  );
  // únicos
  return Array.from(new Set(ids));
}

export async function getSingleProfileIdByRedcap(redcapCode: string): Promise<{
  status: "ok" | "none" | "many";
  profileId?: string;
  count: number;
}> {
  const rows = await getProfilesByUserRedcap(redcapCode);
  if (rows.length === 1) return { status: "ok", profileId: rows[0].profileId, count: 1 };
  if (rows.length === 0) return { status: "none", count: 0 };
  return { status: "many", count: rows.length };
}

// Mapa global: profileId -> redcap_code
export async function getProfileToRedcapMap(): Promise<Record<string, string>> {
  const db = getFirestore();
  const usersQ = query(collection(db, 'users'), where('redcap_code', '!=', ''));
  const usersSnap = await getDocs(usersQ);

  const map: Record<string, string> = {};
  await Promise.all(
    usersSnap.docs.map(async (u) => {
      const data = u.data() as any;
      const code = (data?.redcap_code ?? '').trim();
      if (!code) return;

      const profilesSnap = await getDocs(collection(u.ref, 'profiles'));
      const first = profilesSnap.docs[0];
      if (first) {
        map[first.id] = code;
      }
    })
  );
  return map;
}

// (opcional) también por si quieres agrupar por código:
export async function getProfileIdsByRedcap(): Promise<Record<string, string[]>> {
  const db = getFirestore();
  const usersQ = query(collection(db, 'users'), where('redcap_code', '!=', ''));
  const usersSnap = await getDocs(usersQ);

  const out: Record<string, string[]> = {};
  await Promise.all(
    usersSnap.docs.map(async (u) => {
      const code = String((u.data() as any)?.redcap_code ?? '').trim();
      if (!code) return;
      const profilesSnap = await getDocs(collection(u.ref, 'profiles'));
      const first = profilesSnap.docs[0];
      if (!first) return;
      (out[code] ||= []).push(first.id);
    })
  );
  // únicos
  Object.keys(out).forEach(c => out[c] = Array.from(new Set(out[c])));
  return out;
}
