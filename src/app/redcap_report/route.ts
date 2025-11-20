export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Usa POST para consultar REDCap" });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      reportId = "1219",
      // filtros de servidor
      recordId, label, eventName, pacode, code,
      // OVERRIDES para formato (por defecto eran "label", pero estos reportes piden "raw")
      csvDelimiter,
      rawOrLabel,
      rawOrLabelHeaders,
      exportCheckboxLabel,
    } = body || {};

    const token = process.env.REDCAP_TOKEN;
    const url   = process.env.REDCAP_URL || "https://redcap.upch.edu.pe/api/";
    if (!token) return NextResponse.json({ error: "Falta REDCAP_TOKEN" }, { status: 500 });

    const form = new URLSearchParams({
      token,
      content: "report",
      format: "json",
      report_id: String(reportId),
      csvDelimiter: csvDelimiter ?? "",             // ← override
      rawOrLabel: rawOrLabel ?? "label",            // ← override
      rawOrLabelHeaders: rawOrLabelHeaders ?? "label",
      exportCheckboxLabel: exportCheckboxLabel ?? "false",
      returnFormat: "json",
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return NextResponse.json({ error: "HTTP no OK desde REDCap", status: resp.status, body: txt }, { status: 502 });
    }

    const data = await resp.json().catch(() => []);
    const rows: any[] = Array.isArray(data) ? data : [];

    const wantCode = pacode ?? code; // alias
    const filtered = rows.filter((row) => {
      if (wantCode) {
        const rc = norm(row.ce_pacode ?? row.code ?? "");
        if (rc !== norm(wantCode)) return false;    // ← filtro por ce_pacode
      }
      if (recordId != null) {
        const rid = String(row.record_id ?? row.recordid ?? row.id ?? "");
        if (rid !== String(recordId)) return false;
      }
      if (label) {
        const q = norm(label);
        const hit = Object.values(row).some((v) => norm(v).includes(q));
        if (!hit) return false;
      }
      if (eventName) {
        const ev = norm(row.redcap_event_name ?? "");
        if (ev !== norm(eventName)) return false;
      }
      return true;
    });

    return NextResponse.json({
      reportId: String(reportId),
      total: rows.length,
      count: filtered.length,
      items: filtered,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error desconocido" }, { status: 500 });
  }
}
