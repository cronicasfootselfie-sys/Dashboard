// hooks/useRedcapOptions.ts
"use client";
import { useEffect, useMemo, useState } from "react";
import { getRedcapCodesWithProfiles } from "@/lib/patientsClient";
import { describeError } from "@/lib/authedFetch";

export function useRedcapOptions() {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await getRedcapCodesWithProfiles();
        if (!cancel) setCodes(list);
      } catch (e) {
        console.error("useRedcapOptions", e);
        if (!cancel) setError(describeError(e));
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

  return { loading, options, codes, error };
}
