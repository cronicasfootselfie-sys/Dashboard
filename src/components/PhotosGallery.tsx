"use client";

import React, { useEffect, useState } from "react";
import Card from "@/components/Card";
import { getSingleProfileIdByRedcap } from "@/lib/patientsClient";
import { describeError, fetchJsonWithAuth } from "@/lib/authedFetch";
import { useAuth } from "@/hooks/useAuth";

// Las fotos se leen por /api/photos (Admin SDK en el servidor). La fecha de corte
// (18/12/2025) se aplica allí.

// Opciones de fotos por página
const PHOTOS_PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

type Lesion = {
  classId?: number;
  className?: string;
  confidence?: number;
  lesionId?: string;
  // puedes añadir más campos si los usas (Polygon, etc.)
};

type TrainingLabel = {
  isCorrectFoot: boolean;
  labeledBy: string;
  labeledAt: any;
  userId?: string;
};

type TrainingLabelStatus = {
  consensus: 'correct' | 'incorrect' | 'conflict' | 'pending';
  lastLabeledBy: string;
  lastLabeledAt: any;
  totalVoters: number;
  correctVotes: number;
  incorrectVotes: number;
};

type PhotoRow = {
  id: string;
  date?: any;               // Firestore Timestamp o string
  imageUrl?: string;
  profileId: string;
  resultDetails?: Lesion[];
  summary?: string;
  trainingLabels?: Record<string, TrainingLabel>;  // Indexado por email del usuario
  trainingLabelStatus?: TrainingLabelStatus;
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [labelingPhotoId, setLabelingPhotoId] = useState<string | null>(null);
  
  // Paginación por cursor: cursors[i] es el cursor de la página i+1 (la primera no tiene).
  const [photosPerPage, setPhotosPerPage] = useState(20);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const currentPage = cursors.length;
  const cursor = cursors[cursors.length - 1];
  const hasNextPage = !!nextCursor;
  const hasPrevPage = cursors.length > 1;

  // Decide qué profileId usar:
  // - Si estás en modo "profile": usa profileIdFromMode tal cual.
  // - Si estás en "global": sólo seguimos si hay redcapCode y resuelve a exactamente 1 perfil.
  const [resolvedProfileId, setResolvedProfileId] = useState<string | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<"idle" | "ok" | "none" | "many" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setResolvedProfileId(null);
    setResolutionStatus("idle");
    setRows([]);
    setErr(null);
    setCursors([null]);
    setNextCursor(null);

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

      try {
        const r = await getSingleProfileIdByRedcap(redcapCode);
        if (cancelled) return;
        setResolutionStatus(r.status);
        setResolvedProfileId(r.profileId ?? null);
      } catch (e) {
        console.error("PhotosGallery: resolver perfil", e);
        if (cancelled) return;
        setResolutionStatus("error");
        setErr(describeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, profileIdFromMode, redcapCode]);

  // Función para actualizar el label de entrenamiento
  // El servidor registra el voto con el email del token y recalcula el consenso.
  const updateTrainingLabel = async (photoId: string, isCorrectFoot: boolean) => {
    if (!user?.email || !user?.uid) {
      setErr("Debes estar autenticado para etiquetar fotos");
      return;
    }

    if (labelingPhotoId === photoId) {
      return; // Ya se está procesando
    }

    setLabelingPhotoId(photoId);
    setErr(null);

    try {
      const updated = await fetchJsonWithAuth<{
        id: string;
        trainingLabels?: Record<string, TrainingLabel>;
        trainingLabelStatus?: TrainingLabelStatus | null;
      }>("/api/photos/label", {
        method: "POST",
        body: JSON.stringify({ photoId, isCorrectFoot }),
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === photoId
            ? {
                ...r,
                trainingLabels: updated.trainingLabels,
                trainingLabelStatus: updated.trainingLabelStatus ?? undefined,
              }
            : r
        )
      );
    } catch (e: any) {
      console.error("Error al etiquetar:", e);
      setErr(describeError(e));
    } finally {
      // Permitir nuevo click después de 500ms
      setTimeout(() => {
        setLabelingPhotoId(null);
      }, 500);
    }
  };

  // Cargar la página actual de fotos
  useEffect(() => {
    // sólo cargamos si tenemos un profileId resuelto:
    if (resolutionStatus !== "ok" || !resolvedProfileId) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErr(null);

    const params = new URLSearchParams({ profileId: resolvedProfileId, limit: String(photosPerPage) });
    if (cursor) params.set("cursor", cursor);

    fetchJsonWithAuth<{ photos: PhotoRow[]; nextCursor: string | null }>(`/api/photos?${params}`)
      .then((r) => {
        if (cancelled) return;
        setRows(r.photos ?? []);
        setNextCursor(r.nextCursor ?? null);
      })
      .catch((e) => {
        console.error("Error leyendo fotos:", e);
        if (cancelled) return;
        setRows([]);
        setNextCursor(null);
        setErr(describeError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProfileId, resolutionStatus, photosPerPage, cursor, reloadKey]);

  // Cambiar el tamaño de página vuelve a la página 1
  const changePhotosPerPage = (n: number) => {
    setPhotosPerPage(n);
    setCursors([null]);
  };

  const handleNextPage = () => {
    if (nextCursor) setCursors((prev) => [...prev, nextCursor]);
  };

  const handlePrevPage = () => {
    setCursors((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  // UI según estado de resolución:
  if (resolutionStatus === "error") {
    return <Card title="Fotos"><div className="p-4 text-base text-red-400">⚠ No se pudo cargar la lista de pacientes: {err}</div></Card>;
  }
  if (mode === "global" && !redcapCode) {
    return <Card title="Fotos"><div className="p-4 text-base text-neutral-400">Selecciona un <b>REDCap code</b> para ver fotos.</div></Card>;
  }
  if (resolutionStatus === "many") {
    return <Card title="Fotos"><div className="p-4 text-base text-neutral-400">El código <b>{redcapCode}</b> tiene <b>varios perfiles</b>. Cambia a <b>modo Perfil</b> y elige uno.</div></Card>;
  }
  if (resolutionStatus === "none") {
    return <Card title="Fotos"><div className="p-4 text-base text-neutral-400">No se encontró un perfil para el código seleccionado.</div></Card>;
  }

  return (
    <Card title="Fotos">
      {/* Controles de paginación */}
      {resolutionStatus === "ok" && resolvedProfileId && (
        <div className="p-4 border-b border-neutral-800 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-base text-neutral-400 font-medium">Fotos por página:</label>
            <select
              value={photosPerPage}
              onChange={(e) => changePhotosPerPage(Number(e.target.value))}
              className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-base text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-base text-neutral-200 transition-colors font-medium"
            >
              ← Anterior
            </button>
            <span className="text-base text-neutral-400 font-medium">
              Página {currentPage}
            </span>
            <button
              onClick={handleNextPage}
              disabled={!hasNextPage || loading}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-base text-neutral-200 transition-colors font-medium"
            >
              Siguiente →
            </button>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-base text-neutral-200 transition-colors font-medium"
              title="Volver a cargar esta página"
            >
              ↻ Actualizar
            </button>
          </div>
        </div>
      )}

      {err && <div className="p-4 text-base text-red-400">⚠ {err}</div>}
      {loading && <div className="p-4 text-base text-neutral-300">Cargando fotos…</div>}
      {!loading && !err && rows.length === 0 && <div className="p-4 text-base text-neutral-400">No hay fotos para este perfil.</div>}

      {!loading && rows.length > 0 && (
        <>
          <div className="p-4 text-sm text-neutral-500">
            Mostrando {rows.length} foto{rows.length !== 1 ? "s" : ""} (página {currentPage})
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {rows.map((r) => {
              const userVote = user?.email ? r.trainingLabels?.[user.email] : null;
              const status = r.trainingLabelStatus;
              const consensus = status?.consensus || 'pending';
              
              // Determinar borde según consenso
              const borderClass = 
                consensus === 'correct' ? 'border-green-600 border-2' :
                consensus === 'incorrect' ? 'border-red-600 border-2' :
                consensus === 'conflict' ? 'border-yellow-600 border-2' :
                'border-neutral-800';

              return (
                <div key={r.id} className={`${borderClass} rounded-lg overflow-hidden bg-neutral-950`}>
                  {/* Imagen con botones de etiquetado */}
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
                    
                    {/* Botones de etiquetado - esquina superior derecha */}
                    {user && (
                      <div className="absolute top-2 right-2 flex gap-2 z-10">
                        <button
                          onClick={() => updateTrainingLabel(r.id, true)}
                          disabled={labelingPhotoId === r.id || loading}
                          className={`p-2 rounded transition-all ${
                            userVote?.isCorrectFoot === true || consensus === 'correct'
                              ? 'bg-green-600 text-white shadow-lg'
                              : 'bg-neutral-800/90 text-neutral-400 hover:bg-green-600/30 hover:text-green-400'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title="Marcar como planta de pie correcta"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => updateTrainingLabel(r.id, false)}
                          disabled={labelingPhotoId === r.id || loading}
                          className={`p-2 rounded transition-all ${
                            userVote?.isCorrectFoot === false || consensus === 'incorrect'
                              ? 'bg-red-600 text-white shadow-lg'
                              : 'bg-neutral-800/90 text-neutral-400 hover:bg-red-600/30 hover:text-red-400'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          title="Marcar como no es planta de pie correcta"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="p-3 space-y-2.5">
                    <div className="text-sm text-neutral-400 font-medium">{fmtDate(r.date)}</div>
                    
                    {/* Información generada por la app móvil */}
                    {r.summary && (
                      <div className="text-base font-medium">
                        {r.summary}
                      </div>
                    )}

                    {/* Lesiones detectadas por la app móvil */}
                    {(r.resultDetails?.length ?? 0) > 0 && (
                      <div className="text-sm">
                        <div className="mb-1.5 opacity-80 font-medium">Lesiones detectadas:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.resultDetails!.map((l, i) => (
                            <span key={l.lesionId || `${i}-${l.className}`} className="px-2.5 py-1.5 rounded bg-neutral-900 border border-neutral-800 text-sm">
                              {l.className || `Clase ${l.classId}`} · {typeof l.confidence === "number" ? `${(l.confidence * 100).toFixed(0)}%` : "—"}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Observación del personal de campo - Separada visualmente */}
                    {status && status.totalVoters > 0 && (
                      <div className="text-sm space-y-2 pt-3 mt-3 border-t-2 border-neutral-700">
                        <div className="text-xs text-neutral-400 uppercase tracking-wide font-semibold mb-2">
                          👥 Observación del personal de campo
                        </div>
                        <div className="flex items-center gap-2">
                          {consensus === 'correct' && (
                            <>
                              <span className="text-green-400 font-semibold text-lg">✓</span>
                              <span className="text-green-400 font-semibold">Planta de pie correcta</span>
                            </>
                          )}
                          {consensus === 'incorrect' && (
                            <>
                              <span className="text-red-400 font-semibold text-lg">✗</span>
                              <span className="text-red-400 font-semibold">No es planta de pie correcta</span>
                            </>
                          )}
                          {consensus === 'conflict' && (
                            <>
                              <span className="text-yellow-400 font-semibold text-lg">⚠</span>
                              <span className="text-yellow-400 font-semibold">Opiniones divididas</span>
                            </>
                          )}
                          {consensus === 'pending' && (
                            <span className="text-neutral-500">Sin etiquetar</span>
                          )}
                        </div>
                        <div className="text-neutral-400 text-sm leading-relaxed">
                          <span className="text-green-400 font-medium">{status.correctVotes}</span>
                          <span className="text-neutral-500"> evaluador{status.correctVotes !== 1 ? 'es' : ''} marcó{status.correctVotes !== 1 ? 'ron' : ''} como </span>
                          <span className="text-green-400 font-medium">correcta{status.correctVotes !== 1 ? 's' : ''}</span>
                          {status.incorrectVotes > 0 && (
                            <>
                              <span className="text-neutral-500"> · </span>
                              <span className="text-red-400 font-medium">{status.incorrectVotes}</span>
                              <span className="text-neutral-500"> como </span>
                              <span className="text-red-400 font-medium">incorrecta{status.incorrectVotes !== 1 ? 's' : ''}</span>
                            </>
                          )}
                        </div>
                        {status.lastLabeledBy && (
                          <div className="text-neutral-500 text-xs italic">
                            Última evaluación por: {status.lastLabeledBy}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Navegación inferior */}
          {rows.length > 0 && (
            <div className="p-4 border-t border-neutral-800 flex items-center justify-center gap-3">
              <button
                onClick={handlePrevPage}
                disabled={!hasPrevPage || loading}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-base text-neutral-200 transition-colors font-medium"
              >
                ← Anterior
              </button>
              <span className="text-base text-neutral-400 font-medium">
                Página {currentPage}
              </span>
              <button
                onClick={handleNextPage}
                disabled={!hasNextPage || loading}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed border border-neutral-700 rounded text-base text-neutral-200 transition-colors font-medium"
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
