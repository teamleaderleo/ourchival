import { describe, expect, it } from "vitest";
import {
  cleanRedditAuthor,
  cleanRedditThingId,
  cleanSubreddit,
  isRedditThreadUrl,
  serializeRedditThreadSnapshot,
  type RedditThreadSnapshot,
} from "./redditSnapshotModel";

function snapshot(commentCount = 2): RedditThreadSnapshot {
  return {
    schemaVersion: 1,
    provider: "reddit",
    adapter: "reddit.dom",
    adapterVersion: "1",
    capturedAt: "2026-07-24T00:00:00.000Z",
    sourceUrl: "https://www.reddit.com/r/test/comments/abc123/example/",
    title: "Example thread",
    subreddit: "test",
    post: { id: "abc123", author: "poster", body: "Post body" },
    visibleCommentCount: commentCount,
    capturedCommentCount: commentCount,
    truncated: false,
    comments: Array.from({ length: commentCount }, (_, index) => ({
      index,
      id: `comment-${index}`,
      author: `person-${index}`,
      depth: index,
      body: `Comment ${index}`,
    })),
  };
}

describe("Reddit snapshot model", () => {
  it("recognizes Reddit thread URLs across supported hosts", () => {
    expect(
      isRedditThreadUrl("https://www.reddit.com/r/test/comments/abc123/example/"),
    ).toBe(true);
    expect(
      isRedditThreadUrl("https://old.reddit.com/r/test/comments/abc123/example/"),
    ).toBe(true);
    expect(isRedditThreadUrl("https://www.reddit.com/r/test/")).toBe(false);
    expect(isRedditThreadUrl("https://example.com/comments/abc123")).toBe(false);
  });

  it("normalizes Reddit identifiers", () => {
    expect(cleanRedditThingId("thing_t1_comment")).toBe("comment");
    expect(cleanRedditThingId("t3_post")).toBe("post");
    expect(cleanRedditAuthor("u/example")).toBe("example");
    expect(cleanSubreddit("r/ourchival")).toBe("ourchival");
  });

  it("preserves complete small snapshots", () => {
    const parsed = JSON.parse(serializeRedditThreadSnapshot(snapshot()));
    expect(parsed.capturedCommentCount).toBe(2);
    expect(parsed.truncated).toBe(false);
    expect(parsed.comments).toHaveLength(2);
  });

  it("truncates oversized snapshots within the requested byte limit", () => {
    const input = snapshot(50);
    input.comments = input.comments.map((comment) => ({
      ...comment,
      body: "x".repeat(2_000),
    }));
    const data = serializeRedditThreadSnapshot(input, 12_000);
    const parsed = JSON.parse(data);
    expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(12_000);
    expect(parsed.capturedCommentCount).toBeLessThan(50);
    expect(parsed.truncated).toBe(true);
  });
});
