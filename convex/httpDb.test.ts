import { describe, expect, it } from "vitest";

import { captureSessionCompletedAt } from "./lib/captureSessions";
import { existingAssetReceipt, storedAssetFields } from "./httpDb";

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

describe("storedAssetFields", () => {
  it("promotes a linked asset to a fetched Drive rendition", () => {
    expect(
      storedAssetFields({
        storageProvider: "google_drive",
        fetchedUrl: "https://i.pinimg.com/1200x/a/b/c.jpg",
        driveFileId: "drive-file",
        fileSize: 123,
      }),
    ).toMatchObject({
      storageProvider: "google_drive",
      fetchedUrl: "https://i.pinimg.com/1200x/a/b/c.jpg",
      driveFileId: "drive-file",
      fileSize: 123,
    });
  });
});
