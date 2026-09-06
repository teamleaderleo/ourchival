import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import {
  CommunityTagList,
  ReferenceCommunityTags,
  safeCommunitySource,
  type CommunityItem,
} from "./ReferenceCommunityTags";
vi.stubGlobal("React", React);
const item: CommunityItem = {
  postId: 123,
  postUrl: "https://danbooru.donmai.us/posts/123",
  state: "current",
  correctionRevision: 0,
  tagCount: 9,
  tags: Array.from({ length: 9 }, (_, i) => ({
    code: i + 1,
    name: `detail_${i}`,
    category: "general",
    hidden: i === 8,
  })),
};
const render = (row = item) =>
  renderToStaticMarkup(
    React.createElement(CommunityTagList, {
      item: row,
      disabled: false,
      onToggle: () => {},
    }),
  );
test("keeps six summary terms and review controls behind disclosure, with distinct restore actions", () => {
  const html = render(),
    summary = html.split("<details>")[0];
  expect(summary).toContain("detail 5");
  expect(summary).not.toContain("detail 6");
  expect(html).toContain("Review 9 terms · 1 hidden");
  expect(html).toContain("Hide detail 0 from Danbooru search");
  expect(html).toContain("Restore detail 8 in Danbooru search");
  expect(html).not.toContain("<details open");
});
test("stale evidence is not presented as current and cannot be edited", () => {
  const html = render({ ...item, state: "stale" });
  expect(html).toContain("earlier image version");
  expect(html).not.toContain("Hide detail");
  expect(html).not.toContain("Matched to this image");
});
test("sealed tags require explicit reveal and source links reject unsafe URLs", () => {
  const html = renderToStaticMarkup(
    React.createElement(ReferenceCommunityTags, {
      assetId: "test",
      sealed: true,
    }),
  );
  expect(html).toContain("Show source tags");
  expect(html).not.toContain("Checking source");
  expect(safeCommunitySource("javascript:alert(1)")).toBeUndefined();
  expect(
    safeCommunitySource("https://user:secret@example.com"),
  ).toBeUndefined();
  expect(safeCommunitySource("https://www.pixiv.net/artworks/123")).toBe(
    "https://www.pixiv.net/artworks/123",
  );
});
