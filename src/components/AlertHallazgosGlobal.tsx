"use client";
import React, { useEffect, useMemo, useState } from "react";
import Collapse from "@/components/Collapse";
// Helpers locales (idénticas a Tabs, mínimas necesarias)
function norm(s: any) {
  const t = String(s ?? "");
  try { return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
  catch { return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
}

function getRecordId(row: any) {
  return row?.record_id ?? row?.recordid ?? row?.id ?? undefined;
}

function fillMissingCodesUsingRecordId(items: any[]) {
  const codeByRec = new Map<string, string>();
  for (const r of items) {
    const rid = String(getRecordId(r) ?? "").trim();
    const code = String(r?.ce_pacode ?? r?.code ?? "").trim();
    if (rid && code) codeByRec.set(rid, code);
  }
  return items.map((r) => {
    const has = String(r?.ce_pacode ?? r?.code ?? "").trim().length > 0;
    if (has) return r;
    const rid = String(getRecordId(r) ?? "").trim();
    const inferred = rid ? codeByRec.get(rid) : undefined;
    if (!inferred) return r;
    return { ...r, ce_pacode: inferred };
  });
}

export default function AlertHallazgosGlobal({
  className = "",
  title = "Alerta hallazgos clínicos",
  limit = 80,
}: { className?: string; title?: string; limit?: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        // GLOBAL: sin pacode — usa tu reportId de Hallazgos clínicos
        const res = await fetch("/api/redcap_report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId: "1221" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `(${res.status}) Error REDCap`);
        if (!alive) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        const completed = fillMissingCodesUsingRecordId(items);
        setRows(completed);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Error");
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const pairs = useMemo(() => {
    const out: Array<{ tipo: string; code: string }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      // Si quisieras excluir evento "cierre" aquí también, puedes:
      // if (norm(r?.redcap_event_name).includes("cierre")) continue;

      const tipo = String(r?.sh_tihall ?? "").trim();                 // Tipo de hallazgo
      const code = String(r?.ce_pacode ?? r?.code ?? "").trim();      // Código (ya rellenado)
      if (!tipo || !code) continue;

      const key = `${norm(tipo)}|${norm(code)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tipo, code });
    }
    return out.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.code.localeCompare(b.code));
  }, [rows]);

  return (
  <Collapse
    id="alert-hallazgos"
    title="Alerta hallazgos clínicos"
    className="border-yellow-800 bg-yellow-950/30"
    defaultOpen={false}  // pon true si quieres que arranque abierto
  >
    {loading ? (
      <div className="text-xs opacity-70 mt-1">Cargando…</div>
    ) : err ? (
      <div className="text-xs text-red-400 mt-1">Error: {err}</div>
    ) : pairs.length === 0 ? (
      <div className="text-xs opacity-70 mt-1">Sin datos</div>
    ) : (
      <ul className="text-sm mt-1 max-h-44 overflow-auto pr-2">
        {pairs.slice(0, limit).map((x, i) => (
          <li key={`${x.tipo}-${x.code}-${i}`} className="leading-tight">
            <span className="font-medium">{x.tipo}</span>{" — "}
            <code className="font-mono">{x.code}</code>
          </li>
        ))}
      </ul>
    )}
    <p className="text-[11px] opacity-60 mt-2">
      Fuente: REDCap { /* puedes añadir (global) o excluir “cierre” si lo aplicas */ }
    </p>
  </Collapse>
);
}
