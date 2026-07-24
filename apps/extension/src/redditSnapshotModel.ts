export const redditSnapshotProvider = "reddit.dom" as const;
export const maxRedditComments = 500;
export const maxRedditCommentText = 20_000;
export const maxRedditPostText = 100_000;
export const maxRedditSnapshotBytes = 900_000;

export type RedditCommentSnapshot = {
  index: number;
  id?: string;
  author?: string;
  createdAt?: string;
  permalink?: string;
  depth: number;
  body: string;
};

export type RedditThreadSnapshot = {
  schemaVersion: 1;
  provider: "reddit";
  adapter: "reddit.dom";
  adapterVersion: "1";
  capturedAt: string;
  sourceUrl: string;
  canonicalUrl?: string;
  title: string;
  subreddit?: string;
  post: {
    id?: string;
    author?: string;
    createdAt?: string;
    permalink?: string;
    body?: string;
  };
  visibleCommentCount: number;
  capturedCommentCount: number;
  truncated: boolean;
  comments: RedditCommentSnapshot[];
};

export function isRedditThreadUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (host === "reddit.com" || host.endsWith(".reddit.com")) &&
      /\/comments\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function serializeRedditThreadSnapshot(
  snapshot: RedditThreadSnapshot,
  limitBytes = maxRedditSnapshotBytes,
) {
  const encoder = new TextEncoder();
  const comments: RedditCommentSnapshot[] = [];
  const candidates = snapshot.comments.slice(0, maxRedditComments);
  let usedBytes = encoder.encode(
    JSON.stringify({ ...snapshot, comments: [], capturedCommentCount: 0 }),
  ).byteLength;

  for (const comment of candidates) {
    const size = encoder.encode(JSON.stringify(comment)).byteLength + 1;
    if (usedBytes + size + 1024 > limitBytes) break;
    comments.push(comment);
    usedBytes += size;
  }

  const result: RedditThreadSnapshot = {
    ...snapshot,
    comments,
    capturedCommentCount: comments.length,
    truncated:
      comments.length < snapshot.visibleCommentCount ||
      comments.length < candidates.length,
  };
  let data = JSON.stringify(result);
  while (comments.length && encoder.encode(data).byteLength > limitBytes) {
    comments.pop();
    result.capturedCommentCount = comments.length;
    result.truncated = true;
    data = JSON.stringify(result);
  }
  return data;
}

export function cleanRedditThingId(value: string | undefined) {
  return value?.trim().replace(/^(thing_)?t[13]_/, "") || undefined;
}

export function cleanRedditAuthor(value: string | undefined) {
  return value?.trim().replace(/^u\//i, "") || undefined;
}

export function cleanSubreddit(value: string | undefined) {
  return value?.trim().replace(/^r\//i, "") || undefined;
}
