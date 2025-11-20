// components/Sidebar.tsx
"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/firebaseClient";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";

const items = [
  { href: "/", label: "Dashboard" },
  // { href: "/otra", label: "Otra sección" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, userRole } = useAuth(); // Añade userRole aquí
  const [signingOut, setSigningOut] = useState(false);

  // Obtener el texto del rol para mostrar
  const getRoleText = () => {
    if (userRole === 'full') return 'Acceso completo';
    if (userRole === 'restricted') return 'Acceso REDCap & Fotos';
    return 'Cargando...';
  };

  return (
    <aside className="w-64 h-screen sticky top-0 bg-neutral-950 border-r border-neutral-800 p-4 flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <div className="text-lg font-bold">FootSelfie • Admin</div>
      </div>

      <nav className="flex-1 grid gap-1">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`px-3 py-2 rounded-lg transition-colors border ${
                active
                  ? "bg-neutral-900 border-neutral-700"
                  : "border-transparent hover:bg-neutral-900 hover:border-neutral-800"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-neutral-800 pt-4">
        <div className="flex items-center gap-3 mb-3">
          {user?.photoURL ? (
            <Image
              src={user.photoURL}
              alt="avatar"
              width={28}
              height={28}
              className="rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-neutral-800" />
          )}
          <div className="text-sm">
            <div className="font-medium">{user?.displayName || "Usuario"}</div>
            <div className="text-neutral-400">{user?.email || "—"}</div>
            <div className="text-xs text-blue-400 mt-1">{getRoleText()}</div>
          </div>
        </div>

        <button
          onClick={async () => {
            setSigningOut(true);
            try {
              await logout();
              router.push("/login");
            } finally {
              setSigningOut(false);
            }
          }}
          disabled={signingOut}
          className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm hover:bg-neutral-800 disabled:opacity-60"
        >
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}