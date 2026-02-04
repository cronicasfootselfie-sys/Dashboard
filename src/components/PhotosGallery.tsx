"use client";

import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/Card";
import Image from "next/image";
import { getFirestore, collection, getDocs, query, where, orderBy, limit, startAfter, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { getSingleProfileIdByRedcap } from "@/lib/redcapFirestore";

// Fecha de corte: solo mostrar datos desde el 18/12/2025
const CUTOFF_DATE = new Date('2025-12-18T00:00:00.000Z');

// Opciones de fotos por página
const PHOTOS_PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

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
  max = 50,              // límite máximo de fotos (deprecated, usar photosPerPage)
}: {
  mode: "global" | "profile";
  redcapCode: string;             // "" = Todos
  profileIdFromMode?: string;     // sólo en modo perfil
  max?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);
  
  // Paginación
  const [photosPerPage, setPhotosPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [pageStack, setPageStack] = useState<QueryDocumentSnapshot<DocumentData>[]>([]); // Stack para navegación hacia atrás
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [totalPhotos, setTotalPhotos] = useState<number | null>(null);

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
    setCurrentPage(1);
    setLastDoc(null);
    setPageStack([]);

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

  // Cargar fotos con paginación
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
        // Construir query base
        let q = query(
          collection(db, "photoHistory"),
          where("profileId", "==", resolvedProfileId),
          where("date", ">=", CUTOFF_DATE),
          orderBy("date", "desc"),
          limit(photosPerPage + 1) // +1 para verificar si hay siguiente página
        );

        // Si no es la primera página, usar startAfter con el documento del stack
        if (currentPage > 1) {
          // Si tenemos el documento de la página anterior en el stack, usarlo
          if (pageStack.length >= currentPage - 1) {
            const docToStartAfter = pageStack[currentPage - 2];
            q = query(
              collection(db, "photoHistory"),
              where("profileId", "==", resolvedProfileId),
              where("date", ">=", CUTOFF_DATE),
              orderBy("date", "desc"),
              startAfter(docToStartAfter),
              limit(photosPerPage + 1)
            );
          } else {
            // Si retrocedimos y no tenemos el doc en el stack, recargar desde inicio
            const skipPages = currentPage - 1;
            const skipDocs = skipPages * photosPerPage;
            q = query(
              collection(db, "photoHistory"),
              where("profileId", "==", resolvedProfileId),
              where("date", ">=", CUTOFF_DATE),
              orderBy("date", "desc"),
              limit(skipDocs + photosPerPage + 1)
            );
          }
        }

        const snap = await getDocs(q);
        let docs = snap.docs;
        
        // Si recargamos desde el inicio (para retroceder), saltar las páginas anteriores
        if (currentPage > 1 && pageStack.length < currentPage - 1) {
          const skipPages = currentPage - 1;
          const skipDocs = skipPages * photosPerPage;
          docs = docs.slice(skipDocs);
        }
        
        // Verificar si hay siguiente página
        const hasMore = docs.length > photosPerPage;
        if (hasMore) {
          docs.pop(); // Remover el documento extra
        }
        
        setHasNextPage(hasMore);
        setHasPrevPage(currentPage > 1);
        
        // Guardar último documento para navegación hacia adelante
        if (docs.length > 0) {
          const newLastDoc = docs[docs.length - 1];
          setLastDoc(newLastDoc);
          
          // Si avanzamos a una nueva página, guardar en el stack
          if (currentPage > pageStack.length) {
            setPageStack(prev => [...prev, newLastDoc]);
          }
        }
        
        const items: PhotoRow[] = docs.map((d) => ({
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
  }, [db, resolvedProfileId, resolutionStatus, photosPerPage, currentPage, lastDoc, pageStack]);

  // Resetear a página 1 cuando cambia photosPerPage
  useEffect(() => {
    if (currentPage !== 1) {
      setCurrentPage(1);
      setLastDoc(null);
      setPageStack([]);
    }
  }, [photosPerPage]);

  const handleNextPage = () => {
    if (hasNextPage && lastDoc) {
      // Guardar el último doc actual en el stack antes de avanzar
      setPageStack(prev => [...prev, lastDoc!]);
      setCurrentPage(prev => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (hasPrevPage && currentPage > 1) {
      // Para retroceder, recargamos desde el inicio y saltamos las páginas anteriores
      // Esto es más simple aunque menos eficiente
      const targetPage = currentPage - 1;
      setCurrentPage(targetPage);
      // Limpiar el stack hasta la página objetivo
      setPageStack(prev => prev.slice(0, targetPage - 1));
      setLastDoc(null);
    }
  };

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
    <Card title={`Fotos${totalPhotos !== null ? ` (${totalPhotos})` : ""}`}>
      {/* Controles de paginación */}
      {resolutionStatus === "ok" && resolvedProfileId && (
        <div className="p-4 border-b border-neutral-800 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm text-neutral-400">Fotos por página:</label>
            <select
              value={photosPerPage}
              onChange={(e) => setPhotosPerPage(Number(e.target.value))}
              className="px-3 py-1.5 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PHOTOS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrevPage}
              disabled={!hasPrevPage || loading}
              className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-sm text-neutral-200 transition-colors"
            >
              ← Anterior
            </button>
            <span className="text-sm text-neutral-400">
              Página {currentPage}
            </span>
            <button
              onClick={handleNextPage}
              disabled={!hasNextPage || loading}
              className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-sm text-neutral-200 transition-colors"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {loading && <div className="p-4 text-sm text-neutral-300">Cargando fotos…</div>}
      {!loading && rows.length === 0 && <div className="p-4 text-sm text-neutral-400">No hay fotos para este perfil.</div>}

      {!loading && rows.length > 0 && (
        <>
          <div className="p-4 text-xs text-neutral-500">
            Mostrando {rows.length} foto{rows.length !== 1 ? "s" : ""} (página {currentPage})
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
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
          
          {/* Navegación inferior */}
          {rows.length > 0 && (
            <div className="p-4 border-t border-neutral-800 flex items-center justify-center gap-3">
              <button
                onClick={handlePrevPage}
                disabled={!hasPrevPage || loading}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-sm text-neutral-200 transition-colors"
              >
                ← Anterior
              </button>
              <span className="text-sm text-neutral-400">
                Página {currentPage}
              </span>
              <button
                onClick={handleNextPage}
                disabled={!hasNextPage || loading}
                className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-sm text-neutral-200 transition-colors"
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
