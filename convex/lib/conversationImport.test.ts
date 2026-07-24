import { describe, expect, it } from "vitest";
import {
  cleanConversationTitle,
  cleanConversationUrl,
  conversationRevisionCounts,
  importedConversationUrl,
  validateMessageFingerprints,
} from "./conversationImport";

describe("conversation import helpers", () => {
  it("cleans titles and web URLs", () => {
    expect(cleanConversationTitle("  Useful   chat  ")).toBe("Useful chat");
    expect(cleanConversationUrl("https://chat.example.com/c/1#message")).toBe(
      "https://chat.example.com/c/1",
    );
    expect(cleanConversationUrl("ourchival://chat/1")).toBeUndefined();
  });

  it("validates one fingerprint per message", () => {
    expect(validateMessageFingerprints(["a".repeat(16)], 1)).toEqual([
      "a".repeat(16),
    ]);
    expect(() => validateMessageFingerprints([], 1)).toThrow("do not match");
    expect(() => validateMessageFingerprints(["bad"], 1)).toThrow("invalid");
  });

  it("counts added and removed message revisions", () => {
    expect(conversationRevisionCounts(["a", "b"], ["b", "c", "d"])).toEqual({
      addedCount: 2,
      changedCount: 0,
      removedCount: 1,
    });
  });

  it("creates stable internal import URLs", () => {
    expect(importedConversationUrl("f".repeat(64))).toBe(
      `https://ourchival.com/imported-conversation/${"f".repeat(32)}`,
    );
  });
});
