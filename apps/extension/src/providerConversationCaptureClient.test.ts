import { describe, expect, it } from "vitest";
import { providerMessageFingerprint } from "./providerConversationCaptureClient";

const message = {
  id: "message-1",
  role: "assistant" as const,
  author: "claude-sonnet",
  text: "A provider-generic archive should keep stable identity.",
};

describe("provider conversation fingerprints", () => {
  it("creates stable backend-compatible fingerprints", () => {
    expect(providerMessageFingerprint(message)).toBe(
      providerMessageFingerprint(message),
    );
    expect(providerMessageFingerprint(message)).toMatch(/^[a-f0-9]{32}$/);
  });

  it("changes when message content changes", () => {
    expect(providerMessageFingerprint(message)).not.toBe(
      providerMessageFingerprint({ ...message, text: `${message.text} Updated.` }),
    );
  });
});
