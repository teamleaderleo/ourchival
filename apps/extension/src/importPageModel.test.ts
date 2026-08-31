import { describe, expect, it } from "vitest";
import {
  canChangeImportSource,
  canRetryStreamImport,
  canSelectImportFile,
  createImportIdentificationTicket,
  importPageActions,
  isCurrentImportIdentification,
  importRequestFailureMessage,
  recoverInterruptedImportState,
  shouldPreservePendingImport,
  transitionImportSource,
} from "./importPageModel";
import type { StreamImportState } from "./storage";

function importState(
  patch: Partial<StreamImportState> = {},
): StreamImportState {
  return {
    version: 1,
    sessionKey: `onetab:onetab-1:${"a".repeat(64)}`,
    source: "onetab",
    parserVersion: "onetab-1",
    importDigest: "a".repeat(64),
    filenameHint: "tabs.txt",
    expectedCount: 500,
    checkpointOrdinal: 99,
    savedCount: 90,
    duplicateCount: 10,
    skippedCount: 0,
    failedCount: 0,
    failedOrdinals: [],
    failedEvidence: [],
    status: "error",
    retryable: true,
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...patch,
  };
}

describe("stream import page transitions", () => {
  it("offers retry only for a preserved runnable session and selected file", () => {
    expect(canRetryStreamImport(importState(), true)).toBe(true);
    expect(canRetryStreamImport(importState(), false)).toBe(false);
    expect(canRetryStreamImport(importState({ retryable: false }), true)).toBe(
      false,
    );
    expect(canRetryStreamImport(importState({ sessionKey: "" }), true)).toBe(
      false,
    );
    expect(
      canRetryStreamImport(
        importState({ sessionKey: `onetab:onetab-1:${"b".repeat(64)}` }),
        true,
      ),
    ).toBe(false);
    expect(importPageActions(importState(), true)).toEqual([
      { id: "start", label: "Retry from checkpoint" },
    ]);
    expect(importPageActions(importState({ retryable: false }), true)).toEqual(
      [],
    );
  });

  it("clears a never-started identity when source format changes", () => {
    expect(transitionImportSource<object>("bookmarks", 4)).toEqual({
      selectedSource: "bookmarks",
      generation: 5,
    });
  });

  it("discards identification that resolves after a source transition", async () => {
    const file = {};
    const ticket = createImportIdentificationTicket(2, "onetab", file);
    let resolveIdentity!: () => void;
    const identityReady = new Promise<void>((resolve) => {
      resolveIdentity = resolve;
    });
    const transitioned = transitionImportSource<object>("bookmarks", 2);
    const staleCommit = identityReady.then(() =>
      isCurrentImportIdentification(
        ticket,
        transitioned.generation,
        transitioned.selectedSource,
        transitioned.selectedFile,
      )
        ? importState()
        : undefined,
    );

    resolveIdentity();
    await expect(staleCommit).resolves.toBeUndefined();
    expect(canChangeImportSource(importState({ status: "running" }))).toBe(
      false,
    );
  });

  it("preserves resumable checkpoints while allowing same-file reselection", () => {
    for (const status of ["ready", "paused", "error"] as const) {
      expect(canChangeImportSource(importState({ status }))).toBe(false);
      expect(canSelectImportFile(importState({ status }))).toBe(true);
    }
    expect(canChangeImportSource(importState({ status: "completed" }))).toBe(
      true,
    );
    expect(
      canChangeImportSource(
        importState({ status: "ready", checkpointOrdinal: -1 }),
      ),
    ).toBe(true);
    expect(
      canChangeImportSource(
        importState({ status: "error", checkpointOrdinal: -1 }),
      ),
    ).toBe(true);
    expect(canSelectImportFile(importState({ status: "running" }))).toBe(false);
    expect(shouldPreservePendingImport(importState(), "different")).toBe(true);
    expect(
      shouldPreservePendingImport(
        importState({ checkpointOrdinal: -1 }),
        "different",
      ),
    ).toBe(false);
    expect(
      shouldPreservePendingImport(
        importState({ status: "completed" }),
        "different",
      ),
    ).toBe(false);
    expect(
      shouldPreservePendingImport(importState(), importState().sessionKey),
    ).toBe(false);
  });

  it("recovers a browser-interrupted running state as resumable", () => {
    const recovered = recoverInterruptedImportState(
      importState({ status: "running" }),
    );
    expect(recovered).toMatchObject({
      status: "paused",
      checkpointOrdinal: 99,
      message:
        "Import was interrupted. Select the same file to reconcile the durable checkpoint.",
    });
    expect(recoverInterruptedImportState(importState())).toEqual(importState());
  });

  it("makes retryable response failures explicit about recovery", () => {
    expect(importRequestFailureMessage("Service unavailable.", true)).toBe(
      "Service unavailable. Progress is preserved; retry from the saved checkpoint.",
    );
    expect(importRequestFailureMessage("Progress is preserved.", true)).toBe(
      "Progress is preserved.",
    );
    expect(importRequestFailureMessage("Bad request.", false)).toBe(
      "Bad request.",
    );
  });
});
