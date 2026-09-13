"use client";

import React from "react";

// One shared disclosure for keyboard triage help. Mounted in the gallery
// sidebar and the review header with per-surface items; never in a dialog,
// so it costs no focus management and stays out of the first viewport.
export function KeyboardHelp({ items }: { items: Array<[keys: string, action: string]> }) {
  return (
    <details className="keyboard-help">
      <summary>Keys</summary>
      <dl>
        {items.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export const galleryKeys: Array<[string, string]> = [
  ["← → ↑ ↓", "Move selection"],
  ["Enter / Space", "Open viewer"],
  ["k", "Keep"],
  ["l", "Later"],
  ["f", "Favorite"],
  ["Delete", "Trash"],
  ["/", "Search"],
];

export const viewerKeys: Array<[string, string]> = [
  ["← →", "Previous / next"],
  ["↑ ↓", "Switch image"],
  ["k / l / f", "Keep / later / favorite"],
  ["o", "Open source"],
  ["z", "Zoom"],
  ["Esc", "Close"],
];

export const reviewKeys: Array<[string, string]> = [
  ["← →", "Walk the queue"],
  ["n", "No"],
  ["m", "Maybe"],
  ["y", "Yes"],
];
