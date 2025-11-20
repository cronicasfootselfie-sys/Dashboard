"use client";
import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";

// ===== Normalización segura (sin acentos) =====
function norm(s: any) {
  const t = String(s ?? "");
  try {
    return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  } catch {
    return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
}

// ===== Diccionario de encabezados (mostrar) =====
const HEADER_LABELS: Record<string, string> = {
  redcap_event_name: "Evento",
  redcap_repeat_instrument: "Instrumento",
  redcap_repeat_instance: "Instancia",
  ce_pacode: "Código",
  ce_pasexo: "Sexo",
  ce_paedad: "Edad",
  ci_pardni: "DNI",
};

// Orden fijo de columnas a mostrar
const HEADER_ORDER = [
  "redcap_event_name",
  "redcap_repeat_instrument",
  "redcap_repeat_instance",
  "ce_pacode",
  "ce_pasexo",
  "ce_paedad",
  "ci_pardni",
];

// ===== Búsqueda (tokens y alias) =====
const FIELD_MAP: Record<string, string[]> = {
  event: ["redcap_event_name"],
  pacode: ["ce_pacode", "code"],
  code: ["ce_pacode", "code"],
  sexo: ["ce_pasexo"],
  edad: ["ce_paedad"],
  dni: ["ci_pardni"],
};

function getField(row: any, key: string) {
  const k = key.toLowerCase();
  const candidates = FIELD_MAP[k] ?? [key];
  for (const c of candidates) {
    if (row[c] !== undefined) return row[c];
    const hit = Object.keys(row).find((rk) => rk.toLowerCase() === c.toLowerCase());
    if (hit) return row[hit];
  }
  return undefined;
}
const isInicio = (ev: any) => {
  const s = String(ev ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return s.startsWith("inicio"); // cubre 'inicio_arm_1', 'inicio', etc.
};

const isEmpty = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  // trata como vacío: "", "na", "n/a", "sin dato", "-"
  return !s || s === "na" || s === "n/a" || s === "-" || s === "sin dato";
};
function tokenize(q: string) {
  const m = q.match(/"[^"]+"|\S+/g) ?? [];
  return m.map((t) => t.replace(/^"|"$/g, ""));
}

function cmpNumeric(row: any, key: string, op: string, valRaw: string) {
  const v = Number(getField(row, key));
  const want = Number(String(valRaw).replace(",", "."));
  if (Number.isNaN(v) || Number.isNaN(want)) return false;
  switch (op) {
    case ">":  return v > want;
    case ">=": return v >= want;
    case "<":  return v < want;
    case "<=": return v <= want;
    case "=":
    case "==": return v === want;
    default:   return false;
  }
}

function matchesToken(row: any, token: string) {
  const mNum = token.match(/^([^:<>=]+)\s*(>=|<=|>|<|==|=)\s*(.+)$/);
  if (mNum) {
    const [, k, op, val] = mNum;
    return cmpNumeric(row, k.trim(), op, String(val).trim());
  }
  const mKV = token.match(/^([^:]+)\s*:\s*(.+)$/);
  if (mKV) {
    const [, k, val] = mKV;
    const fieldVal = getField(row, k.trim());
    return norm(fieldVal).includes(norm(val));
  }
  const qn = norm(token);
  if (!qn) return true;
  return Object.values(row ?? {}).some((v) => norm(v).includes(qn));
}

function matchesQuery(row: any, query: string) {
  const tokens = tokenize(query);
  return tokens.every((t) => matchesToken(row, t));
}

// ======= Componente =======
export default function RedcapReportCard({
    mode,
  profileId,
  profileCode,              // <- ya lo agregaste
          // <- NUEVO: lista de ce_pacode válidos (por redcap o "Todos")
}: {
  mode: "global" | "profile";
  profileId?: string;
  profileCode?: string;
     // <- NUEVO
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

 const fetchReport = async () => {
  setLoading(true); setError(null); setRows([]);
  try {
    const body: any = { reportId: "1219" };

    // Elegimos el código efectivo a enviar como pacode
    // - En perfil: usa profileCode si viene; si no, profileId como fallback
    // - En global: usa profileCode si viene ("" = Todos -> no enviamos pacode)
    const effectiveCode =
      mode === "profile"
        ? (profileCode?.trim() || profileId || "").trim()
        : (profileCode?.trim() || "").trim();

    if (effectiveCode) {
      body.pacode = effectiveCode;   // <- FILTRO REAL POR ce_pacode EN BACKEND
    }

    const res = await fetch("/api/redcap_report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: any;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error(data?.error || `(${res.status}) Error desde API`);

    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    setRows(items);
  } catch (e: any) {
    setError(e?.message || "Error desconocido consultando REDCap.");
  } finally {
    setLoading(false);
  }
};


  // 🔁 Refetch al cambiar modo / profileId / profileCode
  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, profileId, profileCode]);

  // Solo mostrar columnas del diccionario (y en este orden)
const baseRows = useMemo(() => {
  return rows.filter((r) => {
    if (!isInicio(r?.redcap_event_name)) return false;       // solo inicio
    const sexo = r?.ce_pasexo;
    const dni  = r?.ci_pardni;
    if (isEmpty(sexo) && isEmpty(dni)) return false;         // limpia filas vacías
    return true;
  });
}, [rows]);

// 2) Headers: según lo que realmente hay en baseRows
const headers = useMemo(() => {
  const present = new Set<string>();
  baseRows.forEach((r) => Object.keys(r || {}).forEach((k) => present.add(k)));
  return HEADER_ORDER.filter((k) => present.has(k));
}, [baseRows]);

// 3) Búsqueda local sobre lo ya filtrado
const filtered = useMemo(() => {
  if (!q) return baseRows;
  return baseRows.filter((r) => matchesQuery(r, q));
}, [baseRows, q]);

  return (
    <Card title="REDCap · Datos generales (Reporte 1219)">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={fetchReport}
          disabled={loading}
          className="px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-900 text-sm"
        >
          {loading ? "Cargando..." : "Recargar"}
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Buscar (p. ej., code:H2M-10-18 sexo:Femenino edad>=60)…'
          className="px-3 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-sm w-96"
        />
        <div className="text-xs opacity-70">
          {mode === "global" ? (
            <>
              Modo: <code className="font-mono">global</code>{" "}
              {profileCode ? (
                <>· REDCap: <code className="font-mono">{profileCode}</code></>
              ) : (
                <>· REDCap: <code className="font-mono">Todos</code></>
              )}
            </>
          ) : (
            <>Código: <code className="font-mono">{profileId || "—"}</code></>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-400 mb-2">⚠ {error}</div>}
      {!loading && filtered.length === 0 && <div className="text-sm text-neutral-400">Sin datos.</div>}
      {loading && <div className="text-sm text-neutral-300">Consultando REDCap…</div>}

      {!loading && filtered.length > 0 && (
        <div className="max-h-[360px] overflow-auto border border-neutral-800 rounded">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-neutral-900/50 sticky top-0">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 border-b border-neutral-800">
                    {HEADER_LABELS[h] ?? h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const key = [
                  row.record_id ?? row.recordid ?? row.id ?? "r",
                  row.ce_pacode ?? row.code ?? "code",
                  row.redcap_event_name ?? "ev",
                  row.redcap_repeat_instance ?? "inst",
                  i, // <-- último fallback para garantizar unicidad
                ].join("|");
                return (
                  <tr key={key} className="border-t border-neutral-800">
                    {headers.map((h) => (
                      <td key={h} className="px-3 py-2 align-top">{String(row?.[h] ?? "")}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
