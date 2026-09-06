"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Popover({
  label,
  className = "",
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current?.open && !root.current.contains(event.target as Node))
        root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details
      ref={root}
      className={`popover ${className}`}
      onToggle={(event) => { if (event.currentTarget.open) setOpen(true); }}
    >
      <summary>{label}</summary>
      {open ? <div className="popover-content">{children}</div> : null}
    </details>
  );
}
