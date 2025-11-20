/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type RedcapOption = { label: string; value: string };

function norm(s: any) {
  return String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
const isInicio = (ev: any) => norm(ev).startsWith("inicio");
const isEmpty  = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return !s || s === "na" || s === "n/a" || s === "-" || s === "sin dato";
};

export function useFallasTamizaje(
  redcapCode: string | undefined,
  redcapOptions: RedcapOption[] | undefined,
  enabled = true
) {
  const [fallas, setFallas] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // resuelve lista de códigos: si viene uno → [uno], si no → todos los options
  const codes = useMemo(() => {
    if (redcapCode) return [redcapCode];
    if (!redcapOptions || redcapOptions.length === 0) return [];
    return redcapOptions.map(o => o.value).filter(Boolean);
  }, [redcapCode, redcapOptions]);

  useEffect(() => {
    if (!enabled) return;
    if (!redcapCode && (!redcapOptions || redcapOptions.length === 0)) return; // aún no cargan

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      setLoading(true); setError(null);
      try {
        if (codes.length === 0) {
          setFallas(0);
          return;
        }

        const requests = codes.map(code =>
          fetch("/api/redcap_report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportId: "1219", pacode: code }),
            signal: ac.signal,
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `(${res.status}) REDCap`);
            return Array.isArray(data?.items) ? data.items : [];
          })
        );

        const all = await Promise.all(requests);

        let total = 0;
        for (const items of all) {
          for (const row of items) {
            if (!isInicio(row?.redcap_event_name)) continue;
            const sexo = row?.ce_pasexo;
            const dni  = row?.ci_pardni;
            if (isEmpty(sexo) && isEmpty(dni)) total++;
          }
        }
        setFallas(total);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Error calculando fallas");
        setFallas(0);
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, redcapCode, JSON.stringify(redcapOptions)]); // cambia cuando llegan los options

  return { fallas, loading, error };
}
