import type { PageStructuredSnapshotCapture } from "@ourchival/shared";
import { normalizeReadableText } from "./readableText";
import {
  cleanRedditAuthor,
  cleanRedditThingId,
  cleanSubreddit,
  isRedditThreadUrl,
  maxRedditComments,
  maxRedditCommentText,
  maxRedditPostText,
  redditSnapshotProvider,
  serializeRedditThreadSnapshot,
  type RedditCommentSnapshot,
  type RedditThreadSnapshot,
} from "./redditSnapshotModel";

const commentSelector = [
  "shreddit-comment",
  '[data-testid="comment"]',
  ".Comment",
  ".comment[data-fullname]",
].join(",");

export function captureRedditThreadSnapshot(
  document: Document,
  pageUrl: string,
): PageStructuredSnapshotCapture | undefined {
  if (!isRedditThreadUrl(pageUrl)) return undefined;
  const capturedAt = new Date().toISOString();
  const allComments = Array.from(
    document.querySelectorAll<HTMLElement>(commentSelector),
  );
  const comments = allComments
    .slice(0, maxRedditComments)
    .map((element, index) => extractComment(element, index, pageUrl))
    .filter((comment): comment is RedditCommentSnapshot => Boolean(comment));
  const post = extractPost(document, pageUrl);
  if (!post.body && comments.length === 0) return undefined;

  const canonicalUrl = httpUrl(
    document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href,
    pageUrl,
  );
  const snapshot: RedditThreadSnapshot = {
    schemaVersion: 1,
    provider: "reddit",
    adapter: redditSnapshotProvider,
    adapterVersion: "1",
    capturedAt,
    sourceUrl: pageUrl,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    title: post.title || document.title.trim() || "Reddit thread",
    ...(post.subreddit ? { subreddit: post.subreddit } : {}),
    post: {
      ...(post.id ? { id: post.id } : {}),
      ...(post.author ? { author: post.author } : {}),
      ...(post.createdAt ? { createdAt: post.createdAt } : {}),
      ...(post.permalink ? { permalink: post.permalink } : {}),
      ...(post.body ? { body: post.body } : {}),
    },
    visibleCommentCount: allComments.length,
    capturedCommentCount: comments.length,
    truncated: false,
    comments,
  };
  return {
    data: serializeRedditThreadSnapshot(snapshot),
    provider: redditSnapshotProvider,
    capturedAt,
  };
}

function extractPost(document: Document, pageUrl: string) {
  const root = document.querySelector<HTMLElement>(
    'shreddit-post, [data-testid="post-container"], .thing.link, article',
  );
  const title = first(
    attr(root, "post-title"),
    elementText(root?.querySelector<HTMLElement>('[slot="title"]')),
    elementText(root?.querySelector<HTMLElement>('[data-testid="post-title"]')),
    elementText(document.querySelector<HTMLElement>("h1")),
    elementText(root?.querySelector<HTMLElement>("a.title")),
  );
  const body = longestText(root, [
    '[slot="text-body"]',
    '[id$="-post-rtjson-content"]',
    '[data-testid="post-content"]',
    ".usertext-body .md",
    ".expando .md",
  ])?.slice(0, maxRedditPostText);
  const subreddit = cleanSubreddit(first(
    attr(root, "subreddit-prefixed-name"),
    attr(root, "subreddit"),
    attr(root, "data-subreddit"),
    subredditFromLink(root),
  ));
  return {
    title,
    body,
    subreddit,
    id: cleanRedditThingId(first(
      attr(root, "post-id"),
      attr(root, "data-fullname"),
      attr(root, "thingid"),
      attr(root, "id"),
    )),
    author: cleanRedditAuthor(first(
      attr(root, "author"),
      attr(root, "post-author"),
      attr(root, "data-author"),
      elementText(root?.querySelector<HTMLElement>('a[href*="/user/"]')),
      elementText(root?.querySelector<HTMLElement>(".author")),
    )),
    createdAt: first(
      attr(root, "created-timestamp"),
      attr(root, "timestamp"),
      root?.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime,
      attr(root?.querySelector<HTMLElement>(".live-timestamp"), "title"),
    ),
    permalink: firstUrl(pageUrl,
      attr(root, "permalink"),
      attr(root, "content-href"),
      matchingLink(root, /\/comments\//i),
    ),
  };
}

function extractComment(
  root: HTMLElement,
  index: number,
  pageUrl: string,
): RedditCommentSnapshot | undefined {
  const body = longestOwnedText(root, [
    '[slot="comment"]',
    '[id$="-comment-rtjson-content"]',
    '[data-click-id="text"]',
    ".usertext-body .md",
    ".md",
  ])?.slice(0, maxRedditCommentText);
  if (!body) return undefined;
  const id = cleanRedditThingId(first(
    attr(root, "comment-id"),
    attr(root, "thingid"),
    attr(root, "data-fullname"),
    attr(root, "id"),
  ));
  const author = cleanRedditAuthor(first(
    attr(root, "author"),
    attr(root, "author-name"),
    attr(root, "data-author"),
    ownedText(root, 'a[href*="/user/"]'),
    ownedText(root, ".author"),
  ));
  const createdAt = first(
    attr(root, "created-timestamp"),
    attr(root, "timestamp"),
    ownedAttr(root, "time[datetime]", "datetime"),
    ownedAttr(root, ".live-timestamp", "title"),
  );
  const permalink = firstUrl(pageUrl,
    attr(root, "permalink"),
    matchingOwnedLink(root, /\/comments\//i),
  );
  return {
    index,
    ...(id ? { id } : {}),
    ...(author ? { author } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(permalink ? { permalink } : {}),
    depth: commentDepth(root),
    body,
  };
}

function longestOwnedText(root: HTMLElement, selectors: string[]) {
  return longest(
    selectors.flatMap((selector) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector))
        .filter((candidate) => candidate.closest(commentSelector) === root)
        .map((candidate) => visibleText(candidate)),
    ),
  );
}

function longestText(root: HTMLElement | null, selectors: string[]) {
  if (!root) return undefined;
  return longest(
    selectors.flatMap((selector) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).map(visibleText),
    ),
  );
}

function visibleText(element: HTMLElement) {
  return normalizeReadableText(element.innerText || element.textContent || "");
}

function ownedText(root: HTMLElement, selector: string) {
  const element = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
    (candidate) => candidate.closest(commentSelector) === root,
  );
  return element ? visibleText(element) : undefined;
}

function ownedAttr(root: HTMLElement, selector: string, name: string) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .find((candidate) => candidate.closest(commentSelector) === root)
    ?.getAttribute(name)?.trim();
}

function matchingOwnedLink(root: HTMLElement, pattern: RegExp) {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .filter((link) => link.closest(commentSelector) === root)
    .map((link) => link.href)
    .find((href) => pattern.test(href));
}

function matchingLink(root: HTMLElement | null, pattern: RegExp) {
  return Array.from(root?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])
    .map((link) => link.href)
    .find((href) => pattern.test(href));
}

function commentDepth(root: HTMLElement) {
  const explicit = Number(attr(root, "depth") ?? attr(root, "data-depth"));
  if (Number.isFinite(explicit) && explicit >= 0) return Math.min(64, explicit);
  let depth = 0;
  let parent = root.parentElement?.closest<HTMLElement>(commentSelector);
  while (parent && depth < 64) {
    depth += 1;
    parent = parent.parentElement?.closest<HTMLElement>(commentSelector);
  }
  return depth;
}

function subredditFromLink(root: HTMLElement | null) {
  const href = root?.querySelector<HTMLAnchorElement>('a[href*="/r/"]')?.href;
  return href?.match(/\/r\/([^/?#]+)/i)?.[1];
}

function attr(element: Element | null | undefined, name: string) {
  return element?.getAttribute(name)?.trim() || undefined;
}

function elementText(element: HTMLElement | null | undefined) {
  return element ? visibleText(element) || undefined : undefined;
}

function first(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function longest(values: string[]) {
  return values.filter(Boolean).sort((a, b) => b.length - a.length)[0];
}

function firstUrl(base: string, ...values: Array<string | undefined>) {
  for (const value of values) {
    const result = httpUrl(value, base);
    if (result) return result;
  }
  return undefined;
}

function httpUrl(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
