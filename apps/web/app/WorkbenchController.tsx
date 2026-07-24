"use client";

import { useEffect } from "react";
import { captureSessionMutationActive } from "./captureSessionNavigationState";

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
      if (!nextDrawer) {
        if (activeDrawer) returnFocus?.focus();
        activeDrawer = null;
        returnFocus = null;
        return;
      }

      if (nextDrawer !== activeDrawer) {
        const activeElement =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        returnFocus =
          activeElement && activeElement !== document.body && !nextDrawer.contains(activeElement)
            ? activeElement
            : matchingLauncher(nextDrawer);
        activeDrawer = nextDrawer;
        nextDrawer.setAttribute("role", "dialog");
        nextDrawer.setAttribute("aria-modal", "true");
        nextDrawer.tabIndex = -1;
        window.requestAnimationFrame(() => nextDrawer.focus());
      }

      syncCaptureSessionNavigation(nextDrawer);
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
      if (document.activeElement === drawer) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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

    function handlePointerDown(event: PointerEvent) {
      if (event.target !== document.body) return;
      const drawer = document.querySelector<HTMLElement>(drawerSelector);
      if (drawer) closeButton(drawer)?.click();
    }

    const observer = new MutationObserver(syncDrawer);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["disabled"],
      childList: true,
      subtree: true,
    });
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    syncDrawer();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  return null;
}

function syncCaptureSessionNavigation(drawer: HTMLElement) {
  if (!drawer.classList.contains("capture-session-drawer")) return;
  const batchActions = Array.from(
    drawer.querySelectorAll<HTMLButtonElement>(
      ".capture-session-batch-actions button",
    ),
  );
  const locked = captureSessionMutationActive(
    batchActions.map((button) => button.disabled),
  );
  for (const button of headerNavigationButtons(drawer)) {
    button.disabled = locked;
    button.setAttribute("aria-disabled", String(locked));
  }
}

function matchingLauncher(drawer: HTMLElement) {
  const selector = drawer.classList.contains("capture-session-drawer")
    ? ".capture-session-launcher"
    : ".conversation-launcher";
  return document.querySelector<HTMLElement>(selector);
}

function headerNavigationButtons(drawer: HTMLElement) {
  const header = drawer.querySelector("header");
  if (!header) return [];
  return Array.from(header.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => {
      const label = button.textContent?.trim();
      return label === "Back" || label === "Close";
    },
  );
}

function closeButton(drawer: HTMLElement) {
  return Array.from(drawer.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Close",
  );
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0;
}
