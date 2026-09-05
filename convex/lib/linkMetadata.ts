export type LinkMetadataStatus = "ready" | "missing" | "failed";

export type LinkMetadata = {
  canonicalUrl?: string;
  title?: string;
  description?: string;
  siteName?: string;
  faviconUrl?: string;
  previewImageUrl?: string;
  author?: string;
  contentType?: string;
  httpStatus?: number;
  metadataStatus: LinkMetadataStatus;
  metadataFetchedAt: number;
  error?: string;
};

const maxHtmlBytes = 2 * 1024 * 1024;
const fetchTimeoutMs = 8_000;
const maxRedirects = 5;

export async function fetchLinkMetadata(
  sourceUrl: string,
): Promise<LinkMetadata> {
  const metadataFetchedAt = Date.now();

  if (!isSafePublicUrl(sourceUrl)) {
    return {
      metadataStatus: "failed",
      metadataFetchedAt,
      error: "Metadata fetch blocked for a local or private URL.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const firstPartyMetadata = await fetchFirstPartyMetadata(
      sourceUrl,
      metadataFetchedAt,
      controller.signal,
    );
    if (firstPartyMetadata) return firstPartyMetadata;

    const { response, finalUrl } = await fetchPublicResponse(sourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.4",
        "User-Agent": "Ourchival-Link-Metadata/1.0",
      },
    });
    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();
    const httpStatus = response.status;

    if (!response.ok) {
      return {
        canonicalUrl: finalUrl,
        contentType,
        httpStatus,
        metadataStatus: "failed",
        metadataFetchedAt,
        error: `Metadata request returned HTTP ${httpStatus}.`,
      };
    }

    if (!isHtmlContentType(contentType)) {
      return {
        canonicalUrl: finalUrl,
        title: titleFromUrl(finalUrl),
        contentType,
        httpStatus,
        metadataStatus: "missing",
        metadataFetchedAt,
      };
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maxHtmlBytes) {
      return {
        canonicalUrl: finalUrl,
        contentType,
        httpStatus,
        metadataStatus: "failed",
        metadataFetchedAt,
        error: "Metadata response exceeded the 2 MB HTML limit.",
      };
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxHtmlBytes) {
      return {
        canonicalUrl: finalUrl,
        contentType,
        httpStatus,
        metadataStatus: "failed",
        metadataFetchedAt,
        error: "Metadata response exceeded the 2 MB HTML limit.",
      };
    }

    return {
      ...parseLinkMetadataHtml(new TextDecoder().decode(bytes), finalUrl),
      contentType,
      httpStatus,
      metadataFetchedAt,
    };
  } catch (error) {
    return {
      metadataStatus: "failed",
      metadataFetchedAt,
      error:
        error instanceof Error
          ? error.name === "AbortError"
            ? "Metadata request timed out."
            : error.message
          : "Metadata request failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirstPartyMetadata(
  sourceUrl: string,
  metadataFetchedAt: number,
  signal: AbortSignal,
) {
  const postId = hoyolabPostId(sourceUrl);
  if (!postId) return undefined;

  try {
    const apiUrl = `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${encodeURIComponent(postId)}`;
    const { response } = await fetchPublicResponse(apiUrl, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Ourchival-Link-Metadata/1.0",
      },
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return parseHoyolabPostMetadata(body, sourceUrl, metadataFetchedAt);
  } catch {
    return undefined;
  }
}

export function parseHoyolabPostMetadata(
  body: unknown,
  sourceUrl: string,
  metadataFetchedAt = Date.now(),
): LinkMetadata | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, any>;
  if (root.retcode !== 0) return undefined;
  const detail = root.data?.post;
  const post = detail?.post;
  if (!post || typeof post !== "object") return undefined;

  const previewImageUrl = firstPublicImageUrl(
    detail.image_list?.[0]?.url,
    detail.cover_list?.[0]?.url,
    post.cover,
    contentImageUrl(post.content),
  );
  const title = cleanMetadataText(post.subject);
  const description = cleanMetadataText(post.desc);
  const author = cleanMetadataText(detail.user?.nickname);

  return {
    canonicalUrl: sourceUrl,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    siteName: "HoYoLAB",
    faviconUrl: "https://www.hoyolab.com/favicon.ico",
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(author ? { author } : {}),
    contentType: "text/html",
    httpStatus: 200,
    metadataStatus:
      title || description || previewImageUrl || author ? "ready" : "missing",
    metadataFetchedAt,
  };
}

function hoyolabPostId(value: string) {
  try {
    const url = new URL(value);
    if (!/^(?:www\.)?hoyolab\.com$/i.test(url.hostname)) return undefined;
    return url.pathname.match(/^\/article\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

function contentImageUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const content = JSON.parse(value) as { imgs?: unknown[] };
    return content.imgs?.find((item): item is string => typeof item === "string");
  } catch {
    return undefined;
  }
}

function firstPublicImageUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text && isSafePublicUrl(text)) return text;
  }
  return undefined;
}

function cleanMetadataText(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.trim().replace(/\s+/g, " ") || undefined;
}

export async function fetchPublicResponse(
  sourceUrl: string,
  init: Omit<RequestInit, "redirect"> = {},
) {
  let currentUrl = sourceUrl;

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    if (!isSafePublicUrl(currentUrl)) {
      throw new Error("Remote fetch blocked for a local or private URL.");
    }

    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: response.url || currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: response.url || currentUrl };
    if (redirectCount === maxRedirects)
      throw new Error("Remote fetch redirected too many times.");
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Remote fetch redirected too many times.");
}

export function remoteAssetCandidateUrls(sourceUrl: string) {
  const candidates = [sourceUrl];
  try {
    const url = new URL(sourceUrl);
    if (
      /(^|\.)pinimg\.com$/i.test(url.hostname) &&
      url.pathname.includes("/originals/")
    ) {
      for (const rendition of ["1200x", "736x"]) {
        const fallback = new URL(url);
        fallback.pathname = fallback.pathname.replace(
          "/originals/",
          `/${rendition}/`,
        );
        candidates.push(fallback.toString());
      }
    }
  } catch {
    // fetchPublicResponse reports invalid URLs consistently.
  }
  return candidates;
}

export function parseLinkMetadataHtml(
  html: string,
  pageUrl: string,
): LinkMetadata {
  const meta = collectMetaTags(html);
  const links = collectLinkTags(html);
  const title = firstText(
    meta.get("og:title"),
    meta.get("twitter:title"),
    extractTitle(html),
  );
  const description = firstText(
    meta.get("og:description"),
    meta.get("twitter:description"),
    meta.get("description"),
  );
  const siteName = firstText(
    meta.get("og:site_name"),
    meta.get("application-name"),
  );
  const author = firstText(
    meta.get("author"),
    meta.get("article:author"),
    meta.get("byl"),
  );
  const canonicalUrl = resolveHttpUrl(
    links.find((link) => link.rel.includes("canonical"))?.href ??
      meta.get("og:url"),
    pageUrl,
  );
  const faviconUrl = resolveHttpUrl(
    links.find((link) =>
      link.rel.some((token) =>
        ["icon", "shortcut", "apple-touch-icon", "mask-icon"].includes(token),
      ),
    )?.href,
    pageUrl,
  );
  const previewImageUrl = resolveHttpUrl(
    firstText(
      meta.get("og:image:secure_url"),
      meta.get("og:image"),
      meta.get("twitter:image"),
      meta.get("twitter:image:src"),
    ),
    pageUrl,
  );
  const hasUsefulMetadata = Boolean(
    title || description || siteName || faviconUrl || previewImageUrl || author,
  );

  return {
    ...(canonicalUrl ? { canonicalUrl } : { canonicalUrl: pageUrl }),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(siteName ? { siteName } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(author ? { author } : {}),
    metadataStatus: hasUsefulMetadata ? "ready" : "missing",
    metadataFetchedAt: Date.now(),
  };
}

export function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "::" ||
      hostname === "::1"
    ) {
      return false;
    }

    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function collectMetaTags(html: string) {
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (
      attributes.property ??
      attributes.name ??
      attributes.itemprop ??
      ""
    )
      .trim()
      .toLowerCase();
    const content = attributes.content?.trim();
    if (key && content && !values.has(key))
      values.set(key, decodeHtml(content));
  }
  return values;
}

function collectLinkTags(html: string) {
  const links: Array<{ rel: string[]; href: string }> = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const href = attributes.href?.trim();
    if (!href) continue;
    links.push({
      href: decodeHtml(href),
      rel: (attributes.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean),
    });
  }
  return links;
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const expression = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(expression)) {
    attributes[match[1]!.toLowerCase()] =
      match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function extractTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match
    ? decodeHtml(stripTags(match[1]).replace(/\s+/g, " ").trim())
    : undefined;
}

function firstText(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function resolveHttpUrl(value: string | undefined, baseUrl: string) {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isHtmlContentType(value: string | undefined) {
  if (!value) return true;
  return value === "text/html" || value === "application/xhtml+xml";
}

function titleFromUrl(value: string) {
  try {
    const url = new URL(value);
    const segment = url.pathname.split("/").filter(Boolean).at(-1);
    return segment
      ? decodeURIComponent(segment).replace(/[-_]+/g, " ")
      : url.hostname;
  } catch {
    return undefined;
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
    return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:172.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }
    return named[normalized] ?? `&${code};`;
  });
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}
