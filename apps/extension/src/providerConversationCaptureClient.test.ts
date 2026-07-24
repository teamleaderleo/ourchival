import { afterEach, describe, expect, it, vi } from "vitest";
import {
  providerMessageFingerprint,
  uploadProviderConversation,
} from "./providerConversationCaptureClient";
import type { ProviderConversationArchive } from "./providerConversation";

const message = {
  id: "provider-message-1",
  role: "assistant" as const,
  author: "claude-sonnet",
  text: "A provider-generic archive should keep stable identity.",
};

const archive: ProviderConversationArchive = {
  schemaVersion: 1,
  title: "Archive design",
  provider: "claude",
  providerConversationId: "conversation-1",
  sourceUrl: "https://claude.ai/chat/conversation-1",
  capturedAt: "2026-07-24T00:00:00.000Z",
  messages: [message],
};

const connection = {
  endpoint: "https://example.convex.site/capture",
  deviceToken: "device-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider conversation fingerprints", () => {
  it("creates stable backend-compatible identity/content fingerprints", () => {
    expect(providerMessageFingerprint(message)).toBe(
      providerMessageFingerprint(message),
    );
    expect(providerMessageFingerprint(message)).toMatch(
      /^s:[a-f0-9]{32}:[a-f0-9]{32}$/,
    );
  });

  it("keeps identity while changing the content fingerprint", () => {
    const before = providerMessageFingerprint(message).split(":");
    const after = providerMessageFingerprint({
      ...message,
      text: `${message.text} Updated.`,
    }).split(":");

    expect(before[1]).toBe(after[1]);
    expect(before[2]).not.toBe(after[2]);
  });
});

describe("provider conversation uploads", () => {
  it("retries an ambiguous commit with the same storage ID", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          value: { uploadUrl: "https://upload.example.test" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ storageId: "storage-1" }))
      .mockRejectedValueOnce(new TypeError("Connection lost after commit"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          value: {
            conversationId: "conversation-row",
            referenceId: "reference-row",
            snapshotId: "snapshot-row",
            duplicate: true,
            addedCount: 0,
            changedCount: 0,
            removedCount: 0,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadProviderConversation(connection, archive);

    expect(result.duplicate).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstCommit = requestBody(fetchMock.mock.calls[2]?.[1]);
    const secondCommit = requestBody(fetchMock.mock.calls[3]?.[1]);
    expect(firstCommit.path).toBe("providerConversationCaptures:commitCapture");
    expect(secondCommit.path).toBe(firstCommit.path);
    expect(secondCommit.args.storageId).toBe("storage-1");
    expect(secondCommit.args).toEqual(firstCommit.args);
    expect(firstCommit.args.adapter).toBe("claude.dom.v2;identity=stable");
    expect(firstCommit.args.messageFingerprints[0]).toMatch(
      /^s:[a-f0-9]{32}:[a-f0-9]{32}$/,
    );
  });

  it("does not retry an explicit Convex rejection", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          value: { uploadUrl: "https://upload.example.test" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ storageId: "storage-1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "error",
          errorMessage: "Conversation provider does not match the source URL.",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadProviderConversation(connection, archive)).rejects.toThrow(
      "Conversation provider does not match the source URL.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body)) as {
    path: string;
    args: {
      storageId: string;
      adapter: string;
      messageFingerprints: string[];
    };
  };
}
