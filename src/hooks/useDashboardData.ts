/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import {
  getAiResults,
  getCameraUsage,
  getNewUsersPerMonth,
  getWeeklyKpis,
  getActiveUsers,
  getSustainedUsage,
  getSessionStats,
  getQualityStats,
} from "@/lib/apiClient";

export type DayCount = { day: string; count: number };
export type HourCount = { hour: number; count: number };

type Kpis = { week: number; prevWeek: number; diffPct: number };
type Camera = { porDia: DayCount[]; porHora: HourCount[]; total: number };
type Ai = { counts: Record<string, number>; withFinding: number; total: number };
type UsersPerMonth = { month: string; count: number }[];
type Actives = { WAU: number; MAU: number; totalProfilesActiveEver: number };

export type Quantiles = { q1: number; q3: number };
export type StatsNum = { mean: number; median: number; std: number; iqr: Quantiles };
export type WeeklySeries = { weekStart: string; activeProfiles: number; photos: number };
export type PhotosPerProfile = { profileId: string; count: number };
export type Sustained = {
  windowWeeks: number;
  profiles: number;
  daily: StatsNum;
  weekly: StatsNum;
  sustained: { count: number; ratePct: number };
  weeklySeries: WeeklySeries[];
  photosPerProfile: PhotosPerProfile[];
};

export type Sessions = {
  sessions: number;
  durationSec: StatsNum;
  photosPerSession: StatsNum;
};

export type Quality = {
  days: number | "all";
  global: {
    photosTaken: number;
    photosProcessed: number;
    goodPhotos: number;
    badPhotos: number;
    goodRatePct: number;
  };
  perProfile?: Array<{
    profileId: string;
    photosTaken: number;
    goodPhotos: number;
    badPhotos: number;
    goodRatePct: number;
  }>;
};

type Options = {
  sustainedWeeks?: number;
  minPerWeek?: number;

  /** Filtro original: un solo perfil */
  profileId?: string;

  /** NUEVO: lista de perfiles para agregar en cliente */
  profileIds?: string[];
};

/* ----------------------- helpers de agregación ----------------------- */

function sumByKey<T extends string | number>(
  items: Array<Record<string, number>>,
  key: string
) {
  return items.reduce((acc, x) => acc + (x[key] ?? 0), 0);
}

function mergePorDia(arrays: DayCount[][]): DayCount[] {
  const map = new Map<string, number>();
  for (const arr of arrays) {
    for (const { day, count } of arr) {
      map.set(day, (map.get(day) ?? 0) + count);
    }
  }
  return [...map.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function mergePorHora(arrays: HourCount[][]): HourCount[] {
  const map = new Map<number, number>();
  for (const arr of arrays) {
    for (const { hour, count } of arr) {
      map.set(hour, (map.get(hour) ?? 0) + count);
    }
  }
  return [...map.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);
}

function mergeKpis(list: Kpis[]): Kpis {
  const week = list.reduce((s, x) => s + (x.week ?? 0), 0);
  const prevWeek = list.reduce((s, x) => s + (x.prevWeek ?? 0), 0);
  const diffPct = prevWeek > 0 ? ((week - prevWeek) / prevWeek) * 100 : 0;
  return { week, prevWeek, diffPct };
}

function mergeCamera(list: Camera[]): Camera {
  return {
    porDia: mergePorDia(list.map(x => x.porDia)),
    porHora: mergePorHora(list.map(x => x.porHora)),
    total: list.reduce((s, x) => s + (x.total ?? 0), 0),
  };
}

function mergeAi(list: Ai[]): Ai {
  const counts: Record<string, number> = {};
  let withFinding = 0;
  let total = 0;
  for (const x of list) {
    total += x.total ?? 0;
    withFinding += x.withFinding ?? 0;
    for (const k of Object.keys(x.counts ?? {})) {
      counts[k] = (counts[k] ?? 0) + x.counts[k];
    }
  }
  return { counts, withFinding, total };
}

// util para unir y sumar por profileId
function mergePhotosPerProfile(arrays: PhotosPerProfile[][]): PhotosPerProfile[] {
  const map = new Map<string, number>();
  for (const arr of arrays) {
    for (const { profileId, count } of arr) {
      map.set(profileId, (map.get(profileId) ?? 0) + count);
    }
  }
  return [...map.entries()].map(([profileId, count]) => ({ profileId, count }));
}

// intenta combinar series semanales sumando fotos y activos
function mergeWeeklySeries(arrays: WeeklySeries[][]): WeeklySeries[] {
  const map = new Map<string, { activeProfiles: number; photos: number }>();
  for (const arr of arrays) {
    for (const it of arr) {
      const prev = map.get(it.weekStart) ?? { activeProfiles: 0, photos: 0 };
      map.set(it.weekStart, {
        activeProfiles: prev.activeProfiles + (it.activeProfiles ?? 0),
        photos: prev.photos + (it.photos ?? 0),
      });
    }
  }
  return [...map.entries()]
    .map(([weekStart, v]) => ({ weekStart, activeProfiles: v.activeProfiles, photos: v.photos }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// StatsNum completos requieren crudos para mediana/std; hacemos aproximación:
// usamos medias ponderadas y dejamos median/std/iqr del primero como referencia.
function mergeStatsApprox(list: StatsNum[]): StatsNum {
  if (list.length === 0) {
    return { mean: 0, median: 0, std: 0, iqr: { q1: 0, q3: 0 } };
  }
  // Suponemos misma base de conteo; usamos media promedio simple.
  const mean = list.reduce((s, x) => s + (x.mean ?? 0), 0) / list.length;
  const ref = list[0];
  return { mean, median: ref.median, std: ref.std, iqr: ref.iqr };
}

function mergeSustained(list: Sustained[], windowWeeks: number): Sustained {
  const photosPerProfile = mergePhotosPerProfile(list.map(x => x.photosPerProfile ?? []));
  const weeklySeries = mergeWeeklySeries(list.map(x => x.weeklySeries ?? []));
  const profiles = new Set(photosPerProfile.map(x => x.profileId)).size;

  // Sumar conteos para tasa sostenida
  const sustainedCount = list.reduce((s, x) => s + (x.sustained?.count ?? 0), 0);
  const sustainedTotal = list.reduce((s, x) => s + (x.profiles ?? 0), 0);
  const ratePct = sustainedTotal > 0 ? (sustainedCount / sustainedTotal) * 100 : 0;

  // Aproximaciones para stats
  const daily = mergeStatsApprox(list.map(x => x.daily));
  const weekly = mergeStatsApprox(list.map(x => x.weekly));

  return {
    windowWeeks,
    profiles,
    daily,
    weekly,
    sustained: { count: sustainedCount, ratePct },
    weeklySeries,
    photosPerProfile,
  };
}

function mergeSessions(list: Sessions[]): Sessions {
  // Sumamos número de sesiones y aproximamos stats
  const sessions = list.reduce((s, x) => s + (x.sessions ?? 0), 0);
  const durationSec = mergeStatsApprox(list.map(x => x.durationSec));
  const photosPerSession = mergeStatsApprox(list.map(x => x.photosPerSession));
  return { sessions, durationSec, photosPerSession };
}

function mergeQuality(list: Quality[], days: number | "all"): Quality {
  let photosTaken = 0, photosProcessed = 0, goodPhotos = 0, badPhotos = 0;
  const perMap = new Map<string, { photosTaken: number; goodPhotos: number; badPhotos: number }>();

  for (const q of list) {
    photosTaken += q.global.photosTaken ?? 0;
    photosProcessed += q.global.photosProcessed ?? 0;
    goodPhotos += q.global.goodPhotos ?? 0;
    badPhotos += q.global.badPhotos ?? 0;

    for (const it of q.perProfile ?? []) {
      const prev = perMap.get(it.profileId) ?? { photosTaken: 0, goodPhotos: 0, badPhotos: 0 };
      perMap.set(it.profileId, {
        photosTaken: prev.photosTaken + (it.photosTaken ?? 0),
        goodPhotos: prev.goodPhotos + (it.goodPhotos ?? 0),
        badPhotos: prev.badPhotos + (it.badPhotos ?? 0),
      });
    }
  }

  const perProfile = [...perMap.entries()].map(([profileId, v]) => ({
    profileId,
    photosTaken: v.photosTaken,
    goodPhotos: v.goodPhotos,
    badPhotos: v.badPhotos,
    goodRatePct: v.photosTaken > 0 ? (v.goodPhotos / v.photosTaken) * 100 : 0,
  }));

  const globalGoodRate = photosTaken > 0 ? (goodPhotos / photosTaken) * 100 : 0;

  return {
    days,
    global: { photosTaken, photosProcessed, goodPhotos, badPhotos, goodRatePct: globalGoodRate },
    perProfile,
  };
}

/* ----------------------- hook principal ----------------------- */

export function useDashboardData(
  days: number | "all",
  { sustainedWeeks = 8, minPerWeek = 1, profileId, profileIds }: Options = {}
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [results, setResults] = useState<Ai | null>(null);
  const [usersPerMonth, setUsersPerMonth] = useState<UsersPerMonth>([]);
  const [actives, setActives] = useState<Actives | null>(null);

  const [sustained, setSustained] = useState<Sustained | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);

  const [quality, setQuality] = useState<Quality | null>(null);

  async function loadSingle(pid?: string) {
    const [k, c, r, u, a, su, ss, q] = await Promise.all([
      getWeeklyKpis(pid),
      getCameraUsage(days, pid),
      getAiResults(days, pid),
      getNewUsersPerMonth(), // sigue siendo global de plataforma
      getActiveUsers(),      // sigue siendo global de plataforma
      getSustainedUsage(sustainedWeeks, minPerWeek, pid),
      getSessionStats(days, pid),
      getQualityStats(days, pid),
    ]);
    return { k, c, r, u, a, su, ss, q };
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Caso 1: lista de perfiles para “Global” filtrado por redcap(s)
      if (profileIds && profileIds.length > 0) {
        const chunks = profileIds; // si necesitas límite, aquí podrías trocear
        const all = await Promise.all(chunks.map(pid => loadSingle(pid)));

        // Agregamos por secciones
        const k = mergeKpis(all.map(x => x.k));
        const c = mergeCamera(all.map(x => x.c));
        const r = mergeAi(all.map(x => x.r));
        // Users/Actives los dejamos globales (tomamos el primero)
        const u = all[0].u;
        const a = all[0].a;
        const su = mergeSustained(all.map(x => x.su), sustainedWeeks);
        const ss = mergeSessions(all.map(x => x.ss));
        const q = mergeQuality(all.map(x => x.q), days);

        setKpis(k);
        setCamera(c);
        setResults(r);
        setUsersPerMonth(u);
        setActives(a);
        setSustained(su);
        setSessions(ss);
        setQuality(q);
        return;
      }

      // Caso 2: un único perfil (igual que antes)
      const { k, c, r, u, a, su, ss, q } = await loadSingle(profileId);
      setKpis(k);
      setCamera(c);
      setResults(r);
      setUsersPerMonth(u);
      setActives(a);
      setSustained(su);
      setSessions(ss);
      setQuality(q);
    } catch (e: any) {
      setError(e?.error || e?.message || "Error cargando datos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, sustainedWeeks, minPerWeek, profileId, JSON.stringify(profileIds)]);

  return {
    loading,
    error,
    kpis,
    camera,
    results,
    usersPerMonth,
    actives,
    sustained,
    sessions,
    quality,
    reload: load,
  };
}
