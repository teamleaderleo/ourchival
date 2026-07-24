import { describe, expect, it } from "vitest";
import { messageFingerprint } from "./conversationCaptureClient";

const message = {
  id: "message-1",
  role: "assistant" as const,
  author: "gpt-5",
  text: "A durable archive needs stable identity.",
  createdAt: "2026-07-24T00:00:00.000Z",
};

describe("conversation capture fingerprints", () => {
  it("creates stable backend-compatible fingerprints", () => {
    expect(messageFingerprint(message)).toBe(messageFingerprint(message));
    expect(messageFingerprint(message)).toMatch(/^[a-f0-9]{32}$/);
  });

  it("changes when captured message content changes", () => {
    expect(messageFingerprint(message)).not.toBe(
      messageFingerprint({ ...message, text: `${message.text} Updated.` }),
    );
  });
});
