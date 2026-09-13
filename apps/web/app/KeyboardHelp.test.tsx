import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyboardHelp, galleryKeys, reviewKeys, viewerKeys } from "./KeyboardHelp";

it("lists every documented shortcut behind a disclosure", () => {
  const html = renderToStaticMarkup(
    createElement(KeyboardHelp, { items: [...galleryKeys, ...viewerKeys, ...reviewKeys] }),
  );
  expect(html).toContain("<details");
  expect(html).toContain("Keys</summary>");
  for (const [keys, action] of [...galleryKeys, ...viewerKeys, ...reviewKeys]) {
    expect(html).toContain(keys);
    expect(html).toContain(action);
  }
});
