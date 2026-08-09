import { parseXSnapshot, type XDomSnapshot } from "@ourchival/parsers";
import { buildXInlinePayloads, inlineXSourceKey } from "./inlineCapture";
import type { CreativeSiteAdapter } from "./creativeSiteAdapter";

export const xCreativeSiteAdapter: CreativeSiteAdapter = {
  platform: "x",

  matchesLocation(location) {
    return isXLocation(location);
  },

  listItems(root) {
    const items = new Set<HTMLElement>();
    if (root instanceof HTMLElement && root.matches("article")) items.add(root);
    for (const article of root.querySelectorAll<HTMLElement>("article")) {
      items.add(article);
    }
    return Array.from(items);
  },

  closestItem(element) {
    return element.closest<HTMLElement>("article") ?? undefined;
  },

  identify(item) {
    const source = parseXSnapshot(snapshotXArticle(item));
    const sourceKey = inlineXSourceKey(source);
    return sourceKey ? { sourceKey } : undefined;
  },

  prepareCapture(item) {
    const snapshot = snapshotXArticle(item);
    const source = parseXSnapshot(snapshot);
    const sourceKey = inlineXSourceKey(source);
    if (!sourceKey) return undefined;
    return {
      platform: "x",
      sourceKey,
      payloads: buildXInlinePayloads(
        source,
        JSON.stringify(snapshot),
        document.title,
      ),
    };
  },

  actionContainer(item) {
    const replyAction = item.querySelector<HTMLElement>('[data-testid="reply"]');
    return replyAction?.closest<HTMLElement>('[role="group"]') ?? undefined;
  },
};

export function snapshotXArticle(
  article: Element,
  clickedImage?: HTMLImageElement,
): XDomSnapshot {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
    (link) => ({
      href: link.href,
      text: link.innerText.trim() || undefined,
    }),
  );
  const images = Array.from(article.querySelectorAll<HTMLImageElement>("img")).map(
    (image) => {
      const link = image.closest<HTMLAnchorElement>("a[href]");
      return {
        src: image.currentSrc || image.src,
        alt: image.alt || undefined,
        ...(link?.href ? { href: link.href } : {}),
      };
    },
  );
  const userNameText = article
    .querySelector<HTMLElement>('[data-testid="User-Name"]')
    ?.innerText.trim();
  const articleText = article
    .querySelector<HTMLElement>('[data-testid="tweetText"]')
    ?.innerText.trim();
  const timestampElement = article.querySelector<HTMLTimeElement>("time[datetime]");
  const timestamp = timestampElement?.dateTime;
  const primaryStatusUrl = timestampElement
    ?.closest<HTMLAnchorElement>("a[href]")
    ?.href;

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    ...(articleText ? { articleText } : {}),
    ...(userNameText ? { userNameText } : {}),
    ...(clickedImage
      ? { clickedImageUrl: clickedImage.currentSrc || clickedImage.src }
      : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(primaryStatusUrl ? { primaryStatusUrl } : {}),
    links,
    images,
  };
}

export function isXLocation(location: Pick<Location, "hostname">) {
  const host = location.hostname.toLowerCase();
  return (
    host === "x.com" ||
    host.endsWith(".x.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com")
  );
}
