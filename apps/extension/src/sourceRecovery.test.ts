import { expect, test } from "vitest";
import { detectSourceIntakeContext, originalDownloadFailure, sourceReaderCanCommit } from "./sourceIntake";

test("Pixiv bookmark URLs without the English prefix resume the same source", () => {
  const english = detectSourceIntakeContext("https://www.pixiv.net/en/users/42/bookmarks/artworks?rest=show&mode=all");
  const plain = detectSourceIntakeContext("https://www.pixiv.net/users/42/bookmarks/artworks?rest=show&mode=all&p=19");
  expect(plain?.sourceUrl).toBe(english?.sourceUrl);
  expect(plain?.cursor).toBe("page:19");
});

test("link-only image results stop Pixiv while durable duplicates and metadata-only gaps do not", () => {
  expect(originalDownloadFailure("pixiv_bookmarks", true, { storageProvider: "linked", storageStatus: "Google Drive needs reconnection" })).toBe("Google Drive needs reconnection");
  expect(originalDownloadFailure("pixiv_bookmarks", true, { storageProvider: "google_drive" })).toBeUndefined();
  expect(originalDownloadFailure("pixiv_bookmarks", false, { storageProvider: "linked" })).toBeUndefined();
  expect(originalDownloadFailure("pixiv_bookmarks", true, { blocked: true, storageProvider: "linked" })).toBeUndefined();
  expect(originalDownloadFailure("pinterest_board", true, { storageProvider: "linked" })).toBeUndefined();
});

test("late download completion cannot overwrite Stop or a replacement reader", () => {
  expect(sourceReaderCanCommit({ running: true, workerTabId: 10 }, 10)).toBe(true);
  // A request may finish on the server after its reader was closed.
  expect(sourceReaderCanCommit({ running: false }, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true, workerTabId: 11 }, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true, workerTabId: 11 }, 11)).toBe(true);
  expect(sourceReaderCanCommit(undefined, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true }, undefined)).toBe(false);
});
