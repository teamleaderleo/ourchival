export const xTimelineAuditChannel = "OURCHIVAL_X_TIMELINE_AUDIT_V1";

export function isXLikesTimelineRequest(value: string) {
  try {
    const url = new URL(value, location.href);
    return (
      /(^|\.)x\.com$/i.test(url.hostname) &&
      /\/graphql\//i.test(url.pathname) &&
      /\/(?:Likes|LikesTimeline|UserLikes)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function collectXLikesTimelinePostIds(payload: unknown) {
  const ids = new Set<string>();
  const visited = new Set<object>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.entryId === "string") {
      const match = record.entryId.match(/^tweet-(\d+)(?:-|$)/);
      if (match?.[1]) ids.add(match[1]);
    }
    if (record.itemType === "TimelineTweet") {
      const tweetResults = asRecord(record.tweet_results);
      const result = asRecord(tweetResults?.result);
      if (typeof result?.rest_id === "string" && /^\d+$/.test(result.rest_id)) {
        ids.add(result.rest_id);
      }
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(payload);
  return Array.from(ids);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
