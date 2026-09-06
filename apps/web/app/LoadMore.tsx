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
    let requested = false;
    let frame = 0;
    const load = () => {
      if (requested) return;
      requested = true;
      void onLoad().finally(() => { requested = false; });
    };
    const check = () => {
      frame = 0;
      if (root.current && root.current.getBoundingClientRect().top <= window.innerHeight + 1200) load();
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) load();
      },
      { rootMargin: "1200px" },
    );
    observer.observe(root.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
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
