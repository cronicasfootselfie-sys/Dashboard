// hooks/useAuth.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { User, getAuth } from "firebase/auth";
import { onUser } from "@/lib/firebaseClient";

// Lista de usuarios con acceso restringido (solo REDCap y Fotos)
const RESTRICTED_USERS = [
  'pamela.cahui@upch.pe',
  'maria.purizaca@upch.pe'
];

// Lista de usuarios con acceso completo
const FULL_ACCESS_USERS = [
  'maria.lazo@upch.pe',
  'lourdes.cruzado@upch.pe',
  'ana.bautista@upch.pe',
  'sergio.sosa.c@uni.pe'
];

export interface AuthState {
  user: User | null;
  loading: boolean;
  idToken: string | null;
  isAdmin: boolean;
  userRole: 'full' | 'restricted' | null;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<'full' | 'restricted' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const unsub = onUser(async (u) => {
      if (!mounted) return;

      setUser(u);
      if (u) {
        try {
          const token = await u.getIdToken();
          setIdToken(token);

          // ⚠️ aquí revisamos custom claims "admin"
          const decoded: any = JSON.parse(atob(token.split(".")[1]));
          setIsAdmin(!!decoded.admin);

          // Determinar el rol del usuario basado en el email
          const userEmail = u.email?.toLowerCase();
          if (userEmail) {
            if (RESTRICTED_USERS.includes(userEmail)) {
              setUserRole('restricted');
            } else if (FULL_ACCESS_USERS.includes(userEmail) || decoded.admin) {
              setUserRole('full');
            } else {
              // Si no está en ninguna lista, por defecto acceso restringido
              setUserRole('restricted');
            }
          }
        } catch {
          setIdToken(null);
          setIsAdmin(false);
          setUserRole(null);
        }
      } else {
        setIdToken(null);
        setIsAdmin(false);
        setUserRole(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      unsub && unsub();
    };
  }, []);

  return { user, loading, idToken, isAdmin, userRole };
}