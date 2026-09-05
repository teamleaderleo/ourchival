"use client";
import { useEffect, useRef } from "react";

export function LoadMore({ busy, onLoad, auto = true }: { busy: boolean; auto?: boolean; onLoad: () => Promise<void> }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (busy || !auto || !root.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void onLoad();
    }, { rootMargin: "800px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [busy, onLoad, auto]);
  return <div ref={root} className="load-more">
    <button type="button" className="button ghost" disabled={busy} onClick={() => void onLoad()}>{busy ? "…" : "More"}</button>
  </div>;
}
