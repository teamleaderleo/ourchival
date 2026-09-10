import type { ComponentProps } from "react";

export function CatCloseIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path className="cat-close-ears" d="M4 10V4l5 3m6 0 5-3v6" />
    <path d="m8 11 8 8m0-8-8 8" />
  </svg>;
}

export function CloseButton({ label = "Close", className = "", ...props }: ComponentProps<"button"> & { label?: string }) {
  return <button {...props} type="button" className={`button ghost cat-close ${className}`} aria-label={label} title={label}><CatCloseIcon /></button>;
}
