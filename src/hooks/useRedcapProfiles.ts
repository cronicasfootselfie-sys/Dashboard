import { useEffect, useMemo, useState } from "react";
import { getProfilesByUserRedcap, getAllProfilesWithAnyRedcap, getProfileToRedcapMap, getProfileIdsByRedcap } from "@/lib/redcapFirestore";

export function useRedcapProfiles(selectedRedcap?: string) {
  const [loading, setLoading] = useState(true);
  const [profileToRedcapMap, setMap] = useState<Record<string, string>>({});
  const [profileIdsByRedcap, setDict] = useState<Record<string, string[]>>({});
  const [allProfilesWithAnyRedcap, setAll] = useState<string[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [map, dict] = await Promise.all([
          getProfileToRedcapMap(),
          getProfileIdsByRedcap(),
        ]);
        if (cancel) return;
        setMap(map);
        setDict(dict);
        setAll(Array.from(new Set(Object.values(dict).flat())));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const allowedSet = useMemo(() => {
    if (!selectedRedcap) return new Set(allProfilesWithAnyRedcap);
    return new Set(profileIdsByRedcap[selectedRedcap] || []);
  }, [selectedRedcap, profileIdsByRedcap, allProfilesWithAnyRedcap]);

  return {
    loading,
    profileToRedcapMap,          // ⬅️ Mapa global
    profileIdsByRedcap,          // { redcap_code: [profileIds] }
    allProfilesWithAnyRedcap,    // [profileId, ...]
    allowedSet,
  };
}
