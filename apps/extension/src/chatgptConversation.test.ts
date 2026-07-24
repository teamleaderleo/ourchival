import { describe, expect, it } from "vitest";
import {
  chatGptConversationIdentity,
  chatGptConversationTitle,
  normalizeChatGptRole,
  type CapturedConversationMessage,
} from "./chatgptConversation";

const messages: CapturedConversationMessage[] = [
  {
    id: "one",
    role: "user",
    text: "Design a durable archive for my conversations",
  },
  {
    id: "two",
    role: "assistant",
    text: "Here is a plan.",
  },
];

describe("ChatGPT conversation capture", () => {
  it("extracts conversation identity from supported URLs", () => {
    expect(
      chatGptConversationIdentity("https://chatgpt.com/c/abc-123#message"),
    ).toEqual({
      conversationId: "abc-123",
      sourceUrl: "https://chatgpt.com/c/abc-123",
    });
    expect(
      chatGptConversationIdentity("https://chat.openai.com/c/old-id"),
    ).toEqual({
      conversationId: "old-id",
      sourceUrl: "https://chat.openai.com/c/old-id",
    });
    expect(chatGptConversationIdentity("https://chatgpt.com/")).toBeUndefined();
    expect(
      chatGptConversationIdentity("https://example.com/c/abc-123"),
    ).toBeUndefined();
  });

  it("normalizes visible author roles", () => {
    expect(normalizeChatGptRole("user")).toBe("user");
    expect(normalizeChatGptRole("assistant")).toBe("assistant");
    expect(normalizeChatGptRole("tool")).toBe("tool");
    expect(normalizeChatGptRole("unknown")).toBe("other");
  });

  it("uses the document title when useful", () => {
    expect(chatGptConversationTitle("Archive design - ChatGPT", messages)).toBe(
      "Archive design",
    );
  });

  it("falls back to the first user message", () => {
    expect(chatGptConversationTitle("ChatGPT", messages)).toBe(
      "Design a durable archive for my conversations",
    );
  });
});
