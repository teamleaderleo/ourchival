export type ConversationProvider =
  | "generic"
  | "chatgpt"
  | "claude"
  | "gemini";

type ParsedFingerprint = {
  stable: boolean;
  identity: string;
  content: string;
};

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
  if (
    cleaned.some(
      (value) =>
        !/^[a-f0-9]{16,64}$/.test(value) &&
        !/^[su]:[a-f0-9]{32}:[a-f0-9]{32}$/.test(value),
    )
  ) {
    throw new Error("Conversation message fingerprint is invalid.");
  }
  return cleaned;
}

export function conversationRevisionCounts(
  previous: string[],
  next: string[],
) {
  const previousParsed = parseFingerprintSet(previous);
  const nextParsed = parseFingerprintSet(next);
  if (!previousParsed || !nextParsed) {
    return legacyRevisionCounts(previous, next);
  }

  const previousStable = new Map(
    previousParsed
      .filter((value) => value.stable)
      .map((value) => [value.identity, value.content]),
  );
  const nextStable = new Map(
    nextParsed
      .filter((value) => value.stable)
      .map((value) => [value.identity, value.content]),
  );
  const previousUnstable = new Set(
    previousParsed
      .filter((value) => !value.stable)
      .map((value) => `${value.identity}:${value.content}`),
  );
  const nextUnstable = new Set(
    nextParsed
      .filter((value) => !value.stable)
      .map((value) => `${value.identity}:${value.content}`),
  );

  let addedCount = 0;
  let changedCount = 0;
  let removedCount = 0;

  for (const [identity, content] of nextStable) {
    const previousContent = previousStable.get(identity);
    if (previousContent === undefined) addedCount += 1;
    else if (previousContent !== content) changedCount += 1;
  }
  for (const identity of previousStable.keys()) {
    if (!nextStable.has(identity)) removedCount += 1;
  }
  for (const value of nextUnstable) {
    if (!previousUnstable.has(value)) addedCount += 1;
  }
  for (const value of previousUnstable) {
    if (!nextUnstable.has(value)) removedCount += 1;
  }

  return { addedCount, changedCount, removedCount };
}

export function importedConversationUrl(contentHash: string) {
  return `https://ourchival.com/imported-conversation/${contentHash.slice(0, 32)}`;
}

export function validCapturedAt(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function parseFingerprintSet(values: string[]) {
  const parsed = values.map(parseFingerprint);
  return parsed.every((value): value is ParsedFingerprint => Boolean(value))
    ? parsed
    : undefined;
}

function parseFingerprint(value: string): ParsedFingerprint | undefined {
  const match = value.match(/^([su]):([a-f0-9]{32}):([a-f0-9]{32})$/);
  if (!match) return undefined;
  return {
    stable: match[1] === "s",
    identity: match[2]!,
    content: match[3]!,
  };
}

function legacyRevisionCounts(previous: string[], next: string[]) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    addedCount: next.filter((value) => !previousSet.has(value)).length,
    changedCount: 0,
    removedCount: previous.filter((value) => !nextSet.has(value)).length,
  };
}
