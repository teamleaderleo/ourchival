import { describe, expect, it } from "vitest";
import {
  claudeConversationIdentity,
  normalizeClaudeRole,
} from "./claudeConversation";
import {
  geminiConversationIdentity,
  normalizeGeminiRole,
} from "./geminiConversation";
import {
  cleanProviderConversationTitle,
  stabilizeProviderMessageIds,
  validateProviderArchive,
  type ProviderConversationArchive,
} from "./providerConversation";

const archive: ProviderConversationArchive = {
  schemaVersion: 1,
  title: "Conversation",
  provider: "claude",
  providerConversationId: "conversation-1",
  sourceUrl: "https://claude.ai/chat/conversation-1",
  capturedAt: "2026-07-24T00:00:00.000Z",
  messages: [{ id: "one", role: "user", text: "Plan the archive" }],
};

describe("provider conversation adapters", () => {
  it("extracts canonical Claude conversation identity", () => {
    expect(
      claudeConversationIdentity(
        "https://claude.ai/chat/abc-123?utm_source=test#message",
      ),
    ).toEqual({
      conversationId: "abc-123",
      sourceUrl: "https://claude.ai/chat/abc-123",
    });
    expect(claudeConversationIdentity("https://claude.ai/new")).toBeUndefined();
  });

  it("extracts canonical Gemini conversation identity", () => {
    expect(
      geminiConversationIdentity("https://gemini.google.com/app/xyz-789?hl=en#response"),
    ).toEqual({
      conversationId: "xyz-789",
      sourceUrl: "https://gemini.google.com/app/xyz-789",
    });
    expect(geminiConversationIdentity("https://gemini.google.com/app")).toBeUndefined();
  });

  it("normalizes provider roles", () => {
    expect(normalizeClaudeRole("font-user-message")).toBe("user");
    expect(normalizeClaudeRole("font-claude-message")).toBe("assistant");
    expect(normalizeGeminiRole("USER-QUERY")).toBe("user");
    expect(normalizeGeminiRole("MODEL-RESPONSE")).toBe("assistant");
  });

  it("derives a title and validates bounded archives", () => {
    expect(
      cleanProviderConversationTitle("Project notes - Claude", archive.messages, "Claude"),
    ).toBe("Project notes");
    expect(validateProviderArchive(archive)).toEqual(archive);
    expect(validateProviderArchive({ ...archive, messages: [] })).toBeUndefined();
  });

  it("creates stable fallback IDs without collapsing repeated messages", () => {
    const first = stabilizeProviderMessageIds([
      { id: "", role: "user" as const, text: "Repeat this" },
      { id: "", role: "assistant" as const, text: "Done" },
      { id: "", role: "user" as const, text: "Repeat this" },
    ]);
    const second = stabilizeProviderMessageIds([
      { id: "known", role: "system" as const, text: "Inserted earlier" },
      { id: "", role: "user" as const, text: "Repeat this" },
      { id: "", role: "assistant" as const, text: "Done" },
      { id: "", role: "user" as const, text: "Repeat this" },
    ]);

    expect(first[0]?.id).toBe(second[1]?.id);
    expect(first[1]?.id).toBe(second[2]?.id);
    expect(first[2]?.id).toBe(second[3]?.id);
    expect(first[0]?.id).not.toBe(first[2]?.id);
  });
});
