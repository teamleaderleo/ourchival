export type CapturedConversationRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "other";

export type CapturedConversationMessage = {
  id: string;
  role: CapturedConversationRole;
  author?: string;
  text: string;
  createdAt?: string;
};

export type CapturedConversationArchive = {
  schemaVersion: 1;
  title: string;
  provider: "chatgpt";
  providerConversationId?: string;
  sourceUrl: string;
  capturedAt: string;
  messages: CapturedConversationMessage[];
};

const maxMessages = 5_000;
const maxMessageLength = 200_000;
const maxArchiveCharacters = 4_500_000;

export function captureChatGptConversation(
  document: Document,
  pageUrl: string,
): CapturedConversationArchive | undefined {
  const identity = chatGptConversationIdentity(pageUrl);
  if (!identity) return undefined;
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-author-role]"),
  ).slice(0, maxMessages);
  const messages = nodes
    .map((node, index) => chatGptMessageFromElement(node, index))
    .filter(
      (message): message is CapturedConversationMessage => Boolean(message),
    );
  if (!messages.length) return undefined;

  const archive: CapturedConversationArchive = {
    schemaVersion: 1,
    title: chatGptConversationTitle(document.title, messages),
    provider: "chatgpt",
    ...(identity.conversationId
      ? { providerConversationId: identity.conversationId }
      : {}),
    sourceUrl: identity.sourceUrl,
    capturedAt: new Date().toISOString(),
    messages,
  };
  const serialized = JSON.stringify(archive);
  if (serialized.length > maxArchiveCharacters) {
    throw new Error("This visible ChatGPT conversation is too large to capture.");
  }
  return archive;
}

export function chatGptConversationIdentity(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      host !== "chatgpt.com" &&
      host !== "www.chatgpt.com" &&
      host !== "chat.openai.com"
    ) {
      return undefined;
    }
    const match = url.pathname.match(/(?:^|\/)c\/([^/?#]+)/i);
    if (!match?.[1]) return undefined;
    url.hash = "";
    return {
      conversationId: decodeURIComponent(match[1]),
      sourceUrl: url.toString(),
    };
  } catch {
    return undefined;
  }
}

export function chatGptConversationTitle(
  documentTitle: string,
  messages: CapturedConversationMessage[],
) {
  const cleaned = documentTitle
    .replace(/\s*[–—-]\s*ChatGPT\s*$/i, "")
    .replace(/^ChatGPT\s*[–—-]\s*/i, "")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== "chatgpt") return cleaned.slice(0, 240);
  const firstUser = messages.find((message) => message.role === "user");
  return (
    firstUser?.text.replace(/\s+/g, " ").slice(0, 90) ||
    "ChatGPT conversation"
  );
}

export function normalizeChatGptRole(value: string | undefined): CapturedConversationRole {
  const role = value?.trim().toLowerCase();
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  if (role === "tool") return "tool";
  return "other";
}

function chatGptMessageFromElement(
  node: HTMLElement,
  index: number,
): CapturedConversationMessage | undefined {
  const role = normalizeChatGptRole(node.dataset.messageAuthorRole);
  const text = extractMessageText(node);
  if (!text) return undefined;
  const id =
    firstText(
      node.dataset.messageId,
      node.getAttribute("data-message-id") ?? undefined,
      node.closest<HTMLElement>("[data-message-id]")?.dataset.messageId,
      node.id,
    ) ?? `message-${index + 1}`;
  const createdAt = firstText(
    node.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime,
    node.getAttribute("data-created-at") ?? undefined,
  );
  const model =
    role === "assistant"
      ? firstText(
          node.getAttribute("data-model-slug") ?? undefined,
          node.querySelector<HTMLElement>("[data-model-slug]")?.getAttribute(
            "data-model-slug",
          ) ?? undefined,
        )
      : undefined;
  return {
    id,
    role,
    ...(model ? { author: model } : {}),
    text: text.slice(0, maxMessageLength),
    ...(createdAt ? { createdAt } : {}),
  };
}

function extractMessageText(node: HTMLElement) {
  const candidates = Array.from(
    node.querySelectorAll<HTMLElement>(
      ".markdown, [data-message-content], [class*='whitespace-pre-wrap']",
    ),
  )
    .filter(
      (candidate) =>
        candidate.closest<HTMLElement>("[data-message-author-role]") === node,
    )
    .map((candidate) => normalizeText(candidate.innerText || candidate.textContent || ""))
    .filter(Boolean);
  const longest = candidates.sort((left, right) => right.length - left.length)[0];
  return longest || normalizeText(node.innerText || node.textContent || "");
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}
