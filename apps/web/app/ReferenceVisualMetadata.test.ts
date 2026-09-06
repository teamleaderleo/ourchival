import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssetMetadata } from "./ReferenceVisualMetadata";

vi.stubGlobal("React", React);
const base = {
  assetId: "example",
  state: "ready" as const,
  generatedAt: 1,
  tags: [
    {
      name: "heart_hands",
      category: "general",
      confidence: 0.8,
      rejected: false,
    },
  ],
  ocrText: "",
  caption: "",
  models: [],
  corrections: {
    rejectedTags: [],
    hideOcr: false,
    hideCaption: false,
    revision: 1,
  },
};
const render = (item: Parameters<typeof AssetMetadata>[0]["item"]) =>
  renderToStaticMarkup(
    React.createElement(AssetMetadata, {
      item,
      index: 0,
      disabled: false,
      onSave: async () => {},
    }),
  );
describe("image metadata review states", () => {
  it("shows reference groups and access to the full vocabulary", () => {
    const html = render(base);
    expect(html).toContain("Pose and gesture");
    expect(html).toContain("Exclude heart hands from search");
    expect(html).toContain("Show all 1 terms");
  });
  it("does not present unavailable or stale analyses as current predictions", () => {
    const empty = render({ ...base, state: "not_analyzed", tags: [] });
    expect(empty).toContain(
      "Downloading it does not automatically run image tagging",
    );
    expect(empty).not.toContain("Exclude heart hands");
    const stale = render({ ...base, state: "stale" });
    expect(stale).toContain("excluded from search");
    expect(stale).not.toContain("Exclude heart hands");
  });
});
