import { describe, expect, it } from "vitest";
import {
  createReferenceUndoMove,
  mergeRestoredReference,
  restoredReferenceView,
} from "./referenceUndoState";
import type { SavedReference } from "./referenceVaultModel";

const inboxReference: SavedReference = {
  _id: "reference-1",
  kind: "link",
  title: "Archive this later",
  sourceUrl: "https://example.com/reference",
  platform: "generic",
  capturedAt: 1,
  triageState: "inbox",
  archived: false,
  deleted: false,
  favorite: false,
  assets: [],
};

describe("reference undo state", () => {
  it("keeps both sides of a move when the card leaves the loaded page", () => {
    const undo = createReferenceUndoMove(inboxReference, {
      reviewedAt: 100,
      archived: true,
      deleted: true,
    });

    expect(undo.before).toEqual(inboxReference);
    expect(undo.after).toMatchObject({
      reviewedAt: 100,
      archived: true,
      deleted: true,
    });
    expect(restoredReferenceView(undo.after)).toBe("trash");
  });

  it("restores the original collection and optional fields", () => {
    const undo = createReferenceUndoMove(inboxReference, {
      triageState: "kept",
      reviewedAt: 100,
      archived: false,
      deleted: false,
    });
    const restored = mergeRestoredReference(undo, {
      triageState: "inbox",
      reviewedAt: undefined,
      archived: false,
      deleted: false,
    });

    expect(restored.triageState).toBe("inbox");
    expect(restored.reviewedAt).toBeUndefined();
    expect(restoredReferenceView(restored)).toBe("inbox");
  });

  it("returns restored Library items to the all view", () => {
    const kept = { ...inboxReference, triageState: "kept" as const };
    expect(restoredReferenceView(kept)).toBe("all");
  });
});
