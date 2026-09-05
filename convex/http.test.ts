import { describe, expect, it } from "vitest";

import { duplicateAssetReceipt } from "./http";

describe("duplicateAssetReceipt", () => {
  it("preserves an existing durable-asset receipt when no refetch is needed", () => {
    const existing = {
      storageProvider: "google_drive",
      status: "original asset already stored in Google Drive",
      driveFileId: "drive-file",
    };

    expect(duplicateAssetReceipt(undefined, existing)).toBe(existing);
  });

  it("reports a newly fetched replacement when a linked asset is promoted", () => {
    const existing = { storageProvider: "linked" };
    const fetched = {
      storageProvider: "google_drive",
      driveFileId: "drive-file",
    };

    expect(duplicateAssetReceipt(fetched, existing)).toBe(fetched);
  });
});
