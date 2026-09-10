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
    const lookAhead = Math.max(1600, window.innerHeight * 2);
    const columns = Array.from(document.querySelectorAll<HTMLElement>(".masonry-column"));
    const check = () => {
      frame = 0;
      // Load before the shortest column runs out, even beside a tall portrait column.
      const bottom = columns.length
        ? Math.min(...columns.map(column => column.getBoundingClientRect().bottom))
        : root.current?.getBoundingClientRect().top;
      if (bottom !== undefined && bottom <= window.innerHeight + lookAhead) load();
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) load();
      },
      { rootMargin: `${lookAhead}px` },
    );
    observer.observe(root.current);
    const resizeObserver = new ResizeObserver(onScroll);
    columns.forEach(column => resizeObserver.observe(column));
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
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
