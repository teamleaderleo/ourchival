import {
  convexMutationUrl,
  type SessionReportConnection,
} from "./sessionReporting";
import type { ProviderConversationArchive } from "./providerConversation";

const maxConversationBytes = 5_000_000;

type ConvexMutationResponse<T> = {
  status?: "success" | "error";
  errorMessage?: string;
  value?: T;
};

type ProviderCaptureResult = {
  conversationId: string;
  referenceId: string;
  snapshotId: string;
  duplicate: boolean;
  addedCount: number;
  changedCount: number;
  removedCount: number;
};

export async function uploadProviderConversation(
  connection: SessionReportConnection,
  archive: ProviderConversationArchive,
) {
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) throw new Error("The configured Convex endpoint is unsupported.");
  const file = new Blob([JSON.stringify(archive)], {
    type: "application/json;charset=utf-8",
  });
  if (file.size < 20 || file.size > maxConversationBytes) {
    throw new Error("The captured conversation is too large to upload.");
  }

  const upload = await callMutation<{ uploadUrl: string }>(
    endpoint,
    "providerConversationCaptures:createUpload",
    { deviceToken: connection.deviceToken },
  );
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
    storageId?: string;
  };
  if (!uploadResponse.ok || !uploadBody.storageId) {
    throw new Error(uploadResponse.statusText || "Conversation file upload failed.");
  }

  const commitArgs = {
    deviceToken: connection.deviceToken,
    storageId: uploadBody.storageId,
    provider: archive.provider,
    providerConversationId: archive.providerConversationId,
    sourceUrl: archive.sourceUrl,
    title: archive.title,
    adapter: `${archive.provider}.dom.v1`,
    messageCount: archive.messages.length,
    messageFingerprints: archive.messages.map(providerMessageFingerprint),
    capturedAt: Date.parse(archive.capturedAt),
  };
  try {
    return await callMutation<ProviderCaptureResult>(
      endpoint,
      "providerConversationCaptures:commitCapture",
      commitArgs,
    );
  } catch (firstError) {
    try {
      return await callMutation<ProviderCaptureResult>(
        endpoint,
        "providerConversationCaptures:commitCapture",
        commitArgs,
      );
    } catch {
      throw firstError;
    }
  }
}

export function providerMessageFingerprint(
  message: ProviderConversationArchive["messages"][number],
) {
  return stableFingerprint(
    JSON.stringify({
      id: message.id,
      role: message.role,
      author: message.author,
      text: message.text,
      createdAt: message.createdAt,
    }),
  );
}

async function callMutation<T>(
  endpoint: string,
  path: string,
  args: Record<string, unknown>,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const body = (await response.json().catch(() => ({}))) as ConvexMutationResponse<T>;
  if (!response.ok || body.status === "error" || body.value === undefined) {
    throw new Error(
      body.errorMessage || response.statusText || "Conversation mutation failed.",
    );
  }
  return body.value;
}

function stableFingerprint(value: string) {
  return [
    hash32(value, 0x811c9dc5),
    hash32(value, 0x9e3779b9),
    hash32(value, 0x85ebca6b),
    hash32(value, 0xc2b2ae35),
  ]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
