"use client";
import { useEffect, useState } from "react";
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
    const controller = new AbortController();
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setError("");
    async function load() {
      try {
        const params = new URLSearchParams({ search, revealSensitive: String(revealSensitive) });
        if (selected) params.set("selected", selected);
        const response = await privateFetch(`${url}/archive-discovery?${params}`, { signal: signal() });
        if (!response.ok) throw new Error("Could not load artists and tags.");
        const result = await response.json() as Directory;
        if (cancelled) return;
        setData({ ...result, visibility: revealSensitive }); setError("");
        if (!result.ready) {
          const started = await privateFetch(`${url}/archive-discovery`, { method: "POST", signal: signal() });
          if (!started.ok) throw new Error("Could not start the directory update.");
        }
        if (!cancelled) timer = setTimeout(load, result.ready ? 60_000 : 10_000);
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load artists and tags."); }
    }
    if (search) timer = setTimeout(load, 250);
    else void load();
    const unsubscribe = onOwnerAccessChange(() => { setData(null); setRetry(value => value + 1); });
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); unsubscribe(); };
  }, [search, revealSensitive, selected, retry]);
  return { data: data?.visibility === revealSensitive ? data : null, error, retry: () => setRetry(value => value + 1) };
}
