import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThumbImage } from "./ReferenceCards";

it("hidden previews never emit an image URL even when one is available", () => {
  const html = renderToStaticMarkup(createElement(ThumbImage, { hidden: true, imageUrl: "https://example.com/private.png", kind: "image" }));
  expect(html).not.toContain("<img");
  expect(html).not.toContain("https://example.com/private.png");
  expect(html).toContain("Show sensitive images in the toolbar");
});

it("missing previews keep an accessible label without grid diagnostics", () => {
  const html = renderToStaticMarkup(createElement(ThumbImage, { kind: "image", title: "Palette study" }));
  expect(html).toContain('aria-label="Palette study"');
  expect(html).not.toMatch(/unavailable|failed|No image captured/);
});
