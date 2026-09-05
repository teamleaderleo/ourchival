"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function Popover({ label, className = "", children }: { label: ReactNode; className?: string; children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={root} className={`popover ${className}`}>
    <summary>{label}</summary><div className="popover-content">{children}</div>
  </details>;
}
