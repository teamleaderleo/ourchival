import { describe, expect, it } from "vitest";
import { createBatchSelectionStore } from "./batchSelection";

describe("batch selection store", () => {
  it("selects mounted cards and removes selections when cards unmount", () => {
    const store = createBatchSelectionStore();
    store.register("one");
    store.register("two");
    store.toggle("one");

    expect(store.getSnapshot()).toEqual({
      selectedIds: ["one"],
      mountedIds: ["one", "two"],
    });

    store.unregister("one");
    expect(store.getSnapshot()).toEqual({
      selectedIds: [],
      mountedIds: ["two"],
    });
  });

  it("selects and clears the mounted page", () => {
    const store = createBatchSelectionStore();
    store.register("one");
    store.register("two");
    store.selectAllMounted();
    expect(store.getSnapshot().selectedIds).toEqual(["one", "two"]);

    store.clear();
    expect(store.getSnapshot().selectedIds).toEqual([]);
  });
});
