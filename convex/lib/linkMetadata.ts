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

export async function fetchLinkMetadata(sourceUrl: string): Promise<LinkMetadata> {
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
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.4",
        "User-Agent": "Ourchival-Link-Metadata/1.0",
      },
    });
    const finalUrl = response.url || sourceUrl;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const httpStatus = response.status;

    if (!isSafePublicUrl(finalUrl)) {
      return {
        contentType,
        httpStatus,
        metadataStatus: "failed",
        metadataFetchedAt,
        error: "Metadata redirect resolved to a local or private URL.",
      };
    }

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

export function parseLinkMetadataHtml(html: string, pageUrl: string): LinkMetadata {
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
  const siteName = firstText(meta.get("og:site_name"), meta.get("application-name"));
  const author = firstText(
    meta.get("author"),
    meta.get("article:author"),
    meta.get("byl"),
  );
  const canonicalUrl = resolveHttpUrl(
    links.find((link) => link.rel.includes("canonical"))?.href ?? meta.get("og:url"),
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
    if (key && content && !values.has(key)) values.set(key, decodeHtml(content));
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
      rel: (attributes.rel ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    });
  }
  return links;
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const expression = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(expression)) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function extractTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(stripTags(match[1]).replace(/\s+/g, " ").trim()) : undefined;
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
    return segment ? decodeURIComponent(segment).replace(/[-_]+/g, " ") : url.hostname;
  } catch {
    return undefined;
  }
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
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