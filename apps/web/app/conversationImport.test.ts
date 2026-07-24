import { describe, expect, it } from "vitest";
import {
  conversationMessageFingerprints,
  parseConversationImport,
  serializeConversationArchive,
} from "./conversationImport";

describe("conversation imports", () => {
  it("parses Markdown speaker sections and preserves code fences", () => {
    const archive = parseConversationImport({
      format: "markdown",
      text: [
        "## User",
        "Write a function.",
        "",
        "## Assistant",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
      provider: "chatgpt",
      title: "Code discussion",
    });
    expect(archive.provider).toBe("chatgpt");
    expect(archive.messages).toHaveLength(2);
    expect(archive.messages[0]).toMatchObject({ role: "user" });
    expect(archive.messages[1]?.text).toContain("const answer = 42");
  });

  it("parses common JSON message forms", () => {
    const archive = parseConversationImport({
      format: "json",
      text: JSON.stringify({
        title: "Imported JSON",
        provider: "Claude",
        conversation_id: "conversation-1",
        messages: [
          { role: "human", content: "Hello" },
          {
            role: "assistant",
            content: [{ type: "text", text: "Hi there" }],
          },
        ],
      }),
    });
    expect(archive.provider).toBe("claude");
    expect(archive.providerConversationId).toBe("conversation-1");
    expect(archive.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("creates stable fingerprints and normalized JSON", () => {
    const archive = parseConversationImport({
      format: "markdown",
      text: "User: Hello\nAssistant: Hi",
    });
    const first = conversationMessageFingerprints(archive);
    const second = conversationMessageFingerprints(archive);
    expect(first).toEqual(second);
    expect(first.every((value) => /^[a-f0-9]{32}$/.test(value))).toBe(true);
    expect(JSON.parse(serializeConversationArchive(archive)).messages).toHaveLength(2);
  });

  it("keeps unmarked text as one message", () => {
    const archive = parseConversationImport({
      format: "markdown",
      text: "A transcript without speaker labels.",
    });
    expect(archive.messages).toEqual([
      expect.objectContaining({ role: "other", text: "A transcript without speaker labels." }),
    ]);
  });
});
