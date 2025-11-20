"use client";
import { useEffect, useState } from "react";
import { loginWithGoogle } from "@/lib/firebaseClient";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  async function handleLogin() {
    setBusy(true);
    setErr(null);
    const r = await loginWithGoogle();
    if (!r.ok) setErr(r.error);
    setBusy(false);
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-sm w-full bg-neutral-950 border border-neutral-800 p-6 rounded-xl">
        <h1 className="text-2xl font-bold mb-2">FootSelfie — Dashboard</h1>
        <p className="text-sm text-neutral-400 mb-6">
          Acceso solo para administradores.
        </p>

        {!!err && (
          <div className="mb-4 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-2">
            {err}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={busy || loading}
          className="w-full rounded-lg px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
        >
          {busy || loading ? "Cargando…" : "Entrar con Google"}
        </button>

        <p className="text-xs text-neutral-500 mt-4 leading-5">
          Después de iniciar sesión, si ves error 401/NOT_ADMIN en el dashboard,
          crea un documento en Firestore:
          <br />
          <code className="text-neutral-300">admins/&lt;tu-uid&gt;</code> (vacío).
        </p>
      </div>
    </div>
  );
}
