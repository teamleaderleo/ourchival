import { describe, expect, it } from "vitest";
import {
  appendOlderReferences,
  boundReferenceWindow,
  prependNewerReferences,
} from "./referenceWindowModel";

const item = (id: string, version = 1) => ({ _id: id, version });

describe("reference window model", () => {
  it("appends older pages in order and deduplicates overlap", () => {
    expect(
      appendOlderReferences(
        [item("a"), item("b", 1)],
        [item("b", 2), item("c")],
      ),
    ).toEqual([item("a"), item("b", 2), item("c")]);
  });

  it("prepends newer pages while preserving newer ordering", () => {
    expect(
      prependNewerReferences(
        [item("c"), item("d")],
        [item("a"), item("b"), item("c", 2)],
      ),
    ).toEqual([item("a"), item("b"), item("c"), item("d")]);
  });

  it("keeps a bounded window around the selected anchor", () => {
    const items = Array.from({ length: 10 }, (_, index) => item(String(index)));
    expect(
      boundReferenceWindow({
        items,
        maxItems: 5,
        anchorId: "6",
      }).map((entry) => entry._id),
    ).toEqual(["4", "5", "6", "7", "8"]);
  });

  it("shifts the bounded window at the start and end", () => {
    const items = Array.from({ length: 8 }, (_, index) => item(String(index)));
    expect(
      boundReferenceWindow({ items, maxItems: 4, anchorId: "0" }).map(
        (entry) => entry._id,
      ),
    ).toEqual(["0", "1", "2", "3"]);
    expect(
      boundReferenceWindow({ items, maxItems: 4, anchorId: "7" }).map(
        (entry) => entry._id,
      ),
    ).toEqual(["4", "5", "6", "7"]);
  });

  it("uses a deterministic newest-first bound when the anchor is absent", () => {
    const items = Array.from({ length: 6 }, (_, index) => item(String(index)));
    expect(
      boundReferenceWindow({ items, maxItems: 3, anchorId: "missing" }).map(
        (entry) => entry._id,
      ),
    ).toEqual(["0", "1", "2"]);
  });
});
