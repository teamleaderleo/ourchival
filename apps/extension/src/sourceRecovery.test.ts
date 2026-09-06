import { expect, test } from "vitest";
import { sourceReaderCanCommit } from "./sourceIntake";

test("late download completion cannot overwrite Stop or a replacement reader", () => {
  expect(sourceReaderCanCommit({ running: true, workerTabId: 10 }, 10)).toBe(true);
  // A request may finish on the server after its reader was closed.
  expect(sourceReaderCanCommit({ running: false }, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true, workerTabId: 11 }, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true, workerTabId: 11 }, 11)).toBe(true);
  expect(sourceReaderCanCommit(undefined, 10)).toBe(false);
  expect(sourceReaderCanCommit({ running: true }, undefined)).toBe(false);
});
