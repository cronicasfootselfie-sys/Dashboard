export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { beginTime, endTime, username } = await req.json();
    const token = process.env.REDCAP_TOKEN;
    const url   = process.env.REDCAP_URL || "https://redcap.upch.edu.pe/api/";
    if (!token) return NextResponse.json({ error: "Falta REDCAP_TOKEN" }, { status: 500 });

    const form = new URLSearchParams({
      token,
      content: "log",
      format: "json",
      returnFormat: "json",
      // campos opcionales:
      ...(username ? { user: username } : {}),
      ...(beginTime ? { beginTime } : {}),
      ...(endTime ? { endTime } : {}),
      // logtype vacío = todo (puedes especificar data_export, record, etc.)
      logtype: "",
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
    return NextResponse.json({ count: rows.length, items: rows, fetchedAt: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error desconocido" }, { status: 500 });
  }
}
