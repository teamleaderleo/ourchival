"use client";
import { useEffect, useRef } from "react";

export function LoadMore({
  busy,
  onLoad,
  auto = true,
  failed = false,
}: {
  busy: boolean;
  auto?: boolean;
  failed?: boolean;
  onLoad: () => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (busy || !auto || !root.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void onLoad();
      },
      { rootMargin: "800px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [busy, onLoad, auto]);
  return (
    <div ref={root} className="load-more" aria-busy={busy}>
      {busy ? (
        <span className="scroll-progress" role="status">
          Loading more…
        </span>
      ) : null}
      <button
        type="button"
        className={failed ? "button ghost" : "button ghost scroll-fallback"}
        disabled={busy}
        onClick={() => void onLoad()}
      >
        {failed ? "Retry loading" : "Load next items"}
      </button>
    </div>
  );
}
