import { describe, expect, it } from "vitest";

import { captureSessionCompletedAt } from "./lib/captureSessions";
import { existingAssetReceipt } from "./httpDb";

describe("captureSessionCompletedAt", () => {
  it("keeps completion time only while the session is complete", () => {
    expect(captureSessionCompletedAt("completed", 123)).toBe(123);
    expect(captureSessionCompletedAt("running", 123)).toBeUndefined();
    expect(captureSessionCompletedAt("interrupted", 123)).toBeUndefined();
  });
});

describe("existingAssetReceipt", () => {
  it("reports an existing Drive original as durably stored", () => {
    expect(
      existingAssetReceipt({
        storageProvider: "google_drive",
        driveFileId: "drive-file",
        fileSize: 176_410,
      }),
    ).toMatchObject({
      storageProvider: "google_drive",
      driveFileId: "drive-file",
      fileSize: 176_410,
    });
  });

  it("keeps legacy URL-only assets distinguishable from stored originals", () => {
    expect(existingAssetReceipt({})).toMatchObject({
      storageProvider: "linked",
      status: "original asset is link-only",
    });
  });
});
