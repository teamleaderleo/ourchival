import type { VaultView } from "./VaultNavigation";

/** Small, decorative companions to text labels. No font or image requests. */
export function CatIcon({ name }: { name: VaultView }) {
  return (
    <svg className="cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "inbox" ? <>
        <path className="cat-icon-warm" d="M6 13V5l4 2a8 8 0 0 1 4 0l4-2v8" />
        <path d="M3 13h5l1.5 3h5l1.5-3h5l-2 7H5l-2-7Z" />
        <path d="M9 10v1m6-1v1m-4 2h2" />
      </> : null}
      {name === "all" ? <>
        <path d="M4 4h4v15H4zM10 6h4v13h-4zM17 5l3-1 3 14-3 1zM2 21h20" />
        <path className="cat-icon-warm" d="M5 8h2m4 3h2m5-2 2-.5" />
        <path d="M10 6V3l2 1 2-1v3" />
      </> : null}
      {name === "images" ? <>
        <path d="M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6" />
        <path className="cat-icon-warm" d="M14 9V6l2 1 2-1v3a2 2 0 0 1-4 0Z" />
      </> : null}
      {name === "links" ? <>
        <path d="m10 14 4-4m-5 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" />
        <path className="cat-icon-warm" d="M5 7V3l4 2m8 12 3 4 1-5" />
      </> : null}
      {name === "favorites" ? <>
        <path className="cat-icon-warm" d="M12 21S3 16 3 9a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 7-9 12-9 12Z" />
        <path d="M8 14v-4l2 1a5 5 0 0 1 4 0l2-1v4m-6 0h.1m3.9 0h.1m-3 2h1.8" />
      </> : null}
      {name === "later" ? <>
        <path d="M18 10a8 8 0 1 0 2 6c0-3-2-5-5-5h-2l-2-3-1 4a4 4 0 0 0 4 6h2" />
        <path className="cat-icon-warm" d="M14 14h2m1-11h4l-4 4h4" />
      </> : null}
      {name === "archive" ? <>
        <path d="M3 8h18v4H3zM5 12v9h14v-9m-9 4h4" />
        <path className="cat-icon-warm" d="M7 8V3l3 2h4l3-2v5" />
      </> : null}
      {name === "trash" ? <>
        <path d="M4 7h16M6 7l1 14h10l1-14M9 7V4h6v3m-5 4v6m4-6v6" />
        <path className="cat-icon-warm" d="M19 18c4 0 4-5 2-6" />
      </> : null}
    </svg>
  );
}
