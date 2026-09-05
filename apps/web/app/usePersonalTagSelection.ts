"use client";
import { useSyncExternalStore } from "react";

let selected = "";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Keep the same teaching concept while moving between images or opening its editor. */
export function usePersonalTagSelection() {
  const value = useSyncExternalStore(
    subscribe,
    () => selected,
    () => "",
  );
  return [
    value,
    (next: string) => {
      selected = next;
      for (const listener of listeners) listener();
    },
  ] as const;
}
