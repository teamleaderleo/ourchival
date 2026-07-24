"use client";

import { useEffect } from "react";

const drawerSelector = ".capture-session-drawer, .conversation-drawer";
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function WorkbenchController() {
  useEffect(() => {
    let activeDrawer: HTMLElement | null = null;
    let returnFocus: HTMLElement | null = null;

    function syncDrawer() {
      const nextDrawer = document.querySelector<HTMLElement>(drawerSelector);
      if (nextDrawer === activeDrawer) return;

      if (!nextDrawer) {
        activeDrawer = null;
        returnFocus?.focus();
        returnFocus = null;
        return;
      }

      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : matchingLauncher(nextDrawer);
      activeDrawer = nextDrawer;
      nextDrawer.setAttribute("role", "dialog");
      nextDrawer.setAttribute("aria-modal", "true");
      nextDrawer.tabIndex = -1;
      window.requestAnimationFrame(() => nextDrawer.focus());
    }

    function handleKeyDown(event: KeyboardEvent) {
      const drawer = document.querySelector<HTMLElement>(drawerSelector);
      if (!drawer) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeButton(drawer)?.click();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter(isVisible);
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!drawer.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    const observer = new MutationObserver(syncDrawer);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKeyDown);
    syncDrawer();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return null;
}

function matchingLauncher(drawer: HTMLElement) {
  const selector = drawer.classList.contains("capture-session-drawer")
    ? ".capture-session-launcher"
    : ".conversation-launcher";
  return document.querySelector<HTMLElement>(selector);
}

function closeButton(drawer: HTMLElement) {
  return Array.from(drawer.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Close",
  );
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0;
}
