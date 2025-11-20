"use client";
import React from "react";

type Props = {
  // estado actual
  days: number | "all";
  sustainedWeeks: number;
  minPerWeek: number;
  sessionThresholdMin: number;
  // setters
  onChangeDays: (v: number | "all") => void;
  onChangeSustainedWeeks: (v: number) => void;
  onChangeMinPerWeek: (v: number) => void;
  onChangeSessionThreshold: (v: number) => void;
  // acción
  onApply: () => void;
  // mini-resumen opcional
  summary?: { photos?: number; WAU?: number; MAU?: number };
};

function Label({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip?: string;
}) {
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

export default function FiltersBar({
  days,
  sustainedWeeks,
  minPerWeek,
  sessionThresholdMin,
  onChangeDays,
  onChangeSustainedWeeks,
  onChangeMinPerWeek,
  onChangeSessionThreshold,
  onApply,
  summary,
}: Props) {
  return (
    <section className="mb-4">
      {/* Fila de controles */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Rango */}
        <div className="flex items-center gap-2">
          <Label tip="Afecta 'Actividad', 'Resultados IA' y 'Usuarios & Retención'. El histórico ignora la fecha.">
            Rango
          </Label>
          <select
            className="select"
            value={String(days)}
            onChange={(e) =>
              onChangeDays(e.target.value === "all" ? "all" : parseInt(e.target.value))
            }
          >
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="all">Histórico</option>
          </select>

          {/* Presets rápidos */}
          <div className="hidden sm:flex items-center gap-1">
            <button className="chip" onClick={() => onChangeDays(7)}>7d</button>
            <button className="chip" onClick={() => onChangeDays(30)}>30d</button>
            <button className="chip" onClick={() => onChangeDays(90)}>90d</button>
            <button className="chip" onClick={() => onChangeDays("all")}>Hist.</button>
          </div>
        </div>

        {/* Uso sostenido */}
        <div className="flex items-center gap-2">
          <Label tip="Ventana para calcular 'uso sostenido'. No depende del filtro de Rango.">
            Uso sostenido
          </Label>
          <select
            className="select"
            value={sustainedWeeks}
            onChange={(e) => onChangeSustainedWeeks(parseInt(e.target.value))}
          >
            {[4, 8, 12, 24].map((w) => (
              <option key={w} value={w}>{w} sem</option>
            ))}
          </select>
          <select
            className="select"
            value={minPerWeek}
            onChange={(e) => onChangeMinPerWeek(parseInt(e.target.value))}
            title="Mínimo de fotos por semana para considerar 'uso sostenido'"
          >
            <option value={1}>≥ 1 foto/sem</option>
            <option value={2}>≥ 2 fotos/sem</option>
            <option value={3}>≥ 3 fotos/sem</option>
          </select>
        </div>

        {/* Sesiones */}
        <div className="flex items-center gap-2">
          <Label tip="Tiempo máximo entre fotos para considerar que siguen en la misma sesión.">
            Sesión
          </Label>
          <select
            className="select"
            value={sessionThresholdMin}
            onChange={(e) => onChangeSessionThreshold(parseInt(e.target.value))}
          >
            <option value={15}>Umbral 15m</option>
            <option value={30}>Umbral 30m</option>
            <option value={45}>Umbral 45m</option>
            <option value={60}>Umbral 60m</option>
          </select>
        </div>

        <button className="btn-primary ml-auto" onClick={onApply}>
          Actualizar
        </button>
      </div>

      {/* Subtítulo explicativo + mini KPIs */}
      <div className="mt-2 text-xs text-neutral-400 flex flex-wrap items-center gap-3">
        <span>
          Nota: <em>Rango</em> no altera “Uso sostenido”; éste usa su propia ventana.
        </span>
        {typeof summary?.photos === "number" && (
          <span className="divider" />
        )}
        {typeof summary?.photos === "number" && (
          <span className="chip-muted" title="Fotos en el rango actual">
            Fotos: {summary!.photos}
          </span>
        )}
        {typeof summary?.WAU === "number" && (
          <span className="chip-muted" title="Perfiles activos últimos 7 días">
            WAU: {summary!.WAU}
          </span>
        )}
        {typeof summary?.MAU === "number" && (
          <span className="chip-muted" title="Perfiles activos últimos 30 días">
            MAU: {summary!.MAU}
          </span>
        )}
      </div>
    </section>
  );
}
