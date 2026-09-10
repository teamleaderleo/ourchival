"use client";
import { useEffect, useState } from "react";
import { startVisiblePolling } from "./visiblePolling";
import { onOwnerAccessChange, privateFetch, resolveConvexSiteUrl } from "./privateAccess";

export type DiscoveryChoice = { id: string; kind: "artist" | "tag"; label: string; detail: string; count: number };
type Directory = { ready: boolean; scanned: number; artists: DiscoveryChoice[]; tags: DiscoveryChoice[]; selected: Pick<DiscoveryChoice, "id" | "kind" | "label"> | null };
export function useArchiveDiscovery(search: string, revealSensitive: boolean, selected: string) {
  const [data, setData] = useState<(Directory & { visibility: boolean }) | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const url = resolveConvexSiteUrl();
    if (!url) { setError("The archive connection is unavailable."); return; }
    let ready = false;
    let cancelled = false;
    setError("");
    async function load(signal: AbortSignal) {
      const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      try {
        const params = new URLSearchParams({ search, revealSensitive: String(revealSensitive) });
        if (selected) params.set("selected", selected);
        const response = await privateFetch(`${url}/archive-discovery?${params}`, { signal: requestSignal() });
        if (!response.ok) throw new Error("Could not load artists and tags.");
        const result = await response.json() as Directory;
        if (cancelled || signal.aborted) return;
        ready = result.ready;
        setData({ ...result, visibility: revealSensitive }); setError("");
        if (!result.ready) {
          const started = await privateFetch(`${url}/archive-discovery`, { method: "POST", signal: requestSignal() });
          if (!started.ok) throw new Error("Could not start the directory update.");
        }
      } catch (caught) { if (!cancelled && !signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load artists and tags."); }
    }
    const stopPolling = startVisiblePolling(load, () => ready ? 5 * 60_000 : 30_000, search ? 250 : 0);
    const unsubscribe = onOwnerAccessChange(() => { setData(null); setRetry(value => value + 1); });
    return () => { cancelled = true; stopPolling(); unsubscribe(); };
  }, [search, revealSensitive, selected, retry]);
  return { data: data?.visibility === revealSensitive ? data : null, error, retry: () => setRetry(value => value + 1) };
}
