"use client";

import { useEffect } from "react";

export function VaultKeyboardShortcuts() {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      const search = document.querySelector<HTMLInputElement>(".search-field input[type='search']");
      if (!search) return;
      event.preventDefault();
      search.focus({ preventScroll: false });
      search.select();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return null;
}
