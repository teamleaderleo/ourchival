"use client";

import { useEffect, useSyncExternalStore } from "react";

type SelectionSnapshot = {
  selectedIds: string[];
  mountedIds: string[];
};

type SelectionStore = ReturnType<typeof createBatchSelectionStore>;

export function createBatchSelectionStore() {
  const selected = new Set<string>();
  const mounted = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: SelectionSnapshot = { selectedIds: [], mountedIds: [] };

  function publish() {
    snapshot = {
      selectedIds: Array.from(selected),
      mountedIds: Array.from(mounted),
    };
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    register(referenceId: string) {
      if (mounted.has(referenceId)) return;
      mounted.add(referenceId);
      publish();
    },
    unregister(referenceId: string) {
      const changed = mounted.delete(referenceId) || selected.delete(referenceId);
      if (changed) publish();
    },
    toggle(referenceId: string) {
      if (!mounted.has(referenceId)) return;
      if (selected.has(referenceId)) selected.delete(referenceId);
      else selected.add(referenceId);
      publish();
    },
    selectAllMounted() {
      for (const referenceId of mounted) selected.add(referenceId);
      publish();
    },
    clear() {
      if (selected.size === 0) return;
      selected.clear();
      publish();
    },
  };
}

const store: SelectionStore = createBatchSelectionStore();
const emptySnapshot: SelectionSnapshot = { selectedIds: [], mountedIds: [] };

export function useBatchSelection() {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => emptySnapshot,
  );
  return {
    ...snapshot,
    clear: store.clear,
    selectAllMounted: store.selectAllMounted,
  };
}

export function useBatchSelectionItem(referenceId: string) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => emptySnapshot,
  );

  useEffect(() => {
    store.register(referenceId);
    return () => store.unregister(referenceId);
  }, [referenceId]);

  return {
    selected: snapshot.selectedIds.includes(referenceId),
    toggle: () => store.toggle(referenceId),
  };
}
