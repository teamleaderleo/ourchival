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
  "user-query",
  "model-response",
  '[data-test-id="user-query"]',
  '[data-test-id="model-response"]',
  ".user-query",
  ".model-response",
].join(",");

export function captureGeminiConversation(
  document: Document,
  pageUrl: string,
): ProviderConversationArchive | undefined {
  const identity = geminiConversationIdentity(pageUrl);
  if (!identity) return undefined;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(messageSelector))
    .filter((node) => !node.parentElement?.closest(messageSelector))
    .slice(0, providerConversationLimits.maxMessages);
  const messages = nodes
    .map((node, index) => geminiMessageFromElement(node, index))
    .filter((message): message is ProviderConversationMessage => Boolean(message));
  return validateProviderArchive({
    schemaVersion: 1,
    title: cleanProviderConversationTitle(document.title, messages, "Gemini"),
    provider: "gemini",
    providerConversationId: identity.conversationId,
    sourceUrl: identity.sourceUrl,
    capturedAt: new Date().toISOString(),
    messages,
  });
}

export function geminiConversationIdentity(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "gemini.google.com") return undefined;
    const match = url.pathname.match(/(?:^|\/)app\/([^/?#]+)/i);
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

export function normalizeGeminiRole(
  value: string | undefined,
): ProviderConversationRole {
  const role = value?.toLowerCase() ?? "";
  if (role.includes("user") || role.includes("query")) return "user";
  if (role.includes("model") || role.includes("response")) return "assistant";
  if (role.includes("system")) return "system";
  if (role.includes("tool")) return "tool";
  return "other";
}

function geminiMessageFromElement(
  node: HTMLElement,
  index: number,
): ProviderConversationMessage | undefined {
  const role = normalizeGeminiRole(
    [node.tagName, node.dataset.testId, node.className]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  const text = extractGeminiText(node);
  if (!text) return undefined;
  const id =
    firstText(
      node.dataset.messageId,
      node.getAttribute("data-message-id") ?? undefined,
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

function extractGeminiText(node: HTMLElement) {
  const candidates = Array.from(
    node.querySelectorAll<HTMLElement>(
      '.query-text, .response-container-content, .markdown, [data-test-id="response-content"]',
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
