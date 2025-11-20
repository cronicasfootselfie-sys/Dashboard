export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ------------ helpers ------------
async function fetchReportFromRedcap(reportId: string, token: string, url: string) {
  console.log(`🔍 Fetching REDCap report ${reportId} from ${url}`);
  
  const form = new URLSearchParams({
    token,
    content: "report",
    format: "json",
    report_id: String(reportId),
    csvDelimiter: ",",
    rawOrLabel: "label",
    rawOrLabelHeaders: "label",
    exportCheckboxLabel: "true",
    returnFormat: "json",
  });

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });

    console.log(`📊 REDCap response status: ${resp.status} for report ${reportId}`);

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`❌ REDCap error: HTTP ${resp.status}`, body);
      throw new Error(`HTTP ${resp.status} REDCap report ${reportId}: ${body}`);
    }

    const data = await resp.json().catch(() => []);
    console.log(`✅ REDCap report ${reportId} fetched successfully, items: ${Array.isArray(data) ? data.length : 'invalid'}`);
    
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`❌ Error fetching REDCap report ${reportId}:`, error);
    throw error;
  }
}

// Campos potenciales donde los reportes pueden traer el código
const CODE_FIELDS = ["ce_pacode", "code", "fu_incode", "pa_code", "pacode"];

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Usa POST para consultar REDCap" });
}

export async function POST(req: Request) {
  console.log("📨 Received REDCap API request");
  
  let body;
  try {
    body = await req.json();
    console.log("📦 Request body:", body);
  } catch (e) {
    console.error("❌ Error parsing request body:", e);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { reportId = "1219", recordId, label, eventName, pacode, code } = body;
    console.log(`🔧 Processing report ${reportId} with pacode: ${pacode || code}`);
    
    const token = process.env.REDCAP_TOKEN;
    const url = process.env.REDCAP_URL || "https://redcap.upch.edu.pe/api/";
    
    console.log("🔑 REDCap environment check:", { 
      hasToken: !!token,
      tokenLength: token?.length,
      url 
    });

    if (!token) {
      console.error("❌ Missing REDCAP_TOKEN environment variable");
      return NextResponse.json({ error: "Falta REDCAP_TOKEN" }, { status: 500 });
    }

    const MASTER_REPORT_ID = "1219";

    // 1) Traemos el reporte solicitado
    console.log(`📋 Fetching primary report ${reportId}`);
    const rows = await fetchReportFromRedcap(String(reportId), token, url);

    const wantCode = pacode ?? code;
    const wantCodeNorm = norm(wantCode ?? "");
    console.log(`🔍 Looking for code: "${wantCode}" (normalized: "${wantCodeNorm}")`);

    let allowedIds: Set<string> | null = null;

    if (wantCode) {
      // 2) PRIMER INTENTO: resolver IDs dentro del MISMO reporte
      console.log(`🔎 First attempt: searching for code within report ${reportId}`);
      const insideIds = new Set<string>();
      for (const r of rows) {
        const hasMatch = CODE_FIELDS.some((f) => norm(r?.[f] ?? "") === wantCodeNorm);
        if (hasMatch) {
          const rid = String(r.record_id ?? r.recordid ?? r.id ?? "").trim();
          if (rid) {
            insideIds.add(rid);
            console.log(`✅ Found matching record ${rid} in current report`);
          }
        }
      }

      if (insideIds.size > 0) {
        allowedIds = insideIds;
        console.log(`🎯 Using ${insideIds.size} records found in current report`);
      } else {
        // 3) SEGUNDO INTENTO: buscar IDs en el REPORTE MAESTRO 1219
        console.log(`🔎 Second attempt: searching in master report ${MASTER_REPORT_ID}`);
        const master = await fetchReportFromRedcap(MASTER_REPORT_ID, token, url);
        const temp = new Set<string>();
        
        for (const r of master) {
          const codeVal = String(r.ce_pacode ?? r.code ?? "").trim();
          if (!codeVal) continue;
          if (norm(codeVal) !== wantCodeNorm) continue;
          const rid = String(r.record_id ?? r.recordid ?? r.id ?? "").trim();
          if (rid) {
            temp.add(rid);
            console.log(`✅ Found matching record ${rid} in master report with code: ${codeVal}`);
          }
        }
        
        if (temp.size > 0) {
          allowedIds = temp;
          console.log(`🎯 Using ${temp.size} records found in master report`);
        } else {
          console.log(`❌ No records found for code "${wantCode}" in any report`);
          return NextResponse.json({
            reportId: String(reportId),
            total: rows.length,
            count: 0,
            items: [],
            fetchedAt: new Date().toISOString(),
            debug: { searchedCode: wantCode, masterReportUsed: MASTER_REPORT_ID }
          });
        }
      }
    }

    // 4) Filtro final
    console.log(`🔧 Applying final filters...`);
    const filtered = rows.filter((row) => {
      if (allowedIds) {
        const rid = String(row.record_id ?? row.recordid ?? row.id ?? "").trim();
        if (!allowedIds.has(rid)) return false;
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

    console.log(`✅ Final result: ${filtered.length} items out of ${rows.length} total`);
    
    return NextResponse.json({
      reportId: String(reportId),
      total: rows.length,
      count: filtered.length,
      items: filtered,
      fetchedAt: new Date().toISOString(),
      debug: {
        searchedCode: wantCode,
        allowedRecordsCount: allowedIds?.size || 0,
        filtersApplied: { recordId, label, eventName }
      }
    });
  } catch (e: any) {
    console.error("💥 Unhandled error in REDCap API:", e);
    return NextResponse.json({ 
      error: "Error interno del servidor",
      details: process.env.NODE_ENV === 'development' ? e.message : undefined
    }, { status: 500 });
  }
}