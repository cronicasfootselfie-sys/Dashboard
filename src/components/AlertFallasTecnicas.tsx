"use client";
import React, { useEffect, useMemo, useState } from "react";
import Collapse from "@/components/Collapse";
// ——— utils ———
function norm(s: any) {
  const t = String(s ?? "");
  try { return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
  catch { return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
}
function getRecordId(row: any) {
  return row?.record_id ?? row?.recordid ?? row?.id ?? undefined;
}
// leer "sí" robusto
function isYes(v: any) {
  if (v === true) return true;
  const s = norm(v);
  return s === "0" || s === "no" || s === "No" || s === "not" || s === "false";
}
// detectar columna "¿Se solucionó?" con nombres flexibles
function getSolvedValue(row: any) {
  const candidates = ["st_sesolu", "se_soluciono", "se_solucionó", "solucionado", "resuelto", "st_resuelto"];
  for (const k of candidates) {
    const hit = Object.keys(row ?? {}).find((rk) => norm(rk) === norm(k));
    if (hit) return row[hit];
  }
  const key = Object.keys(row ?? {}).find((rk) => {
    const n = norm(rk);
    return n.includes("solucion") || n.includes("soluciono") || n.includes("resuelto") || n.includes("resolvio");
  });
  return key ? row[key] : undefined;
}

// fetch de un reporte REDCap (GLOBAL: sin pacode)
async function fetchReportGlobal(reportId: string) {
  const res = await fetch("/api/redcap_report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `(${res.status}) Error REDCap (${reportId})`);
  return Array.isArray(data?.items) ? data.items : [];
}

// construye mapa record_id → ce_pacode usando items de uno o más reportes
function buildCodeMapFromItems(itemsLists: any[][]) {
  const codeByRec = new Map<string, string>();
  for (const items of itemsLists) {
    for (const r of items) {
      const rid = String(getRecordId(r) ?? "").trim();
      const code = String(r?.ce_pacode ?? r?.code ?? "").trim();
      if (rid && code && !codeByRec.has(rid)) {
        codeByRec.set(rid, code);
      }
    }
  }
  return codeByRec;
}

// aplica el mapa a las filas que no traen ce_pacode/code
function applyCodeMapToItems(items: any[], codeByRec: Map<string, string>) {
  return items.map((r) => {
    const has = String(r?.ce_pacode ?? r?.code ?? "").trim().length > 0;
    if (has) return r;
    const rid = String(getRecordId(r) ?? "").trim();
    const inferred = rid ? codeByRec.get(rid) : undefined;
    if (!inferred) return r;
    const copy = { ...r };
    if ("ce_pacode" in copy) copy.ce_pacode = inferred;
    else if ("code" in copy) copy.code = inferred;
    else copy.ce_pacode = inferred;
    return copy;
  });
}

export default function AlertFallasTecnicas({
  className = "",
  title = "Alerta fallas técnicas",
  limit = 80,
  // ⬇️ reportId del reporte de FALLAS TÉCNICAS (ajústalo)
  reportId,
  // ⬇️ reportes de apoyo donde SÍ existe ce_pacode para el mismo record_id
  supportReportIds = ["1221", "1220", "1222", "1245"], // Hallazgos, Uso, Retiro, Seguimiento
  excludeCierre = false, // si quieres alinear con tus tablas
}: {
  className?: string;
  title?: string;
  limit?: number;
  reportId: string;             // <- requerido
  supportReportIds?: string[];
  excludeCierre?: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err,   setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      try {
        // 1) Trae el reporte de Fallas (GLOBAL)
        const mainItems = await fetchReportGlobal(reportId);

        // 2) Intenta construir el mapa con el propio reporte
        const codeMap = buildCodeMapFromItems([mainItems]);

        // 3) Si faltan códigos, recurre a reportes de apoyo secuencialmente
        const needsCodes = mainItems.some((r: any) => !(String(r?.ce_pacode ?? r?.code ?? "").trim()));
        if (needsCodes) {
          for (const rid of supportReportIds) {
            try {
              const supportItems = await fetchReportGlobal(rid);
              const addMap = buildCodeMapFromItems([supportItems]);
              // merge sin pisar claves ya existentes
              for (const [k, v] of addMap.entries()) {
                if (!codeMap.has(k)) codeMap.set(k, v);
              }
              // break temprano si ya resolvimos todos
              const solvedAll = mainItems.every((r: any) => {
                const has = String(r?.ce_pacode ?? r?.code ?? "").trim().length > 0;
                if (has) return true;
                const rec = String(getRecordId(r) ?? "").trim();
                return rec && codeMap.has(rec);
              });
              if (solvedAll) break;
            } catch (e) {
              // ignoramos fallos de un soporte y seguimos con el siguiente
              // console.warn("Support report failed", rid, e);
            }
          }
        }

        // 4) Aplica el mapa a las filas de Fallas
        const completed = applyCodeMapToItems(mainItems, codeMap);
        if (!alive) return;
        setRows(completed);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Error");
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reportId, JSON.stringify(supportReportIds)]);

  // Construye lista: “¿Se solucionó? — Sí — ce_pacode”
  const pairs = useMemo(() => {
    const out: Array<{ label: string; code: string }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (excludeCierre && norm(r?.redcap_event_name).includes("cierre")) continue;

      // Solo si “¿Se solucionó?” = Sí
      const solved = getSolvedValue(r);
      if (!isYes(solved)) continue;

      const label = "No";
      const code  = String(r?.ce_pacode ?? r?.code ?? "").trim(); // <- ya es el REDCap code
      if (!code) continue;

      const key = `${label}|${norm(code)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label, code });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
  }, [rows, excludeCierre]);

  return (
  <Collapse
    id="alert-fallas"
    title="Alerta fallas técnicas"
    className="border-red-800 bg-red-950/30"
    defaultOpen={false}
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
          <li key={`${x.label}-${x.code}-${i}`} className="leading-tight">
            <span className="font-medium">¿Se solucionó?</span>{" — "}
            <span>{x.label}</span>{" — "}
            <code className="font-mono">{x.code}</code>
          </li>
        ))}
      </ul>
    )}
    <p className="text-[11px] opacity-60 mt-2">
      Fuente: REDCap · Filtrado por “¿Se solucionó?” = No.
    </p>
  </Collapse>
);
}
