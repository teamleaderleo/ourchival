"use client";

import { useEffect, useState } from "react";

export function usePrivateImageUrl(sourceUrl?: string | null) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    sourceUrl && !isProtectedDriveUrl(sourceUrl) ? sourceUrl : null,
  );
  const [loading, setLoading] = useState(Boolean(sourceUrl && isProtectedDriveUrl(sourceUrl)));
  const [error, setError] = useState("");

  useEffect(() => {
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

    void fetch(sourceUrl)
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Private image request failed: ${response.status}`);
        }
        return await response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not load private image.");
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
    const base = typeof window === "undefined" ? "https://ourchival.invalid" : window.location.href;
    return new URL(value, base).pathname.endsWith("/drive-file");
  } catch {
    return false;
  }
}
