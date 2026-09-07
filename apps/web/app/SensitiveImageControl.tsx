"use client";

export function SensitiveImageControl({ shown, onChange }: { shown: boolean; onChange: (shown: boolean) => void }) {
  return <button type="button" className="button ghost visibility-toggle" aria-pressed={shown} onClick={() => onChange(!shown)} title="Show or hide sensitive and private artwork previews">
    {shown ? "Hide sensitive images" : "Show sensitive images"}
  </button>;
}
