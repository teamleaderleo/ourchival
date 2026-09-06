"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  readPosition,
  savePosition,
  type BrowsePosition,
} from "./archivePosition";

export function useArchivePosition(
  key: string,
  references: Array<{ _id: string; browseCursor?: string }>,
  loading: boolean,
) {
  const pending = useRef<BrowsePosition | null>(null);
  const [notice, setNotice] = useState("");
  const [restoreSerial, setRestoreSerial] = useState(0);
  const [restoreReferenceId, setRestoreReferenceId] = useState<string | null>(
    null,
  );
  const capture = useRef(() => {});
  const suppress = useRef(false);
  const restoring = useRef(false);
  const startAtTop = useRef(false);

  const beginRestore = useCallback(() => {
    try {
      pending.current = readPosition(window.localStorage, key);
    } catch {
      pending.current = null;
    }
    suppress.current = false;
    startAtTop.current = !pending.current;
    restoring.current = true;
    setRestoreReferenceId(pending.current?.referenceId ?? null);
    setRestoreSerial((serial) => serial + 1);
    setNotice("");
    return pending.current;
  }, [key]);
  function reset() {
    setRestoreReferenceId(null);
    pending.current = null;
    startAtTop.current = false;
    suppress.current = true;
    restoring.current = false;
    setNotice("");
  }

  useLayoutEffect(() => {
    if (loading) return;
    if (startAtTop.current) {
      window.scrollTo({ top: 0, behavior: "instant" });
      startAtTop.current = false;
      restoring.current = false;
      return;
    }
    if (!pending.current) return;
    const marker = pending.current;
    let frame = 0;
    let passes = 0;
    const finish = () => {
      pending.current = null;
      restoring.current = false;
      setRestoreReferenceId(null);
    };
    const cancel = () => {
      cancelAnimationFrame(frame);
      finish();
    };
    const restore = () => {
      const element = Array.from(
        document.querySelectorAll<HTMLElement>("[data-reference-id]"),
      ).find((el) => el.dataset.referenceId === marker.referenceId);
      if (element) {
        window.scrollBy({
          top: element.getBoundingClientRect().top - marker.viewportTop,
          behavior: "instant",
        });
        // Windowed cards need a few frames to measure their new column positions.
        if (++passes < 8) {
          frame = requestAnimationFrame(restore);
          return;
        }
        setNotice("Resumed at your saved image.");
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
        setNotice(
          "Your saved image moved or no longer matches this view. Showing the saved page’s nearby results; you can start from the beginning.",
        );
      }
      finish();
    };
    frame = requestAnimationFrame(restore);
    window.addEventListener("wheel", cancel, { passive: true, once: true });
    window.addEventListener("touchstart", cancel, {
      passive: true,
      once: true,
    });
    window.addEventListener("keydown", cancel, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [references, loading, key, restoreSerial]);

  useEffect(() => {
    if (loading) return;
    const byId = new Map(
      references.map((reference) => [reference._id, reference]),
    );
    const visible = new Set<HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target as HTMLElement);
        else visible.delete(entry.target as HTMLElement);
      }
    });
    const observeCards = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches("[data-reference-id]")) observer.observe(node);
      node
        .querySelectorAll<HTMLElement>("[data-reference-id]")
        .forEach((card) => observer.observe(card));
    };
    const grid = document.querySelector<HTMLElement>(".reference-grid");
    if (grid) observeCards(grid);
    const mutations = new MutationObserver((entries) => {
      for (const entry of entries) entry.addedNodes.forEach(observeCards);
      for (const node of visible)
        if (!node.isConnected) {
          visible.delete(node);
          observer.unobserve(node);
        }
    });
    if (grid) mutations.observe(grid, { childList: true, subtree: true });
    const save = () => {
      if (suppress.current || restoring.current || pending.current) return;
      const candidates = Array.from(visible)
        .filter((node) => node.isConnected)
        .map((node) => ({ node, top: node.getBoundingClientRect().top }));
      const headerBottom =
        document.querySelector(".app-header")?.getBoundingClientRect().bottom ??
        80;
      candidates.sort(
        (a, b) =>
          Math.abs(a.top - headerBottom) - Math.abs(b.top - headerBottom),
      );
      const anchor = candidates[0];
      const referenceId = anchor?.node.dataset.referenceId;
      const cursor = referenceId && byId.get(referenceId)?.browseCursor;
      if (!anchor || !referenceId || !cursor) return;
      try {
        if (
          !savePosition(window.localStorage, key, {
            version: 1,
            referenceId,
            cursor,
            viewportTop: anchor.top,
            savedAt: Date.now(),
          })
        )
          setNotice(
            "Your browser could not save this position. It may not survive a reload.",
          );
      } catch {
        setNotice("Position saving is unavailable in this browser.");
      }
    };
    capture.current = save;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          save();
        }, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    const initial = setTimeout(save, 500);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      clearTimeout(timer);
      clearTimeout(initial);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, [key, references, loading]);
  return {
    beginRestore,
    reset,
    notice,
    restoreReferenceId,
    capture: () => capture.current(),
  };
}
