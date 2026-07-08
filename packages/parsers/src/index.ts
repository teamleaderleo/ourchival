import type { ParsedSource, SourcePlatform } from "@ourchival/shared";

export function detectPlatform(url: string): SourcePlatform {
  const host = safeHost(url);

  if (host.includes("x.com") || host.includes("twitter.com")) return "x";
  if (host.includes("pinterest.")) return "pinterest";
  if (host.includes("pixiv.net")) return "pixiv";
  if (host.includes("discord.")) return "discord";

  return "generic";
}

export function parseGenericSource(url: string, mediaUrls: string[] = []): ParsedSource {
  return {
    platform: detectPlatform(url),
    sourceUrl: url,
    mediaUrls,
  };
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
