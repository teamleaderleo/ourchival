import { describe, expect, it } from "vitest";
import {
  cleanConversationTitle,
  cleanConversationUrl,
  conversationRevisionCounts,
  importedConversationUrl,
  validateMessageFingerprints,
} from "./conversationImport";

const stable = (identity: string, content: string) =>
  `s:${identity.repeat(32).slice(0, 32)}:${content.repeat(32).slice(0, 32)}`;
const unstable = (identity: string, content: string) =>
  `u:${identity.repeat(32).slice(0, 32)}:${content.repeat(32).slice(0, 32)}`;

describe("conversation import helpers", () => {
  it("cleans titles and web URLs", () => {
    expect(cleanConversationTitle("  Useful   chat  ")).toBe("Useful chat");
    expect(cleanConversationUrl("https://chat.example.com/c/1#message")).toBe(
      "https://chat.example.com/c/1",
    );
    expect(cleanConversationUrl("ourchival://chat/1")).toBeUndefined();
  });

  it("validates legacy and identity/content fingerprints", () => {
    expect(validateMessageFingerprints(["a".repeat(16)], 1)).toEqual([
      "a".repeat(16),
    ]);
    expect(validateMessageFingerprints([stable("a", "b")], 1)).toEqual([
      stable("a", "b"),
    ]);
    expect(() => validateMessageFingerprints([], 1)).toThrow("do not match");
    expect(() => validateMessageFingerprints(["bad"], 1)).toThrow("invalid");
  });

  it("counts legacy added and removed revisions conservatively", () => {
    expect(conversationRevisionCounts(["a", "b"], ["b", "c", "d"])).toEqual({
      addedCount: 2,
      changedCount: 0,
      removedCount: 1,
    });
  });

  it("counts changed messages when stable identity remains", () => {
    expect(
      conversationRevisionCounts(
        [stable("a", "1"), stable("b", "2")],
        [stable("a", "3"), stable("b", "2")],
      ),
    ).toEqual({
      addedCount: 0,
      changedCount: 1,
      removedCount: 0,
    });
  });

  it("keeps inferred identity conservative as add and remove", () => {
    expect(
      conversationRevisionCounts(
        [unstable("a", "1")],
        [unstable("b", "2")],
      ),
    ).toEqual({
      addedCount: 1,
      changedCount: 0,
      removedCount: 1,
    });
  });

  it("mixes stable edits with inferred additions", () => {
    expect(
      conversationRevisionCounts(
        [stable("a", "1"), unstable("x", "5")],
        [stable("a", "2"), unstable("x", "5"), unstable("y", "6")],
      ),
    ).toEqual({
      addedCount: 1,
      changedCount: 1,
      removedCount: 0,
    });
  });

  it("creates stable internal import URLs", () => {
    expect(importedConversationUrl("f".repeat(64))).toBe(
      `https://ourchival.com/imported-conversation/${"f".repeat(32)}`,
    );
  });
});
