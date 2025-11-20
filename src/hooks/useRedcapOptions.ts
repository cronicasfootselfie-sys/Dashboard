// hooks/useRedcapOptions.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { getRedcapCodesWithProfiles } from "@/lib/redcapFirestore";

export function useRedcapOptions() {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const list = await getRedcapCodesWithProfiles();
        if (!cancel) setCodes(list);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  // Formato para tu selector (label/value)
  const options = useMemo(
    () => codes.map(c => ({ label: c, value: c })),
    [codes]
  );

  return { loading, options, codes };
}
