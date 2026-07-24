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
  assertRecognizedProviderRoles,
  cleanProviderConversationTitle,
  normalizeProviderMessages,
  providerCaptureDiagnostics,
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

  it("drops exact duplicate DOM messages with the same provider ID", () => {
    const normalized = normalizeProviderMessages([
      { id: "provider-1", role: "user" as const, text: "Keep this once" },
      { id: "provider-1", role: "user" as const, text: "Keep this once" },
      { id: "provider-2", role: "assistant" as const, text: "A distinct reply" },
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized.map((message) => message.id)).toEqual([
      "provider-1",
      "provider-2",
    ]);
  });

  it("resolves conflicting provider IDs deterministically", () => {
    const messages = [
      { id: "provider-1", role: "assistant" as const, text: "First render" },
      { id: "provider-1", role: "assistant" as const, text: "Updated render" },
    ];

    const first = normalizeProviderMessages(messages);
    const second = normalizeProviderMessages(messages);

    expect(first).toEqual(second);
    expect(first[0]?.id).toBe("provider-1");
    expect(first[1]?.id).toMatch(/^provider-1-[a-f0-9]{10}$/);
  });

  it("reports inferred IDs and unrecognized roles", () => {
    expect(
      providerCaptureDiagnostics([
        { id: "captured-abc", role: "other", text: "Unknown container" },
        { id: "provider-2", role: "assistant", text: "Recognized reply" },
      ]),
    ).toEqual({
      unknownRoleCount: 1,
      inferredIdCount: 1,
    });
  });

  it("rejects captures where every message role is unrecognized", () => {
    expect(() =>
      assertRecognizedProviderRoles(
        [{ id: "one", role: "other", text: "Unrecognized" }],
        "Claude",
      ),
    ).toThrow("roles could not be recognized");

    expect(() =>
      assertRecognizedProviderRoles(
        [{ id: "one", role: "user", text: "Recognized" }],
        "Claude",
      ),
    ).not.toThrow();
  });
});
