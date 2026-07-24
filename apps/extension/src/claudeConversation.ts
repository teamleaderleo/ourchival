import {
  cleanProviderConversationTitle,
  normalizeProviderMessageText,
  providerConversationLimits,
  validateProviderArchive,
  type ProviderConversationArchive,
  type ProviderConversationMessage,
  type ProviderConversationRole,
} from "./providerConversation";

const messageSelector = [
  '[data-testid="user-message"]',
  '[data-testid="human-message"]',
  '[data-testid="assistant-message"]',
  '[data-message-author-role]',
  '.font-user-message',
  '.font-claude-message',
].join(",");

export function captureClaudeConversation(
  document: Document,
  pageUrl: string,
): ProviderConversationArchive | undefined {
  const identity = claudeConversationIdentity(pageUrl);
  if (!identity) return undefined;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(messageSelector))
    .filter((node) => !node.parentElement?.closest(messageSelector))
    .slice(0, providerConversationLimits.maxMessages);
  const messages = nodes
    .map((node, index) => claudeMessageFromElement(node, index))
    .filter((message): message is ProviderConversationMessage => Boolean(message));
  return validateProviderArchive({
    schemaVersion: 1,
    title: cleanProviderConversationTitle(document.title, messages, "Claude"),
    provider: "claude",
    providerConversationId: identity.conversationId,
    sourceUrl: identity.sourceUrl,
    capturedAt: new Date().toISOString(),
    messages,
  });
}

export function claudeConversationIdentity(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "claude.ai" && host !== "www.claude.ai") return undefined;
    const match = url.pathname.match(/(?:^|\/)chat\/([^/?#]+)/i);
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

export function normalizeClaudeRole(
  value: string | undefined,
): ProviderConversationRole {
  const role = value?.toLowerCase() ?? "";
  if (role.includes("user") || role.includes("human")) return "user";
  if (role.includes("assistant") || role.includes("claude")) return "assistant";
  if (role.includes("system")) return "system";
  if (role.includes("tool")) return "tool";
  return "other";
}

function claudeMessageFromElement(
  node: HTMLElement,
  index: number,
): ProviderConversationMessage | undefined {
  const role = normalizeClaudeRole(
    [
      node.dataset.messageAuthorRole,
      node.dataset.testid,
      node.className,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  const text = extractClaudeText(node);
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
          node.getAttribute("data-model") ?? undefined,
          node.querySelector<HTMLElement>("[data-model]")?.getAttribute("data-model") ??
            undefined,
        )
      : undefined;
  return {
    id,
    role,
    ...(model ? { author: model } : {}),
    text: text.slice(0, providerConversationLimits.maxMessageLength),
    ...(createdAt ? { createdAt } : {}),
  };
}

function extractClaudeText(node: HTMLElement) {
  const candidates = Array.from(
    node.querySelectorAll<HTMLElement>(
      '.font-user-message, .font-claude-message, .prose, [data-testid="message-content"]',
    ),
  )
    .filter((candidate) => candidate.closest(messageSelector) === node)
    .map((candidate) =>
      normalizeProviderMessageText(candidate.innerText || candidate.textContent || ""),
    )
    .filter(Boolean);
  return (
    candidates.sort((left, right) => right.length - left.length)[0] ||
    normalizeProviderMessageText(node.innerText || node.textContent || "")
  );
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}
