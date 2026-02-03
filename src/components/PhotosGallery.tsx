"use client";

import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import Image from "next/image";
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { getSingleProfileIdByRedcap } from "@/lib/redcapFirestore";

// Fecha de corte: solo mostrar datos desde el 18/12/2025
const CUTOFF_DATE = new Date('2025-12-18T00:00:00.000Z');

type Lesion = {
  classId?: number;
  className?: string;
  confidence?: number;
  lesionId?: string;
  // puedes añadir más campos si los usas (Polygon, etc.)
};

type PhotoRow = {
  id: string;
  date?: any;               // Firestore Timestamp o string
  imageUrl?: string;
  profileId: string;
  resultDetails?: Lesion[];
  summary?: string;
};

function fmtDate(d: any) {
  try {
    if (!d) return "-";
    // Firestore Timestamp { seconds, nanoseconds }
    if (typeof d === "object" && "seconds" in d) return new Date(d.seconds * 1000).toLocaleString();
    return new Date(d).toLocaleString();
  } catch {
    return String(d ?? "-");
  }
}

export default function PhotosGallery({
  mode,
  redcapCode,
  profileIdFromMode,     // si estás en modo "profile", te lo paso por props
  max = 50,              // límite de fotos a mostrar
}: {
  mode: "global" | "profile";
  redcapCode: string;             // "" = Todos
  profileIdFromMode?: string;     // sólo en modo perfil
  max?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);

  const db = useMemo(() => getFirestore(), []);

  // Decide qué profileId usar:
  // - Si estás en modo "profile": usa profileIdFromMode tal cual.
  // - Si estás en "global": sólo seguimos si hay redcapCode y resuelve a exactamente 1 perfil.
  const [resolvedProfileId, setResolvedProfileId] = useState<string | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<"idle" | "ok" | "none" | "many">("idle");

  useEffect(() => {
    setResolvedProfileId(null);
    setResolutionStatus("idle");
    setRows([]);

    (async () => {
      if (mode === "profile") {
        if (!profileIdFromMode) {
          setResolutionStatus("none");
          return;
        }
        setResolvedProfileId(profileIdFromMode);
        setResolutionStatus("ok");
        return;
      }

      // GLOBAL
      if (!redcapCode) {
        setResolutionStatus("none"); // no hay redcap seleccionado
        return;
      }

      const r = await getSingleProfileIdByRedcap(redcapCode);
      setResolutionStatus(r.status);
      setResolvedProfileId(r.profileId ?? null);
    })();
  }, [mode, profileIdFromMode, redcapCode]);

  useEffect(() => {
    (async () => {
      setErr(null);
      setRows([]);

      // sólo cargamos si tenemos un profileId resuelto:
      if (resolutionStatus !== "ok" || !resolvedProfileId) {
        return;
      }
      setLoading(true);
      try {
        const q = query(
          collection(db, "photoHistory"),
          where("profileId", "==", resolvedProfileId),
          where("date", ">=", CUTOFF_DATE),
          orderBy("date", "desc"),
          limit(max)
        );
        const snap = await getDocs(q);
        const items: PhotoRow[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setRows(items);
      } catch (e: any) {
        setErr(e?.message || "Error leyendo photoHistory");
      } finally {
        setLoading(false);
      }
    })();
  }, [db, resolvedProfileId, resolutionStatus, max]);

  // UI según estado de resolución:
  if (mode === "global" && !redcapCode) {
    return <Card title="Fotos"><div className="p-4 text-sm text-neutral-400">Selecciona un <b>REDCap code</b> para ver fotos.</div></Card>;
  }
  if (resolutionStatus === "many") {
    return <Card title="Fotos"><div className="p-4 text-sm text-neutral-400">El código <b>{redcapCode}</b> tiene <b>varios perfiles</b>. Cambia a <b>modo Perfil</b> y elige uno.</div></Card>;
  }
  if (resolutionStatus === "none") {
    return <Card title="Fotos"><div className="p-4 text-sm text-neutral-400">No se encontró un perfil para el código seleccionado.</div></Card>;
  }

  return (
    <Card title={`Fotos (${rows.length})`}>
      {loading && <div className="p-4 text-sm text-neutral-300">Cargando fotos…</div>}
      {!loading && rows.length === 0 && <div className="p-4 text-sm text-neutral-400">No hay fotos para este perfil.</div>}

      {!loading && rows.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950">
              {/* Imagen */}
              <div className="relative w-full aspect-square bg-neutral-900 grid place-items-center">
                {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                    src={r.imageUrl}
                    alt={r.summary || r.id}
                    className="object-cover w-full h-full"
                    loading="lazy"
                    />
                ) : (
                    <div className="p-4 text-center text-xs text-neutral-400">
                    {/* placeholder cuando no hay imagen */}
                    {r.summary?.trim()
                        ? r.summary
                        : "Sin imagen disponible para esta captura."}
                    </div>
                )}
                </div>


              {/* Meta */}
              <div className="p-3 space-y-2">
                <div className="text-xs text-neutral-400">{fmtDate(r.date)}</div>
                {r.summary && <div className="text-sm">{r.summary}</div>}

                {/* Lesiones */}
                {(r.resultDetails?.length ?? 0) > 0 && (
                  <div className="text-xs">
                    <div className="mb-1 opacity-70">Lesiones:</div>
                    <div className="flex flex-wrap gap-1">
                      {r.resultDetails!.map((l, i) => (
                        <span key={l.lesionId || `${i}-${l.className}`} className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800">
                          {l.className || `Clase ${l.classId}`} · {typeof l.confidence === "number" ? `${(l.confidence * 100).toFixed(0)}%` : "—"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
