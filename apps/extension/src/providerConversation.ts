export type ProviderConversationProvider = "chatgpt" | "claude" | "gemini";

export type ProviderConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "other";

export type ProviderConversationMessage = {
  id: string;
  role: ProviderConversationRole;
  author?: string;
  text: string;
  createdAt?: string;
};

export type ProviderConversationArchive = {
  schemaVersion: 1;
  title: string;
  provider: ProviderConversationProvider;
  providerConversationId: string;
  sourceUrl: string;
  capturedAt: string;
  messages: ProviderConversationMessage[];
};

export type ProviderCaptureDiagnostics = {
  unknownRoleCount: number;
  inferredIdCount: number;
};

export const providerConversationLimits = {
  maxMessages: 5_000,
  maxMessageLength: 200_000,
  maxArchiveCharacters: 4_500_000,
} as const;

export function normalizeProviderMessageText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assertProviderMessageCount(count: number, providerLabel: string) {
  if (count > providerConversationLimits.maxMessages) {
    throw new Error(
      `${providerLabel} rendered more than ${providerConversationLimits.maxMessages.toLocaleString()} messages. Use a provider export or split the capture to avoid a partial archive.`,
    );
  }
}

export function assertProviderMessageLength(text: string, providerLabel: string) {
  if (text.length > providerConversationLimits.maxMessageLength) {
    throw new Error(
      `A visible ${providerLabel} message is too large for browser capture. Use a provider export so it is preserved without truncation.`,
    );
  }
}

export function assertRecognizedProviderRoles(
  messages: ProviderConversationMessage[],
  providerLabel: string,
) {
  if (messages.length > 0 && messages.every((message) => message.role === "other")) {
    throw new Error(
      `${providerLabel} message containers were found, but their roles could not be recognized. The capture adapter may need an update.`,
    );
  }
}

export function providerCaptureDiagnostics(
  messages: ProviderConversationMessage[],
): ProviderCaptureDiagnostics {
  return {
    unknownRoleCount: messages.filter((message) => message.role === "other").length,
    inferredIdCount: messages.filter((message) => message.id.startsWith("captured-")).length,
  };
}

export function stabilizeProviderMessageIds<T extends ProviderConversationMessage>(
  messages: T[],
): T[] {
  const occurrences = new Map<string, number>();
  return messages.map((message) => {
    if (message.id.trim()) return message;
    const base = `captured-${stableFingerprint(
      JSON.stringify({
        role: message.role,
        text: message.text,
      }),
    )}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      ...message,
      id: occurrence === 1 ? base : `${base}-${occurrence}`,
    };
  });
}

export function normalizeProviderMessages<T extends ProviderConversationMessage>(
  messages: T[],
): T[] {
  const stabilized = stabilizeProviderMessageIds(messages);
  const usedIds = new Map<string, string>();
  const normalized: T[] = [];

  for (const message of stabilized) {
    const signature = stableMessageSignature(message);
    const existingSignature = usedIds.get(message.id);
    if (existingSignature === signature) continue;

    let id = message.id;
    if (existingSignature !== undefined) {
      const suffix = stableFingerprint(signature).slice(0, 10);
      id = `${message.id}-${suffix}`;
      let collision = 2;
      while (usedIds.has(id) && usedIds.get(id) !== signature) {
        id = `${message.id}-${suffix}-${collision}`;
        collision += 1;
      }
      if (usedIds.get(id) === signature) continue;
    }

    usedIds.set(id, signature);
    normalized.push(id === message.id ? message : { ...message, id });
  }

  return normalized;
}

export function validateProviderArchive<T extends ProviderConversationArchive>(
  archive: T | undefined,
) {
  if (!archive?.messages.length) return undefined;
  const serialized = JSON.stringify(archive);
  if (serialized.length > providerConversationLimits.maxArchiveCharacters) {
    throw new Error("This visible conversation is too large to capture.");
  }
  return archive;
}

export function cleanProviderConversationTitle(
  documentTitle: string,
  messages: ProviderConversationMessage[],
  providerLabel: string,
) {
  const escaped = providerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = documentTitle
    .replace(new RegExp(`\\s*[–—-]\\s*${escaped}\\s*$`, "i"), "")
    .replace(new RegExp(`^${escaped}\\s*[–—-]\\s*`, "i"), "")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== providerLabel.toLowerCase()) {
    return cleaned.slice(0, 240);
  }
  const firstUser = messages.find((message) => message.role === "user");
  return (
    firstUser?.text.replace(/\s+/g, " ").slice(0, 90) ||
    `${providerLabel} conversation`
  );
}

function stableMessageSignature(message: ProviderConversationMessage) {
  return JSON.stringify({
    role: message.role,
    author: message.author,
    text: message.text,
    createdAt: message.createdAt,
  });
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
