// components/ToolbarFilters.tsx
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth"; // Añade esta importación

type Summary = { photos?: number; WAU?: number; MAU?: number };
type ProfileOption = { profileId: string; label?: string };
type Option = { label: string; value: string };

type Props = {
  // estado actual
  days: number | "all";
  setDays: (v: number | "all") => void;

  weeks: number;
  setWeeks: (v: number) => void;

  minPerWeek: number;
  setMinPerWeek: (v: number) => void;

  // Modo y perfil seleccionado
  mode: "global" | "profile";
  setMode: (m: "global" | "profile") => void;
  profileId: string;
  setProfileId: (id: string) => void;

  /** Opcional: lista sugerida de perfiles para el dropdown. */
  profileOptions?: ProfileOption[];

  /** 🆕: SOLO códigos redcap que tienen perfiles asociados */
  redcapOptions: Option[];

  onRefresh: () => void;
  loading?: boolean;
  summary?: Summary;
  hideSustainedControls?: boolean;
  
  /** 🆕 NUEVA PROP: Rol del usuario (opcional - si no se pasa, se usa useAuth internamente) */
  userRole?: 'full' | 'restricted' | null;
};

function Label({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <div className="text-sm flex items-center gap-2">
      <span>{children}</span>
      {tip && (
        <span
          className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-neutral-800 text-neutral-300"
          title={tip}
          aria-label={tip}
        >
          ?
        </span>
      )}
    </div>
  );
}

export default function ToolbarFilters({
  days, setDays,
  weeks, setWeeks,
  minPerWeek, setMinPerWeek,
  mode, setMode,
  profileId, setProfileId,
  profileOptions = [],
  redcapOptions,
  onRefresh, loading,
  summary,
  hideSustainedControls = false,
  userRole: userRoleFromProps, // 🆕 Recibe como prop (opcional)
}: Props) {
  const { userRole: userRoleFromAuth } = useAuth(); // Obtener el rol del usuario
  
  // 🆕 Usa la prop si está disponible, sino usa el valor del hook
  const userRole = userRoleFromProps ?? userRoleFromAuth;
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const redcapFromUrl = searchParams.get("redcap") || "";

  function setRedcapInUrl(code: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (code) params.set("redcap", code);
    else params.delete("redcap");
    router.replace(`?${params.toString()}`);
  }

  // Determinar qué controles mostrar basado en el rol
  const showFullControls = userRole === 'full';
  const showSustainedControls = showFullControls && !hideSustainedControls;

  return (
    <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-neutral-950/80 backdrop-blur border-b border-neutral-900">
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <h2 className="text-xl font-semibold">Dashboard</h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* Rango - Mostrar para todos los usuarios */}
          <div className="flex items-center gap-2">
            <Label tip="Afecta 'Actividad', 'Resultados IA', 'Calidad' y 'Sesiones'. 'Histórico' ignora la fecha.">
              Rango
            </Label>
            <select
              className="select"
              value={String(days)}
              onChange={(e) => setDays(e.target.value === "all" ? "all" : parseInt(e.target.value))}
            >
              <option value="7">7 días</option>
              <option value="30">30 días</option>
              <option value="90">90 días</option>
              <option value="all">Histórico</option>
            </select>

            {/* Presets rápidos - Solo para acceso completo */}
            {showFullControls && (
              <div className="hidden sm:flex items-center gap-1">
                <button className="chip" onClick={() => setDays(7)}>7d</button>
                <button className="chip" onClick={() => setDays(30)}>30d</button>
                <button className="chip" onClick={() => setDays(90)}>90d</button>
                <button className="chip" onClick={() => setDays("all")}>Hist.</button>
              </div>
            )}
          </div>

          {/* Separador */}
          <div className="hidden md:flex h-6 w-px bg-neutral-800" />

          {/* Selector de CÓDIGO REDCap - Mostrar para todos */}
          <select
            className="select"
            value={redcapFromUrl}
            onChange={(e) => {
              const v = e.target.value.trim();
              setRedcapInUrl(v);
              // forzamos el modo automáticamente
              setMode(v ? "profile" : "global");
              if (!v) setProfileId("");  // limpiar perfil si vuelves a "Todos"
            }}
            title="Código REDCap"
          >
            <option value="">Todos</option>
            {redcapOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Separador */}
          <div className="hidden md:flex h-6 w-px bg-neutral-800" />

          {/* Uso sostenido - Solo para acceso completo */}
          {showSustainedControls && (
            <div className="flex items-center gap-2">
              <Label tip="Ventana para calcular 'uso sostenido'. No depende del filtro de Rango.">
                Uso sostenido
              </Label>
              <select
                className="select"
                value={weeks}
                onChange={(e) => setWeeks(parseInt(e.target.value))}
                title="Ventana en semanas"
              >
                <option value={4}>4 sem</option>
                <option value={8}>8 sem</option>
                <option value={12}>12 sem</option>
                <option value={24}>24 sem</option>
              </select>
              <select
                className="select"
                value={minPerWeek}
                onChange={(e) => setMinPerWeek(parseInt(e.target.value))}
                title="Mínimo de fotos por semana"
              >
                <option value={1}>≥ 1 foto/sem</option>
                <option value={2}>≥ 2 fotos/sem</option>
                <option value={3}>≥ 3 fotos/sem</option>
              </select>
            </div>
          )}

          <button
            className="btn-primary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Cargando…" : "Aplicar filtros"}
          </button>
        </div>
      </div>

      {/* Fila de ayuda + mini-KPIs opcionales */}
      <div className="mt-2 text-xs text-neutral-400 flex flex-wrap items-center gap-3">
        <span>
          Nota: <em>Rango</em> no altera "Uso sostenido"; éste usa su propia ventana (semanas).
        </span>
        {(summary?.photos ?? null) !== null && <span className="divider" />}
        {typeof summary?.photos === "number" && (
          <span className="chip-muted" title="Fotos en el rango actual">
            Fotos: {summary.photos}
          </span>
        )}
        {showFullControls && typeof summary?.WAU === "number" && (
          <span className="chip-muted" title="Perfiles activos últimos 7 días">
            WAU: {summary.WAU}
          </span>
        )}
        {showFullControls && typeof summary?.MAU === "number" && (
          <span className="chip-muted" title="Perfiles activos últimos 30 días">
            MAU: {summary.MAU}
          </span>
        )}
      </div>
    </div>
  );
}