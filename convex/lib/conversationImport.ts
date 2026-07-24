export type ConversationProvider =
  | "generic"
  | "chatgpt"
  | "claude"
  | "gemini";

export function cleanConversationTitle(value: string) {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Conversation title is required.");
  return title.slice(0, 240);
}

export function cleanConversationIdentity(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

export function cleanConversationUrl(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function validateMessageFingerprints(
  values: string[],
  messageCount: number,
) {
  if (!Number.isInteger(messageCount) || messageCount < 1 || messageCount > 5_000) {
    throw new Error("Conversation message count is invalid.");
  }
  if (values.length !== messageCount) {
    throw new Error("Conversation message fingerprints do not match the message count.");
  }
  const cleaned = values.map((value) => value.trim().toLowerCase());
  if (cleaned.some((value) => !/^[a-f0-9]{16,64}$/.test(value))) {
    throw new Error("Conversation message fingerprint is invalid.");
  }
  return cleaned;
}

export function conversationRevisionCounts(
  previous: string[],
  next: string[],
) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    addedCount: next.filter((value) => !previousSet.has(value)).length,
    changedCount: 0,
    removedCount: previous.filter((value) => !nextSet.has(value)).length,
  };
}

export function importedConversationUrl(contentHash: string) {
  return `https://ourchival.com/imported-conversation/${contentHash.slice(0, 32)}`;
}

export function validCapturedAt(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
