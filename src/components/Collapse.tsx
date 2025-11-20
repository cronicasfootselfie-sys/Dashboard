"use client";
import React, { useEffect, useState } from "react";

type Props = {
  id: string;                 // clave para recordar abierto/cerrado
  title: string;              // texto del header
  className?: string;         // estilos del contenedor (bordes, fondo)
  defaultOpen?: boolean;      // abierto por defecto
  children: React.ReactNode;  // contenido al expandir
};

export default function Collapse({
  id, title, className = "", defaultOpen = false, children
}: Props) {
  const storageKey = `collapse:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? defaultOpen : raw === "1";
    } catch { return defaultOpen; }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch {}
  }, [open, storageKey]);

  return (
    <div className={`rounded-lg border ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide opacity-90">
          {title}
        </span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.085l3.71-3.855a.75.75 0 111.08 1.04l-4.24 4.4a.75.75 0 01-1.08 0l-4.24-4.4a.75.75 0 01.02-1.06z"/>
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}
