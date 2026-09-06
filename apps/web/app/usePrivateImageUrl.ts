"use client";

import { useEffect, useState } from "react";
import { resolveConvexSiteUrl } from "./privateAccess";
import { createPreviewCache } from "./privatePreviewCache";

const previewCache = createPreviewCache(async sourceUrl => {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Preview could not load (${response.status}).`);
  return response.blob();
});
let listening = false;

export function usePrivateImageUrl(sourceUrl?: string | null) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    sourceUrl && !isProtectedDriveUrl(sourceUrl) ? sourceUrl : null,
  );
  const [loading, setLoading] = useState(
    Boolean(sourceUrl && isProtectedDriveUrl(sourceUrl)),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!listening) {
      listening = true;
      window.addEventListener("ourchival-access-changed", previewCache.clear);
      window.addEventListener("storage", previewCache.clear);
    }
    let cancelled = false;
    let objectUrl: string | undefined;

    if (!sourceUrl) {
      setResolvedUrl(null);
      setLoading(false);
      setError("");
      return;
    }

    if (!isProtectedDriveUrl(sourceUrl)) {
      setResolvedUrl(sourceUrl);
      setLoading(false);
      setError("");
      return;
    }

    setResolvedUrl(null);
    setLoading(true);
    setError("");

    void previewCache.get(sourceUrl)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load private image.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  return { resolvedUrl, loading, error };
}

export function isProtectedDriveUrl(value: string) {
  try {
    const siteUrl = resolveConvexSiteUrl();
    if (!siteUrl) return false;
    const base = typeof window === "undefined" ? siteUrl : window.location.href;
    const candidate = new URL(value, base);
    const site = new URL(siteUrl);
    return (
      candidate.origin === site.origin && candidate.pathname === "/drive-file"
    );
  } catch {
    return false;
  }
}
