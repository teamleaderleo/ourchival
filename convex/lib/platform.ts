export type SourcePlatform =
  | "x"
  | "pinterest"
  | "pixiv"
  | "danbooru"
  | "discord"
  | "manual"
  | "generic";

export function detectPlatform(url: string): SourcePlatform {
  const host = safeHost(url);

  if (host.includes("x.com") || host.includes("twitter.com")) return "x";
  if (host.includes("pinterest.")) return "pinterest";
  if (host.includes("pixiv.net")) return "pixiv";
  if (host === "danbooru.donmai.us" || host.endsWith(".danbooru.donmai.us")) {
    return "danbooru";
  }
  if (host.includes("discord.")) return "discord";

  return "generic";
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
