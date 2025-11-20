"use client";
import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import Tabs from "@/components/Tabs";

// ===== Normalizador (acentos → ASCII) =====
function norm(s: any) {
  const t = String(s ?? "");
  try { return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
  catch { return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
}

// ===== Búsqueda avanzada (igual lógica) =====
const FIELD_MAP: Record<string, string[]> = {
  event: ["redcap_event_name"],
  pacode: ["ce_pacode", "code"],
  code: ["ce_pacode", "code"],
  sexo: ["ce_pasexo"],
  edad: ["ce_paedad"],
  dni: ["ci_pardni"],
  incode: ["st_incode", "fu_incode", "sh_incode", "cp_incode"],
};
function getField(row: any, key: string) {
  const candidates = FIELD_MAP[key.toLowerCase()] ?? [key];
  for (const c of candidates) {
    if (row[c] !== undefined) return row[c];
    const hit = Object.keys(row).find((rk) => rk.toLowerCase() === c.toLowerCase());
    if (hit) return row[hit];
  }
  return undefined;
}

function hasCode(row: any) {
  const v = String(getField(row, "pacode") ?? "").trim();
  return v.length > 0;
}

// 2) —— Mantener las reglas de ocultado, sustituyendo “seguimiento” por “soporte”
function shouldHideRow(tabId: string, row: any) {
  const ev = norm(getField(row, "event"));
  if (!ev) return false;

  // a) Uso/Hallazgos/Fallas técnicas: ocultar "cierre"
  if (["uso", "hallazgos", "soporte"].includes(tabId) && ev.includes("cierre")) {
    return true;
  }

  // b) Retiro del participante: ocultar "seguimiento"
  if (tabId === "retiro" && ev.includes("seguimiento")) {
    return true;
  }

  // c) Evento "inicio" sin código de participante → ocultar
  if (ev.includes("inicio") && !hasCode(row)) {
    return true;
  }

  return false;
}

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
    return norm(getField(row, k.trim())).includes(norm(val));
  }
  const qn = norm(token);
  if (!qn) return true;
  return Object.values(row ?? {}).some((v) => norm(v).includes(qn));
}
function matchesQuery(row: any, query: string) {
  const tokens = tokenize(query);
  return tokens.every((t) => matchesToken(row, t));
}
function getRecordId(row: any) {
  return row?.record_id ?? row?.recordid ?? row?.id ?? undefined;
}

function fillMissingCodesUsingRecordId(items: any[]) {
  const codeByRec = new Map<string, string>();

  // 1) Recolecta códigos por record_id
  for (const r of items) {
    const rid = String(getRecordId(r) ?? "").trim();
    const code = String(getField(r, "pacode") ?? "").trim(); // usa tu FIELD_MAP
    if (rid && code) codeByRec.set(rid, code);
  }

  // 2) Rellena faltantes
  return items.map((r) => {
    const hasCodeAlready = String(getField(r, "pacode") ?? "").trim().length > 0;
    if (hasCodeAlready) return r;

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

// ===== Config por reporte =====
type ReportCfg = {
  id: string;
  label: string;
  reportId: string;
  headerOrder: string[];
  headerLabels: Record<string,string>;
};

const REPORTS: ReportCfg[] = [
  // 1220 — Uso sostenido
  {
    id: "uso",
    label: "Uso sostenido",
    reportId: "1220",
    headerOrder: [
      "redcap_event_name","redcap_repeat_instrument","redcap_repeat_instance",
      "ce_pacode","fu_incode","fu_indate","fu_semana","fu_fonume",
      "fu_rabajo","fu_rabajo_otr","fu_posolu","ficha_de_seguimiento_de_uso_sostenido_complete"
    ],
    headerLabels: {
      redcap_event_name: "Evento",
      redcap_repeat_instrument: "Instrumento",
      redcap_repeat_instance: "Instancia",
      ce_pacode: "Código",
      fu_incode: "Código interno",
      fu_indate: "Fecha",
      fu_semana: "Semana",
      fu_fonume: "N° fotos",
      fu_rabajo: "Trabajo",
      fu_rabajo_otr: "Trabajo (otro)",
      fu_posolu: "Posible solución",
      ficha_de_seguimiento_de_uso_sostenido_complete: "Completo",
    },
  },
  // 1221 — Hallazgos clínicos
  {
    id: "hallazgos",
    label: "Hallazgos clínicos",
    reportId: "1221",
    headerOrder: [
      "redcap_event_name","redcap_repeat_instrument","redcap_repeat_instance",
      "ce_pacode","sh_incode","sh_indate","sh_tihall","sh_tihall_otr","sh_sedate",
      "sh_acsuge","registro_de_hallazgos_clnicos_complete"
    ],
    headerLabels: {
      redcap_event_name: "Evento",
      redcap_repeat_instrument: "Instrumento",
      redcap_repeat_instance: "Instancia",
      ce_pacode: "Código",
      sh_incode: "Código interno",
      sh_indate: "Fecha",
      sh_tihall: "Tipo de hallazgo",
      sh_tihall_otr: "Hallazgo (otro)",
      sh_sedate: "Fecha seguimiento",
      sh_acsuge: "Acciones sugeridas",
      registro_de_hallazgos_clnicos_complete: "Completo",
    },
  },
  // 1222 — Retiro del participante
  {
    id: "retiro",
    label: "Retiro del participante",
    reportId: "1222",
    headerOrder: [
      "redcap_event_name","redcap_repeat_instrument","redcap_repeat_instance",
      "ce_pacode","cp_incode","cp_indate","cp_moreti","cp_pareti","cp_observ",
      "formato_de_retiro_de_participante_complete"
    ],
    headerLabels: {
      redcap_event_name: "Evento",
      redcap_repeat_instrument: "Instrumento",
      redcap_repeat_instance: "Instancia",
      ce_pacode: "Código",
      cp_incode: "Código interno",
      cp_indate: "Fecha",
      cp_moreti: "Motivo de retiro",
      cp_pareti: "¿Participante retira?",
      cp_observ: "Observaciones",
      formato_de_retiro_de_participante_complete: "Completo",
    },
  },
  // 1245 — Seguimiento
  {
  id: "soporte",
  label: "Fallas técnicas",
  reportId: "1245",
  headerOrder: [
    "redcap_event_name",
    "redcap_repeat_instrument",
    "redcap_repeat_instance",
    "st_incode",
    "st_indate",
    "st_qusoli",
    "st_qusoli_otr",
    "st_mecont",
    "st_mecont_otr",
    "st_seapoy",
    "st_seapoy_otr",
    "st_deprob",
    "st_acsuge",
    "st_sesolu",
    "st_observ",
    "solicitudes_de_soporte_tcnico_complete"
  ],
  headerLabels: {
    redcap_event_name: "Evento",
    redcap_repeat_instrument: "Instrumento",
    redcap_repeat_instance: "Instancia",
    st_incode: "Código interno",
    st_indate: "Fecha",
    st_qusoli: "¿Quién solicita?",
    st_qusoli_otr: "¿Quién (otro)?",
    st_mecont: "Medio de contacto",
    st_mecont_otr: "Medio (otro)",
    st_seapoy: "¿Se apoyó?",
    st_seapoy_otr: "Apoyo (otro)",
    st_deprob: "Descripción del problema",
    st_acsuge: "Acciones sugeridas",
    st_sesolu: "¿Se solucionó?",
    st_observ: "Observaciones",
    solicitudes_de_soporte_tcnico_complete: "Completo",
  },
},
];

type Props = {
  /** "global": código editable (opcional); "profile": código bloqueado y obligatorio */
  mode: "global" | "profile";
  /** Código del perfil (ce_pacode) cuando mode="profile" */
  profileCode?: string;
  /** Opcional: código inicial cuando entras en global */
  defaultCode?: string;
};

export default function RedcapReportTabs({ mode, profileCode, defaultCode }: Props) {
  const [tab, setTab] = useState(REPORTS[0].id);
  const [code, setCode] = useState(defaultCode ?? "");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const cfg = REPORTS.find(r => r.id === tab)!;

  // Sincroniza el input "code" con el modo/perfil:
  useEffect(() => {
    if (mode === "profile") setCode(profileCode ?? "");
    // en global, mantenemos el code que el usuario haya escrito
  }, [mode, profileCode]);

  async function fetchReport() {
    setLoading(true); setError(null); setRows([]);
    try {
      const body: any = {
        reportId: cfg.reportId,
        csvDelimiter: "",
        rawOrLabel: "raw",
        rawOrLabelHeaders: "raw",
        exportCheckboxLabel: "false",
      };

      if (mode === "profile") {
        if (!profileCode) throw new Error("No hay código de perfil (ce_pacode) en modo perfil.");
        body.pacode = profileCode;  // bloqueado por perfil
      } else {
        // GLOBAL: usa el input 'code' si está escrito; si no, usa profileCode (de la URL)
        const effective = (code?.trim() || profileCode?.trim() || "").trim();
        if (effective) body.pacode = effective; // "" = Todos (sin pacode)
      }

      const res = await fetch("/api/redcap_report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: any; try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new Error(data?.error || `(${res.status}) Error desde API`);
      const items = Array.isArray(data?.items) ? data.items : [];
      const completed = fillMissingCodesUsingRecordId(items);
      setRows(completed);
    } catch (e:any) {
      setError(e?.message || "Error desconocido consultando REDCap.");
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch al cambiar sub-pestaña, modo o perfil
  useEffect(() => { fetchReport(); /* eslint-disable-next-line */ }, [tab, mode, profileCode]);

  // Columnas presentes, restringidas y en orden
  const headers = useMemo(() => {
    const present = new Set<string>();
    rows.forEach(r => Object.keys(r || {}).forEach(k => present.add(k)));
    return cfg.headerOrder.filter(k => present.has(k));
  }, [rows, cfg]);

  // Búsqueda libre cliente (siempre activa)
const filtered = useMemo(() => {
  // 1) Reglas visuales por evento (incluye "inicio" sin código)
  const eventFiltered = rows.filter(r => !shouldHideRow(cfg.id, r));

  // 2) Búsqueda libre
  if (!q) return eventFiltered;
  return eventFiltered.filter(r => matchesQuery(r, q));
}, [rows, q, cfg.id]);

  const codeDisabled = mode === "profile";

  return (
    <Card title="REDCap · Reportes">
      <div className="mb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={REPORTS.map(r => ({ id: r.id, label: r.label }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={codeDisabled ? "Código del perfil (bloqueado)" : "Filtrar por código (ce_pacode), ej: H2M-10-18"}
          disabled={codeDisabled}
          className={`px-3 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-sm w-64 ${codeDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
        />
        <button
          onClick={fetchReport}
          disabled={loading || codeDisabled}
          className="px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-900 text-sm"
          title={codeDisabled ? "En modo perfil se usa el código del perfil automáticamente" : "Buscar por código"}
        >
          {loading ? "Cargando..." : codeDisabled ? "Bloqueado por perfil" : "Buscar"}
        </button>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Búsqueda libre (ej: event:inicio fu_semana>=4)'
          className="px-3 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-sm flex-1 min-w-[240px]"
        />

        <div className="text-xs opacity-70">
          Modo: <code className="font-mono">{mode}</code>
          {mode === "profile" && <> · Código: <code className="font-mono">{profileCode || "—"}</code></>}
        </div>
      </div>

      {error && <div className="text-sm text-red-400 mb-2">⚠ {error}</div>}
      {!loading && filtered.length === 0 && <div className="text-sm text-neutral-400">Sin datos.</div>}
      {loading && <div className="text-sm text-neutral-300">Consultando REDCap…</div>}

      {!loading && filtered.length > 0 && (
        <div className="max-h-[420px] overflow-auto border border-neutral-800 rounded">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left bg-neutral-900/50 sticky top-0">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 border-b border-neutral-800">
                    {cfg.headerLabels[h] ?? h}
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
                    i,
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
