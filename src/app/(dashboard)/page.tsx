/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSearchParams } from "next/navigation"; // ⬅️ NUEVO
import { useRedcapOptions } from "@/hooks/useRedcapOptions";
import { useRedcapProfiles } from "@/hooks/useRedcapProfiles"; // ⬅️ NUEVO
import RedcapReportCard from "@/components/RedcapReportCard";
import { useDashboardData } from "@/hooks/useDashboardData";
import RedcapReportTabs from "@/components/RedcapReportTabs";
import Card from "@/components/Card";
import Kpi from "@/components/Kpi";
import Tabs from "@/components/Tabs";
import PhotosGallery from "@/components/PhotosGallery";
import ToolbarFilters from "@/components/ToolbarFilters";
import { LESION_COLORS, colorForUnknown } from "@/utils/lesionColors";
import StaffActivityTab from "@/components/StaffActivityTab";
import AlertHallazgosGlobal from "@/components/AlertHallazgosGlobal";
import AlertFallasTecnicas from "@/components/AlertFallasTecnicas";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, ResponsiveContainer, Cell,
  ComposedChart
} from "recharts";

// Fecha de corte: solo mostrar datos desde el 18/12/2025
const CUTOFF_DATE = new Date('2025-12-18T00:00:00.000Z');
const CUTOFF_DATE_STR = '2025-12-18';

// Función helper para filtrar datos por fecha de corte
function filterByCutoffDate<T extends { day?: string }>(data: T[]): T[] {
  return data.filter(item => {
    const day = item.day;
    if (!day) return false;
    return day >= CUTOFF_DATE_STR;
  });
}

// Función helper para filtrar usuarios nuevos por mes
// Excluye meses anteriores a diciembre 2025
// Para diciembre 2025, mantiene el mes (el backend debe contar solo desde el 18/12)
function filterUsersPerMonth(data: Array<{ month: string; count: number }>): Array<{ month: string; count: number }> {
  return data.filter(item => {
    if (!item.month) return false;
    // Formato esperado: "2025-12", "2025-11", etc.
    const monthStr = item.month.trim();
    
    // Solo incluir diciembre 2025 y meses posteriores
    // "2025-12" >= "2025-12" es true
    return monthStr >= "2025-12";
  });
}

const tooltipStyle = { background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8, color: "#ededed" };
const tooltipItem  = { color: "#ededed" };
const tooltipLabel = { color: "#9ca3af" };

const RAD = Math.PI / 180;
function norm(s: any) {
  return String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
function renderPieLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, name, value } = props;
  const r = innerRadius + (outerRadius - innerRadius) * 0.65;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text x={x} y={y} fill="#ededed" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" style={{ fontSize: 12 }}>
      {`${name} (${value})`}
    </text>
  );
}

function fmtSec(s?: number) {
  if (!s || s <= 0) return "-";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function fmtPct(n?: number) {
  if (typeof n !== "number") return "-";
  return `${n.toFixed(1)}%`;
}

// Vista vacía reutilizable
function Empty({ msg = "Sin datos para el filtro actual" }: { msg?: string }) {
  return (
    <div className="w-full h-[260px] grid place-items-center text-sm text-neutral-400">
      {msg}
    </div>
  );
}


export default function DashboardPage() {
  // Filtros base (rango e “uso sostenido”)
  const { user, userRole } = useAuth();
  const { options: redcapOptions, loading: loadingRedcapCodes } = useRedcapOptions();
  const [days, setDays] = useState<number | "all">(30);
  const [weeks, setWeeks] = useState<number>(8);
  const [minPerWeek, setMinPerWeek] = useState<number>(1);
  const [fallas, setFallas] = useState<number>(0);
  const [loadingFallas, setLoadingFallas] = useState<boolean>(false);
  // Modo y perfil seleccionado
  const [mode, setMode] = useState<"global" | "profile">("global");
  const [profileId, setProfileId] = useState<string>("");
  const searchParams = useSearchParams();
  const redcapFromUrl = searchParams.get("redcap") || "";
  const allTabs = [
    { id: "overview", label: "Resumen" },
    { id: "activity", label: "Actividad" },
    { id: "ai", label: "Resultados IA" },
    { id: "quality", label: "Calidad" },
    { id: "users", label: "Usuarios & Retención" },
    { id: "redcap", label: "REDCap" },
    { id: "photos", label: "Fotos" },
    { id: "staff", label: "Personal" },
  ];
   // Filtra las pestañas según el rol del usuario
  const allowedTabs = userRole === 'full' 
    ? allTabs 
    : allTabs.filter(tab => tab.id === 'redcap' || tab.id === 'photos');
  // Si está en modo perfil y hay id, filtramos, si no, global
  const profileFilter = mode === "profile" && profileId ? profileId : undefined;
const {
  loading: loadingRedcap,
  profileToRedcapMap,            // ⬅️ ahora aquí
  profileIdsByRedcap,
  allProfilesWithAnyRedcap,
  allowedSet
} = useRedcapProfiles(redcapFromUrl || undefined);
async function computeFallasTamizaje() {
  try {
    setLoadingFallas(true);

    // Helper
    const isInicio = (ev: any) => {
      const s = String(ev ?? "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return s.startsWith("inicio");
    };
    const isEmpty = (v: any) => {
      const s = String(v ?? "").trim().toLowerCase();
      return !s || s === "na" || s === "n/a" || s === "-" || s === "sin dato";
    };

    // 1) Una sola llamada al 1219 (con o sin pacode, según haya redcap)
    const body: any = { reportId: "1219" };
    if (redcapFromUrl) body.pacode = redcapFromUrl; // ← solo si hay redcap seleccionado

    const res = await fetch("/api/redcap_report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `(${res.status}) REDCap`);

    const items: any[] = Array.isArray(data?.items) ? data.items : [];

    // 2) Contar: inicio_* y sexo vacío y dni vacío
    let total = 0;
    for (const row of items) {
      if (!isInicio(row?.redcap_event_name)) continue;
      const sexo = row?.ce_pasexo;
      const dni  = row?.ci_pardni;
      if (isEmpty(sexo) && isEmpty(dni)) total++;
    }

    setFallas(total);
  } catch (e) {
    console.error("computeFallasTamizaje", e);
    setFallas(0);
  } finally {
    setLoadingFallas(false);
  }
}
useEffect(() => {
  const hasRedcap = !!(redcapFromUrl?.trim());
  setMode(hasRedcap ? "profile" : "global");
  if (!hasRedcap) setProfileId("");
}, [redcapFromUrl]);

const allowedPacodes = useMemo(
  () => (redcapFromUrl ? profileIdsByRedcap : allProfilesWithAnyRedcap),
  [redcapFromUrl, profileIdsByRedcap, allProfilesWithAnyRedcap]
);
const redcapKey = redcapFromUrl || "ALL";
const {
  loading, error, kpis, camera, results,
  usersPerMonth, actives, sustained, sessions, quality, reload
} = useDashboardData(days, {
  sustainedWeeks: weeks,
  minPerWeek,
  profileId: mode === "profile" && profileId ? profileId : undefined, // sólo en modo perfil
});
  
  // Pestañas
  const [tab, setTab] = useState("overview");

  // Añade este efecto para redirigir automáticamente si el usuario no tiene acceso
  useEffect(() => {
    if (userRole === 'restricted' && !allowedTabs.find(t => t.id === tab)) {
      setTab('redcap'); // Redirigir a REDCap si la pestaña actual no está permitida
    }
  }, [userRole, tab, allowedTabs]);

  // Datos para el pie
  const pieData = useMemo(() => {
    if (!results) return [];
    return Object.entries(results.counts).map(([rawName, value]) => {
      const key = rawName.toLowerCase();
      const fill = LESION_COLORS[key] ?? colorForUnknown(key);
      return { name: rawName, value, fill };
    });
  }, [results]);

  // Filtrar datos por fecha de corte antes de mostrar
  const filteredPorDia = useMemo(() => {
    return filterByCutoffDate(camera?.porDia ?? []);
  }, [camera?.porDia]);

  const filteredSustainedSeries = useMemo(() => {
    if (!sustained?.weeklySeries) return [];
    return sustained.weeklySeries.filter(item => item.weekStart >= CUTOFF_DATE_STR);
  }, [sustained?.weeklySeries]);

  const filteredUsersPerMonth = useMemo(() => {
    return filterUsersPerMonth(usersPerMonth ?? []);
  }, [usersPerMonth]);

  // Helpers
  const hasPorDia = filteredPorDia.length > 0;
  const hasPorHora = (camera?.porHora?.some(d => d.count > 0) ?? false);
  const hasUsersPerMonth = filteredUsersPerMonth.length > 0;
  const hasPie = pieData.length > 0;
  const hasSustainedSeries = filteredSustainedSeries.length > 0;
  const baseProfileOptions = useMemo(
  () => (sustained?.photosPerProfile ?? []).map(p => ({ profileId: p.profileId })),
  [sustained]
);
  // Calidad
  const good = quality?.global.goodPhotos ?? 0;
  const bad  = quality?.global.badPhotos ?? 0;
  const hasQuality = (good + bad) > 0;
  const qualityBarData = [
    { name: "Buenas", value: good },
    { name: "Malas",  value: bad  },
  ];
  const qualityPerProfile = (quality?.perProfile ?? [])
    .slice()
    .sort((a, b) => b.goodRatePct - a.goodRatePct);

  // Opciones sugeridas de perfiles
   const profileOptions = useMemo(() => {
  if (!redcapFromUrl) return baseProfileOptions;
  return baseProfileOptions.filter(p => allowedSet.has(p.profileId));
}, [baseProfileOptions, redcapFromUrl, allowedSet]);
    useEffect(() => {
  // 1) Si NO estamos en modo perfil, asegúrate de limpiar el profileId
  if (mode !== "profile") {
    if (profileId) setProfileId("");
    return;
  }

  // 2) En modo perfil + con redcap activo
  if (redcapFromUrl) {
    // Si hay un perfil seleccionado pero ya no es válido para el redcap actual → limpiar
    if (profileId && !allowedSet.has(profileId)) {
      setProfileId("");
      return;
    }

    // Si no hay selección y SOLO existe 1 perfil permitido → autoseleccionarlo
    if (!profileId && allowedSet.size === 1) {
      const only = allowedSet.values().next().value as string;
      if (only) setProfileId(only);
    }
  }
}, [mode, profileId, redcapFromUrl, allowedSet, setProfileId]);

// Filtro de fotos/semana (tres buckets)
type PWeekBucket = "lt1" | "2to4" | "gt4";


// cache simple para DNI por código (evita múltiples llamadas)

function photosPerWeekOf(count?: number, weeks?: number) {
  if (!count || !weeks || weeks <= 0) return 0;
  return count / weeks;
}
function matchesBucket(pw: number, bucket: PWeekBucket) {
  if (bucket === "lt1")  return pw < 1;
  if (bucket === "2to4") return pw >= 2 && pw <= 4;
  return pw > 4; // "gt4"
}
function stats(arr: number[]) {
  if (!arr.length) {
    return { mean: 0, median: 0, std: 0, iqr: { q1: 0, q3: 0 } };
  }
  const s = [...arr].sort((a,b)=>a-b);
  const mean = s.reduce((a,b)=>a+b,0)/s.length;
  const median = s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2;
  const q = (p:number)=> {
    const idx = (s.length-1)*p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo===hi ? s[lo] : s[lo]*(hi-idx)+s[hi]*(idx-lo);
  };
  const q1 = q(0.25), q3 = q(0.75);
  const iqr = { q1, q3 };
  const std = Math.sqrt(s.reduce((acc,v)=>acc+(v-mean)*(v-mean),0)/s.length);
  return { mean, median, std, iqr };
}
// códigos (profileIds) que cumplen semanas + bucket
const [pweekBucket, setPweekBucket] = useState<PWeekBucket>("lt1");

// perfiles → fotos/semana → aplica bucket
const filteredProfilesByBucket = useMemo(() => {
  const list = sustained?.photosPerProfile ?? [];
  return list
    // ⬇️ excluye perfiles sin redcap_code
    .filter(p => !!profileToRedcapMap[p.profileId])
    .map(p => ({ profileId: p.profileId, pWeek: photosPerWeekOf(p.count, weeks) }))
    .filter(x => matchesBucket(x.pWeek, pweekBucket));
}, [sustained?.photosPerProfile, weeks, pweekBucket, profileToRedcapMap]);

// KPIs SEMANALES del subconjunto filtrado
const kpisWeekly = useMemo(() => {
  const arr = filteredProfilesByBucket.map(x => x.pWeek);
  return stats(arr); // { mean, median, std, iqr:{q1,q3} }
}, [filteredProfilesByBucket]);

// KPIs DIARIOS aproximados (fotos/sem ÷ 7)
const kpisDaily = useMemo(() => {
  const arr = filteredProfilesByBucket.map(x => x.pWeek / 7);
  return stats(arr);
}, [filteredProfilesByBucket]);

// Mapa robusto: profileId -> redcap_code
const profileToRedcap = useMemo(() => {
  const out: Record<string, string> = {};
  const dictAny: any = profileIdsByRedcap;

  // Caso A: el hook devolvió un array de profileIds (sin estar agrupados por código).
  //         En ese caso, asumimos que se refiere al redcap seleccionado en la URL.
  if (Array.isArray(dictAny)) {
    const code = redcapFromUrl || "UNKNOWN";
    (dictAny as string[]).forEach(pid => { if (pid) out[pid] = code; });
    return out;
  }

  // Caso B: el hook devolvió un Set de profileIds
  if (dictAny instanceof Set) {
    const code = redcapFromUrl || "UNKNOWN";
    Array.from(dictAny as Set<string>).forEach(pid => { if (pid) out[pid] = code; });
    return out;
  }

  // Caso C: objeto { [redcap_code]: X } donde X puede ser:
  //   - string[]
  //   - Set<string>
  //   - string
  //   - { profileIds: string[] } o { ids: string[] } o algún objeto con listas
  if (dictAny && typeof dictAny === "object") {
    Object.entries(dictAny).forEach(([code, pidsAny]) => {
      let arr: string[] = [];

      if (!pidsAny) return;

      if (Array.isArray(pidsAny)) {
        arr = pidsAny as string[];
      } else if (pidsAny instanceof Set) {
        arr = Array.from(pidsAny as Set<string>);
      } else if (typeof pidsAny === "string") {
        arr = [pidsAny];
      } else if (typeof pidsAny === "object") {
        // formas comunes: { profileIds: [...] } | { ids: [...] }
        const maybe =
          (pidsAny as any).profileIds ??
          (pidsAny as any).ids ??
          // último recurso: si es objeto plano con valores string, úsalos
          Object.values(pidsAny as any).filter(v => typeof v === "string");

        if (Array.isArray(maybe)) {
          arr = maybe as string[];
        }
      }

      arr.forEach(pid => { if (pid) out[pid] = code; });
    });
  }

  return out;
}, [profileIdsByRedcap, redcapFromUrl]);





/// cache simple de DNI por redcap_code
// cache simple de DNI por redcap_code
const [dniMap, setDniMap] = useState<Record<string, string>>({});

// normaliza claves
const normKey = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const normVal = (s: any) => String(s ?? "").trim();

// busca un valor por candidatos y por “olfato” (DNI)
function getValFlexible(row: any, candidates: string[], fallbackMatch?: (k: string) => boolean) {
  if (!row) return undefined;
  const keys = Object.keys(row);

  // exactos
  for (const c of candidates) {
    const hit = keys.find(k => normKey(k) === normKey(c));
    if (hit) return row[hit];
  }
  // contiene
  for (const c of candidates) {
    const hit = keys.find(k => normKey(k).includes(normKey(c)));
    if (hit) return row[hit];
  }
  // matcher ad-hoc
  if (fallbackMatch) {
    const hit = keys.find(k => fallbackMatch(normKey(k)));
    if (hit) return row[hit];
  }
  return undefined;
}

// códigos redcap únicos de los perfiles que pasaron el filtro
const filteredCodes = useMemo(() => {
  const codes = filteredProfilesByBucket
    .map(x => profileToRedcapMap[x.profileId])
    .filter(Boolean) as string[];
  return Array.from(new Set(codes));
}, [filteredProfilesByBucket, profileToRedcapMap]);

useEffect(() => {
  const missing = filteredCodes.filter(code => !dniMap[code]);
  if (missing.length === 0) return;

  let cancelled = false;

  (async () => {
    const updates: Record<string, string> = {};

    for (const code of missing) {
      try {
        const res = await fetch("/api/redcap_report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId: "1219", pacode: code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `(${res.status}) REDCap`);

        const all: any[] = Array.isArray(data?.items) ? data.items : [];

        // ⬇️ 1) quedarnos SOLO con filas cuyo ce_pacode == code (tolerante)
        const rowsThisCode = all.filter(r => {
          const rc = normVal(getValFlexible(
            r,
            ["ce_pacode", "code", "pacode"],
            k => k.includes("pacode") || k.endsWith("code")
          ));
          return normKey(rc) === normKey(code);
        });

        // ⬇️ 2) dentro de esas, priorizar INICIO; si no hay, usa la primera
        const rowInicio =
          rowsThisCode.find(r => normKey(r?.redcap_event_name).startsWith("inicio")) ||
          rowsThisCode[0];

        // ⬇️ 3) extraer DNI robusto (label/variable)
        const dni = normVal(getValFlexible(
          rowInicio,
          ["ci_pardni", "dni", "documento", "documento_identidad"],
          k => k.includes("dni") || (k.includes("doc") && k.includes("ident"))
        ));

        updates[code] = dni || "-";
      } catch {
        updates[code] = "-";
      }
    }

    if (!cancelled) {
      setDniMap(prev => ({ ...prev, ...updates }));
    }
  })();

  return () => { cancelled = true; };
}, [filteredCodes, dniMap]);

// Construye las filas que ya muestras en la tabla
function buildExportRows() {
  // OJO: aquí usas el mismo origen que la tabla para que exporte lo visible
  // filteredProfilesByBucket (filtra por semanas + bucket y excluye sin redcap_code)
  return filteredProfilesByBucket
    .slice() // copia
    .sort((a, b) => b.pWeek - a.pWeek)
    .map(({ profileId, pWeek }) => {
      const code = profileToRedcapMap[profileId] || "-";
      const dni  = dniMap[code] ?? ""; // ya lo resolviste en tu efecto
      return {
        "REDCap Code": code,
        "DNI": dni,
        "Fotos/sem": Number(pWeek.toFixed(2)),
      };
    });
}

async function handleExportExcel() {
  const rows = buildExportRows();
  if (!rows.length) {
    alert("No hay filas para exportar.");
    return;
  }

  const XLSX = await import("xlsx"); // carga on-demand
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });

  // Ajuste básico de anchos
  const colWidths = [
    { wch: 20 }, // REDCap Code
    { wch: 16 }, // DNI
    { wch: 12 }, // Fotos/sem
  ];
  (ws as any)["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, "Uso sostenido");

  const filename =
    `uso_sostenido_${weeks}sem_${pweekBucket.replace("to", "-")}_${new Date().toISOString().slice(0,10)}.xlsx`;

  XLSX.writeFile(wb, filename);
}




useEffect(() => {
  // si no hay redcap seleccionado y todavía están cargando los códigos, no calcules
  if (!redcapFromUrl && (loadingRedcapCodes || !redcapOptions || redcapOptions.length === 0)) return;
  computeFallasTamizaje();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [redcapFromUrl, redcapOptions, loadingRedcapCodes]);


useEffect(() => {
  console.log("Fallas tamizaje:", { fallas, loadingFallas, redcapFromUrl, options: redcapOptions?.length });
}, [fallas, loadingFallas, redcapFromUrl, redcapOptions]);
  return (
    <div className="space-y-6">
      <ToolbarFilters
        days={days} setDays={setDays}
        weeks={weeks} setWeeks={setWeeks}
        minPerWeek={minPerWeek} setMinPerWeek={setMinPerWeek}
        mode={mode} setMode={setMode}
        profileId={profileId} setProfileId={setProfileId}
        profileOptions={profileOptions}
        redcapOptions={redcapOptions}
        onRefresh={reload}
        loading={loading || loadingRedcap || loadingRedcapCodes}
        summary={{ photos: camera?.total  }}
        hideSustainedControls={userRole !== 'full'}  // Oculta controles si no es full access
        userRole={userRole}  // Pasa el rol como prop
      />

      {error && <div className="text-sm text-red-400">⚠ {error}</div>}

      <Tabs
  value={tab}
  onChange={setTab}
  tabs={allowedTabs}  // Usa las pestañas filtradas por rol
/>
      {/* Banner contextual si está en modo "perfil" */}
      {mode === "profile" && (
        <div className="text-xs px-3 py-2 rounded-md border border-neutral-800 bg-neutral-950">
          <span className="opacity-70">Modo por perfil:</span>{" "}
          <code className="font-mono">{profileId || "— sin perfil seleccionado —"}</code>
        </div>
      )}

      {/* === TAB: RESUMEN === */}
      {tab === "overview" && userRole === 'full' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
            <Kpi label="Fotos (semana actual)" value={kpis?.week ?? "-"} />
            <Kpi label="Semana anterior" value={kpis?.prevWeek ?? "-"} />
            <Kpi label="% cambio" value={(kpis?.diffPct ?? 0) + "%"} sub="vs semana anterior" />
            <Kpi label={`Total fotos (${days === "all" ? "hist" : days + "d"})`} value={camera?.total ?? "-"} />
            <Kpi label="Con hallazgos" value={`${results?.withFinding ?? 0}/${results?.total ?? 0}`} />
            <Kpi
              label="Fallas de tamizaje"
              value={loadingFallas ? "…" : fallas}
              sub="Inicios sin SEXO y DNI "
            />
            <Kpi label="MAU (perfiles)" value={actives?.MAU ?? "-"} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Fotos por día">
              {hasPorDia ? (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={filteredPorDia}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fill: "#9ca3af" }} />
                      <YAxis tick={{ fill: "#9ca3af" }} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                      <Line type="monotone" dataKey="count" stroke="#60a5fa" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty />}
            </Card>

            <Card title="Distribución por hora">
              {hasPorHora ? (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={camera?.porHora ?? []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" tick={{ fill: "#9ca3af" }} />
                      <YAxis tick={{ fill: "#9ca3af" }} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                      <Bar dataKey="count" fill="#a78bfa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty />}
            </Card>
          </div>
        </div>
      )}

      {/* === TAB: ACTIVIDAD === */}
      {tab === "activity" && userRole === 'full' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Fotos por día">
            {hasPorDia ? (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={filteredPorDia}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fill: "#9ca3af" }} />
                    <YAxis tick={{ fill: "#9ca3af" }} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                    <Line type="monotone" dataKey="count" stroke="#60a5fa" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty />}
          </Card>

          <Card title="Distribución por hora">
            {hasPorHora ? (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={camera?.porHora ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fill: "#9ca3af" }} />
                    <YAxis tick={{ fill: "#9ca3af" }} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                    <Bar dataKey="count" fill="#a78bfa" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty />}
          </Card>
        </div>
      )}

      {/* === TAB: RESULTADOS IA === */}
      {tab === "ai"&& userRole === 'full' && (
        <Card title="Resultados de IA (por clase)">
          {hasPie ? (
            <div style={{ width: "100%", height: 360 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" label={renderPieLabel} labelLine={{ stroke: "#475569" }}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
          <p className="text-xs opacity-70 mt-2">Basado en <code>resultDetails.className</code>/<code>classId</code>.</p>
        </Card>
      )}

      {/* === TAB: CALIDAD === */}
      {tab === "quality"&& userRole === 'full' && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <Kpi label="Fotos tomadas" value={quality?.global.photosTaken ?? "-"} />
            <Kpi label="Procesadas" value={quality?.global.photosProcessed ?? "-"} />
            <Kpi label="Buenas" value={quality?.global.goodPhotos ?? "-"} />
            <Kpi label="Tasa de adecuadas" value={fmtPct(quality?.global.goodRatePct)} sub="(Buenas / Tomadas) × 100" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Buenas vs Malas (conteo)">
              {hasQuality ? (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={qualityBarData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: "#9ca3af" }} />
                      <YAxis tick={{ fill: "#9ca3af" }} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                      <Bar dataKey="value" fill="#60a5fa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty />}
            </Card>

            <Card title="Top perfiles por tasa de adecuadas">
              <div className="max-h-[300px] overflow-auto border border-neutral-800 rounded">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-neutral-900/50">
                      <th className="px-3 py-2">Perfil</th>
                      <th className="px-3 py-2">Tomadas</th>
                      <th className="px-3 py-2">Buenas</th>
                      <th className="px-3 py-2">Malas</th>
                      <th className="px-3 py-2">Tasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityPerProfile.slice(0, 10).map(row => (
                      <tr key={row.profileId} className="border-t border-neutral-800">
                        <td className="px-3 py-2 font-mono">{row.profileId}</td>
                        <td className="px-3 py-2">{row.photosTaken}</td>
                        <td className="px-3 py-2">{row.goodPhotos}</td>
                        <td className="px-3 py-2">{row.badPhotos}</td>
                        <td className="px-3 py-2">{fmtPct(row.goodRatePct)}</td>
                      </tr>
                    ))}
                    {qualityPerProfile.length === 0 && (
                      <tr><td className="px-3 py-2" colSpan={5}>Sin datos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs opacity-70 mt-2">
                Fuente: contadores agregados desde <code>sessions</code> (goodPhotos/badPhotos/photosTaken/photosProcessed).
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* === TAB: USUARIOS & RETENCIÓN === */}
      {tab === "users" && userRole === 'full'&& (
        <div className="space-y-4">
          <div className="grid md:grid-cols- gap-4">
            <Card title="Usuarios nuevos por mes">
              {hasUsersPerMonth ? (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={filteredUsersPerMonth}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fill: "#9ca3af" }} />
                      <YAxis tick={{ fill: "#9ca3af" }} />
                      <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                      <Bar dataKey="count" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty />}
              <p className="text-xs opacity-70 mt-2">
                Nota: Diciembre 2025 cuenta solo desde el 18/12/2025 en adelante.
              </p>
            </Card>

            
          </div>

         {/* Uso sostenido */}
        <Card title={`Uso sostenido (últimas ${weeks} semanas)`}>
          {/* ⬇️ CONTROLES DENTRO DEL CARD */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-300">Ventana</span>
              <select
                className="select"
                value={weeks}
                onChange={(e) => setWeeks(parseInt(e.target.value))}
                title="Ventana en semanas"
              >
                <option value={4}>4 sem</option>
                <option value={8}>8 sem</option>
                <option value={12}>12 sem</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-300 whitespace-nowrap">Fotos / semana</span>
              <select
                className="select"
                value={pweekBucket}
                onChange={(e) => setPweekBucket(e.target.value as PWeekBucket)}
                title="Rango de fotos por semana"
              >
                <option value="lt1">&lt; 1</option>
                <option value="2to4">2 – 4</option>
                <option value="gt4">&gt; 4</option>
              </select>
            </div>

            {/* Si quieres recarga manual. Tu hook ya recalcula al cambiar weeks. */}
            <button className="btn-primary" onClick={reload}>
              Aplicar
            </button>
          </div>

          {/* Leyenda de series */}
          <div className="flex items-center gap-4 text-sm mb-2">
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#60a5fa" }} /> Fotos
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#34d399" }} /> Perfiles activos
            </span>
          </div>

          {/* KPIs */}
          <div className="grid md:grid-cols-3 gap-4">
            {/* Diario (derivado del filtro) */}
            <div className="space-y-2">
              <p className="text-sm opacity-80">Frecuencia diaria (fotos/día por perfil)</p>
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Media"      value={kpisDaily.mean.toFixed(2)} />
                <Kpi label="Mediana"    value={kpisDaily.median.toFixed(2)} />
                <Kpi label="Desv. Est." value={kpisDaily.std.toFixed(2)} />
                <Kpi label="IQR"        value={`${kpisDaily.iqr.q1.toFixed(2)}–${kpisDaily.iqr.q3.toFixed(2)}`} />
              </div>
            </div>

            {/* Semanal (derivado del filtro) */}
            <div className="space-y-2">
              <p className="text-sm opacity-80">Frecuencia semanal (fotos/sem por perfil)</p>
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Media"      value={kpisWeekly.mean.toFixed(2)} />
                <Kpi label="Mediana"    value={kpisWeekly.median.toFixed(2)} />
                <Kpi label="Desv. Est." value={kpisWeekly.std.toFixed(2)} />
                <Kpi label="IQR"        value={`${kpisWeekly.iqr.q1.toFixed(2)}–${kpisWeekly.iqr.q3.toFixed(2)}`} />
              </div>
            </div>

            {/* Conteo del subconjunto (puedes mantener tu “Tasa (%)” o mostrar este conteo) */}
            <div className="space-y-2">
              <p className="text-sm opacity-80">Perfiles que cumplen el filtro</p>
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Perfiles" value={filteredProfilesByBucket.length} />
                <Kpi label="Ventana"  value={`${weeks} sem`} />
                <Kpi label="Fotos/sem" value={
                  pweekBucket === "lt1" ? "< 1" : pweekBucket === "2to4" ? "2 – 4" : "> 4"
                } />
              </div>
            </div>
          </div>


          {/* ⬇️ TU GRÁFICA NO SE TOCA */}
          {hasSustainedSeries ? (
            <div className="mt-6" style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <ComposedChart data={filteredSustainedSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="weekStart" tick={{ fill: "#9ca3af" }} />
                  <YAxis yAxisId="left" tick={{ fill: "#9ca3af" }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#9ca3af" }} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItem} labelStyle={tooltipLabel} />
                  <Bar yAxisId="left" dataKey="photos" name="Fotos" fill="#60a5fa" />
                  <Line yAxisId="right" type="monotone" dataKey="activeProfiles" name="Perfiles activos" stroke="#34d399" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty />}
          {/* Tabla de códigos filtrados por semanas + fotos/sem */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-neutral-300">
                Códigos que cumplen filtro — Ventana: <b>{weeks} semanas</b>, Fotos/sem:{" "}
                <b>{pweekBucket === "lt1" ? "< 1" : pweekBucket === "2to4" ? "2 – 4" : "> 4"}</b>
              </p>
              <button
                onClick={handleExportExcel}
                className="px-3 py-1.5 text-sm rounded-md border border-neutral-800 hover:bg-neutral-900"
                title="Descargar Excel"
              >
                Descargar Excel
              </button>
            </div>

            {filteredProfilesByBucket.length === 0 ? (
              <div className="text-sm text-neutral-400">Sin perfiles que cumplan el filtro.</div>
            ) : (
              <div className="max-h-[320px] overflow-auto border border-neutral-800 rounded">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-neutral-900/50 sticky top-0">
                      <th className="px-3 py-2 border-b border-neutral-800">REDCap Code</th>
                      <th className="px-3 py-2 border-b border-neutral-800">DNI</th>
                      <th className="px-3 py-2 border-b border-neutral-800">Fotos/sem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProfilesByBucket
                      .sort((a, b) => b.pWeek - a.pWeek)
                      .map(({ profileId, pWeek }) => {
                        const code = profileToRedcapMap[profileId] || "-";
                        return (
                          <tr key={profileId} className="border-t border-neutral-800">
                            <td className="px-3 py-2 font-mono">{code}</td>
                            <td className="px-3 py-2">{dniMap[code] ?? "…"}</td>
                            <td className="px-3 py-2">{pWeek.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>


        </Card>


          {/* Sesiones */}
          <Card title={`Sesiones (últimos ${days === "all" ? 90 : days} días)`}>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-sm opacity-80">Duración por sesión</p>
                <div className="grid grid-cols-2 gap-2">
                  <Kpi label="Media"   value={fmtSec(sessions?.durationSec?.mean)} />
                  <Kpi label="Mediana" value={fmtSec(sessions?.durationSec?.median)} />
                  <Kpi label="Desv. Est." value={fmtSec(sessions?.durationSec?.std)} />
                  <Kpi label="IQR" value={`${fmtSec(sessions?.durationSec?.iqr?.q1)}–${fmtSec(sessions?.durationSec?.iqr?.q3)}`} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm opacity-80">Fotos por sesión</p>
                <div className="grid grid-cols-2 gap-2">
                  <Kpi label="Media"   value={sessions?.photosPerSession?.mean ?? "-"} />
                  <Kpi label="Mediana" value={sessions?.photosPerSession?.median ?? "-"} />
                  <Kpi label="Desv. Est." value={sessions?.photosPerSession?.std ?? "-"} />
                  <Kpi label="IQR" value={`${sessions?.photosPerSession?.iqr?.q1 ?? "-"}–${sessions?.photosPerSession?.iqr?.q3 ?? "-"}`} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm opacity-80">Resumen</p>
                <div className="grid grid-cols-2 gap-2">
                  <Kpi label="Total sesiones" value={sessions?.sessions ?? "-"} />
                  <Kpi label="Total fotos" value={camera?.total ?? "-"} />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

{tab === "redcap" && (
  <div className="space-y-4">
    <AlertHallazgosGlobal />
    <AlertFallasTecnicas
      reportId="1245"
      supportReportIds={["1221","1220","1222"]}
      excludeCierre
    />
    <RedcapReportTabs
      key={`tabs-${mode}-${redcapKey}`}
      mode={mode}
      profileCode={redcapFromUrl || ""}
    />
  </div>
)}
{tab === "photos" && (
  <PhotosGallery
    mode={mode}
    redcapCode={redcapFromUrl || ""}
    profileIdFromMode={profileId || undefined}
    max={60}
  />
)}
{tab === "staff" && userRole === 'full' && <StaffActivityTab />}

<div className="pt-2">
  {mode === "global" && (
    <RedcapReportCard
      key={`card-global-${redcapKey}`}     // <- remount si cambia REDCap
      mode="global"
      profileCode={redcapFromUrl || ""}    // <- filtro por código en GLOBAL
    />
  )}

  {mode === "profile" && profileId && (
  <RedcapReportCard
    key={`card-profile-${profileId}-${redcapKey}`}
    mode="profile"
    profileId={profileId}
    profileCode={redcapFromUrl || ""}
  />
)}
</div>

    </div>
  );
}
