import type {
  PageReadableTextCapture,
  PageReadableTextSource,
} from "@ourchival/shared";

const maxReadableTextLength = 120_000;
const minReadableTextLength = 80;
const removableSelector = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  '[aria-hidden="true"]',
].join(",");

export function captureReadableText(
  document: Document,
): PageReadableTextCapture | undefined {
  const selected = selectReadableRoot(document);
  if (!selected) return undefined;
  const clone = selected.root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(removableSelector).forEach((element) => element.remove());
  const text = normalizeReadableText(clone.textContent ?? "");
  if (text.length < minReadableTextLength) return undefined;
  return {
    text: text.slice(0, maxReadableTextLength),
    source: selected.source,
    capturedAt: new Date().toISOString(),
  };
}

export function normalizeReadableText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function selectReadableRoot(document: Document):
  | { root: HTMLElement; source: PageReadableTextSource }
  | undefined {
  const article = document.querySelector<HTMLElement>("article");
  if (article) return { root: article, source: "article" };
  const main = document.querySelector<HTMLElement>('main, [role="main"]');
  if (main) return { root: main, source: "main" };
  return document.body ? { root: document.body, source: "body" } : undefined;
}
