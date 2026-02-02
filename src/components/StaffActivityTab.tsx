"use client";

import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

type LogRow = {
  timestamp: string;   // "YYYY-MM-DD HH:mm"
  username: string;
  action: string;
  details?: string;
  record?: string;
};

// usuarios que NO deben aparecer ni contarse
const BLOCKED = new Set(["sergio_s", "selene_sr"]);

function fmt(d: string) {
  try { return new Date(d.replace(" ", "T")).toLocaleString(); }
  catch { return d; }
}
function ymd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
}
// acciones que cuentan como “Uso del REDCap”
function isUsoAction(a?: string) {
  const s = (a || "").trim().toLowerCase();
  return s === "Manage/Design".toLowerCase()
      || s === "data export (api)".toLowerCase();
}
// genera lista de días YYYY-MM-DD entre dos fechas (incluye extremos)
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  const d0 = new Date(from + "T00:00:00");
  const d1 = new Date(to   + "T00:00:00");
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0,10));
  }
  return out;
}

export default function StaffActivityTab() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // === filtros UI ===
  // Fecha de corte: solo mostrar datos desde el 18/12/2025
  const CUTOFF_DATE_STR = '2025-12-18';
  
  const [dayFrom, setDayFrom] = useState(() => {
    // Fecha predeterminada: 18/12/2025
    return CUTOFF_DATE_STR;
  });
  const [dayTo, setDayTo] = useState(() => ymd(new Date()));
  const [userOptions, setUserOptions] = useState<string[]>([]);
  const [username, setUsername] = useState(""); // vacío = todos

  // drilldown por día → gráfico por hora
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // ---- carga nombres (autocomplete) del rango actual ----
  async function bootstrapUsers() {
    try {
      const res = await fetch("/api/redcap_log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beginTime: `${dayFrom} 00:00`,
          endTime:   `${dayTo} 23:59`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `(${res.status}) Error desde API`);
      const all: LogRow[] = (data.items || []) as LogRow[];
      const names = Array.from(
        new Set(
          all
            .map(r => (r.username || "").trim())
            .filter(u => u && !BLOCKED.has(u))
        )
      ).sort((a,b)=>a.localeCompare(b));
      setUserOptions(names);
    } catch (e: any) {
      console.error("bootstrapUsers:", e?.message || e);
    }
  }

  // ---- consulta principal ----
  async function fetchLogs() {
    setLoading(true); setErr(null); setRows([]); setSelectedDay(null);
    try {
      const res = await fetch("/api/redcap_log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beginTime: `${dayFrom} 00:00`,
          endTime:   `${dayTo} 23:59`,
          username: (username && !BLOCKED.has(username)) ? username : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `(${res.status}) Error desde API`);
      const clean: LogRow[] = (data.items || [])
        .filter((r: LogRow) => !BLOCKED.has((r.username || "").trim()));
      setRows(clean);
    } catch (e: any) {
      setErr(e?.message || "Error consultando logs");
    } finally {
      setLoading(false);
    }
  }

  // primera carga
  useEffect(() => { bootstrapUsers(); fetchLogs(); /* eslint-disable-next-line */}, []);
  // ← auto-refetch cuando cambia persona o rango
  useEffect(() => { fetchLogs(); /* eslint-disable-next-line */}, [username, dayFrom, dayTo]);
  // repoblar barra de nombres al cambiar rango
  useEffect(() => { bootstrapUsers(); /* eslint-disable-next-line */}, [dayFrom, dayTo]);

  // ========== MÉTRICAS ==========
  const metrics = useMemo(() => {
    const total = rows.length;
    const lastTs = rows[0]?.timestamp ? rows
      .map(r => r.timestamp)
      .sort((a,b)=> new Date(b.replace(" ","T")).getTime() - new Date(a.replace(" ","T")).getTime())[0] : null;
    return { total, lastTs };
  }, [rows]);

  // ========== DATOS PARA GRÁFICAS ==========
  // Filtra a solo “Uso del REDCap”
  const usoRows = useMemo(
    () => rows.filter(r => isUsoAction(r.action)),
    [rows]
  );

  // Conteo por día (rellenado con 0)
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of usoRows) {
      const day = (r.timestamp || "").slice(0, 10); // YYYY-MM-DD
      if (!day) continue;
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    const allDays = daysBetween(dayFrom, dayTo);
    return allDays.map(day => ({ day, count: map.get(day) ?? 0 }));
  }, [usoRows, dayFrom, dayTo]);

  // Conteo por hora del día seleccionado
  const byHour = useMemo(() => {
    if (!selectedDay) return [];
    const map = new Map<number, number>();
    for (let h=0; h<24; h++) map.set(h, 0);
    for (const r of usoRows) {
      if (!r.timestamp?.startsWith(selectedDay)) continue;
      const hh = Number(r.timestamp.slice(11, 13));
      if (!Number.isNaN(hh)) map.set(hh, (map.get(hh) ?? 0) + 1);
    }
    return [...map.entries()].map(([hour, count]) => ({ hour, count }));
  }, [usoRows, selectedDay]);

  return (
    <div className="space-y-4">
      <Card title="Actividad del personal (REDCap logs)">
        {/* Filtros alineados */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Personal (barra de nombres) */}
          <div className="flex flex-col justify-start">
            <label className="text-xs text-neutral-400 mb-1">Personal</label>
            <input
              className="input w-56"
              list="staff-usernames"
              placeholder="Todos"
              value={username}
              onChange={(e)=>setUsername(e.target.value.trim())}
            />
            <datalist id="staff-usernames">
              {userOptions.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>

          {/* Desde / Hasta (date pickers) */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col justify-start">
              <label className="text-xs text-neutral-400 mb-1">Desde</label>
              <input
                type="date"
                className="input"
                value={dayFrom}
                onChange={(e)=>setDayFrom(e.target.value)}
                max={dayTo}
              />
            </div>
            <div className="flex flex-col justify-start">
              <label className="text-xs text-neutral-400 mb-1">Hasta</label>
              <input
                type="date"
                className="input"
                value={dayTo}
                onChange={(e)=>setDayTo(e.target.value)}
                min={dayFrom}
              />
            </div>
          </div>

          <button className="btn-primary h-10" onClick={fetchLogs} disabled={loading}>
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>

        {err && <div className="mt-3 text-sm text-red-400">⚠ {err}</div>}

        <div className="mt-3 text-sm text-neutral-300 flex flex-wrap gap-3">
          <span>Total eventos: <b>{metrics.total}</b></span>
          {metrics.lastTs && <span>Última actividad: <b>{fmt(metrics.lastTs)}</b></span>}
          {username && !BLOCKED.has(username) && <span>Usuario: <b>{username}</b></span>}
        </div>
      </Card>

      {/* Uso por día */}
      <Card title="Uso del REDCap por día (Export via API)">
        {usoRows.length === 0 ? (
          <div className="p-3 text-sm text-neutral-400">Sin datos en el rango seleccionado.</div>
        ) : (
          <div className="h-64 px-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byDay}
                margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar 
                  dataKey="count" 
                  barSize={22}
                  onClick={(data: any) => {
                    if (data && (data as any).day) {
                      setSelectedDay((data as any).day);
                    }
                  }}
                  cursor="pointer" // Esto cambia el cursor para indicar que es clickeable
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {selectedDay && (
          <div className="mt-2 text-xs text-neutral-400">
            Día seleccionado: <b>{selectedDay}</b>{" "}
            <button className="chip ml-2" onClick={()=>setSelectedDay(null)}>Limpiar</button>
          </div>
        )}
      </Card>

      {/* Uso por hora (si hay día seleccionado) */}
      {selectedDay && (
        <Card title={`Uso por hora — ${selectedDay}`}>
          <div className="h-64 px-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byHour}
                margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Tabla de eventos recientes */}
      <Card title="Eventos recientes">
        {rows.length === 0 ? (
          <div className="p-3 text-sm text-neutral-400">Sin datos.</div>
        ) : (
          <div className="max-h-[360px] overflow-auto border border-neutral-800 rounded">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left bg-neutral-900/50 sticky top-0">
                  <th className="px-3 py-2 border-b border-neutral-800">Fecha</th>
                  <th className="px-3 py-2 border-b border-neutral-800">Usuario</th>
                  <th className="px-3 py-2 border-b border-neutral-800">Acción</th>
                  <th className="px-3 py-2 border-b border-neutral-800">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.timestamp}|${r.username}|${i}`} className="border-t border-neutral-800">
                    <td className="px-3 py-2">{fmt(r.timestamp)}</td>
                    <td className="px-3 py-2">{r.username}</td>
                    <td className="px-3 py-2">{(r.action || "").trim()}</td>
                    <td className="px-3 py-2">{r.details || r.record || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
