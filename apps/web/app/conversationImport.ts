export type ConversationProvider =
  | "generic"
  | "chatgpt"
  | "claude"
  | "gemini";

export type ConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "other";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  author?: string;
  text: string;
  createdAt?: string;
};

export type ConversationArchive = {
  schemaVersion: 1;
  title: string;
  provider: ConversationProvider;
  providerConversationId?: string;
  sourceUrl?: string;
  capturedAt: string;
  messages: ConversationMessage[];
};

export type ConversationImportFormat = "json" | "markdown";

type ParsedConversation = {
  title?: string;
  provider?: ConversationProvider;
  providerConversationId?: string;
  sourceUrl?: string;
  messages: ConversationMessage[];
};

const maxMessages = 5_000;
const maxMessageLength = 200_000;
const maxArchiveCharacters = 4_500_000;
const speakerLine = /^(?:#{1,6}\s*)?(?:\*\*)?(user|assistant|system|tool|human|claude|chatgpt|gemini)(?:\*\*)?\s*:?\s*(.*)$/i;

export function parseConversationImport(args: {
  text: string;
  format: ConversationImportFormat;
  title?: string;
  provider?: ConversationProvider;
  providerConversationId?: string;
  sourceUrl?: string;
}): ConversationArchive {
  const source = args.text.trim();
  if (!source) throw new Error("Paste a conversation before importing.");
  if (source.length > maxArchiveCharacters) {
    throw new Error("Conversation text is too large for this import path.");
  }

  const parsed: ParsedConversation = args.format === "json"
    ? parseJsonConversation(source)
    : parseMarkdownConversation(source);
  const messages = parsed.messages.slice(0, maxMessages).map((message, index) => ({
    ...message,
    id: message.id || `message-${index + 1}`,
    text: message.text.slice(0, maxMessageLength),
  }));
  if (!messages.length) throw new Error("No conversation messages were found.");
  if (parsed.messages.length > maxMessages) {
    throw new Error(`Conversation contains more than ${maxMessages} messages.`);
  }

  const provider = args.provider ?? parsed.provider ?? "generic";
  const title = cleanTitle(
    args.title ?? parsed.title ?? deriveTitle(messages),
  );
  const providerConversationId = cleanOptional(
    args.providerConversationId ?? parsed.providerConversationId,
  );
  const sourceUrl = cleanWebUrl(args.sourceUrl ?? parsed.sourceUrl);
  return {
    schemaVersion: 1,
    title,
    provider,
    ...(providerConversationId ? { providerConversationId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    capturedAt: new Date().toISOString(),
    messages,
  };
}

export function conversationMessageFingerprints(
  archive: ConversationArchive,
) {
  return archive.messages.map((message) =>
    stableFingerprint(
      JSON.stringify({
        id: message.id,
        role: message.role,
        author: message.author,
        text: message.text,
        createdAt: message.createdAt,
      }),
    ),
  );
}

export function serializeConversationArchive(archive: ConversationArchive) {
  return JSON.stringify(archive);
}

function parseJsonConversation(source: string): ParsedConversation {
  let root: any;
  try {
    root = JSON.parse(source);
  } catch {
    throw new Error("Conversation JSON could not be parsed.");
  }
  const rawMessages = Array.isArray(root)
    ? root
    : firstArray(root?.messages, root?.conversation, root?.items, root?.chat?.messages);
  if (!rawMessages) throw new Error("Conversation JSON has no message array.");
  const messages = rawMessages
    .map((value: any, index: number) => normalizeJsonMessage(value, index))
    .filter((value: ConversationMessage | undefined): value is ConversationMessage =>
      Boolean(value),
    );
  return {
    title: stringValue(root?.title, root?.name, root?.conversation_title),
    provider: normalizeProvider(
      stringValue(root?.provider, root?.source, root?.platform),
    ),
    providerConversationId: stringValue(
      root?.providerConversationId,
      root?.conversation_id,
      root?.conversationId,
      root?.id,
    ),
    sourceUrl: stringValue(root?.sourceUrl, root?.url, root?.canonical_url),
    messages,
  };
}

function normalizeJsonMessage(
  value: any,
  index: number,
): ConversationMessage | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text
      ? { id: `message-${index + 1}`, role: "other", text }
      : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const text = messageText(
    value.text,
    value.content,
    value.message,
    value.body,
    value.parts,
  );
  if (!text) return undefined;
  const role = normalizeRole(
    stringValue(
      value.role,
      value.sender,
      value.type,
      value.author?.role,
      value.author?.name,
    ),
  );
  const author = cleanOptional(
    stringValue(value.authorName, value.name, value.author?.name),
  );
  const createdAt = cleanOptional(
    stringValue(value.createdAt, value.created_at, value.timestamp, value.time),
  );
  return {
    id: cleanOptional(stringValue(value.id, value.message_id, value.uuid)) ??
      `message-${index + 1}`,
    role,
    ...(author ? { author } : {}),
    text: text.slice(0, maxMessageLength),
    ...(createdAt ? { createdAt } : {}),
  };
}

function parseMarkdownConversation(source: string): ParsedConversation {
  const messages: ConversationMessage[] = [];
  let role: ConversationRole = "other";
  let author: string | undefined;
  let lines: string[] = [];
  let inFence = false;

  function flush() {
    const text = lines.join("\n").trim();
    if (text) {
      messages.push({
        id: `message-${messages.length + 1}`,
        role,
        ...(author ? { author } : {}),
        text: text.slice(0, maxMessageLength),
      });
    }
    lines = [];
  }

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      lines.push(line);
      continue;
    }
    const match = inFence ? null : speakerLine.exec(trimmed);
    if (match) {
      flush();
      role = normalizeRole(match[1]);
      author = speakerAuthor(match[1]);
      if (match[2]?.trim()) lines.push(match[2].trim());
      continue;
    }
    lines.push(line);
  }
  flush();
  return { messages };
}

function messageText(...values: any[]): string | undefined {
  for (const value of values) {
    const text = textFromValue(value).trim();
    if (text) return text;
  }
  return undefined;
}

function textFromValue(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(textFromValue).filter(Boolean).join("\n\n");
  }
  if (!value || typeof value !== "object") return "";
  return textFromValue(
    value.text ?? value.value ?? value.content ?? value.parts ?? "",
  );
}

function normalizeRole(value: string | undefined): ConversationRole {
  const role = value?.trim().toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (
    role === "assistant" ||
    role === "claude" ||
    role === "chatgpt" ||
    role === "gemini"
  ) return "assistant";
  if (role === "system") return "system";
  if (role === "tool" || role === "function") return "tool";
  return "other";
}

function speakerAuthor(value: string | undefined) {
  const speaker = value?.trim();
  const role = normalizeRole(speaker);
  return role === "assistant" && speaker && speaker.toLowerCase() !== "assistant"
    ? speaker
    : undefined;
}

function normalizeProvider(value: string | undefined): ConversationProvider | undefined {
  const provider = value?.trim().toLowerCase();
  if (provider?.includes("chatgpt") || provider === "openai") return "chatgpt";
  if (provider?.includes("claude") || provider === "anthropic") return "claude";
  if (provider?.includes("gemini") || provider === "google") return "gemini";
  if (provider === "generic") return "generic";
  return undefined;
}

function deriveTitle(messages: ConversationMessage[]) {
  const firstUser = messages.find((message) => message.role === "user") ?? messages[0];
  return firstUser?.text.replace(/\s+/g, " ").slice(0, 90) || "Imported conversation";
}

function cleanTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 240) || "Imported conversation";
}

function cleanOptional(value: string | undefined) {
  return value?.trim() || undefined;
}

function cleanWebUrl(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function stringValue(...values: any[]) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function firstArray(...values: any[]) {
  return values.find(Array.isArray) as any[] | undefined;
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
