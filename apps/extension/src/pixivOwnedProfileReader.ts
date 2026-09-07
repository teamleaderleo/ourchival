import type { JsonRequest } from "./artworkIntake";
import {
  pixivOwnedArtwork,
  pixivOwnedProfileWorkIds,
  type PixivOwnedProfileContext,
} from "./pixivOwnedProfile";
import type { SourceIntakeChunk, SourceIntakeItem } from "./sourceIntake";

const defaultChunkSize = 40;
const maximumIndexedWorks = 2_000;
const knownBoundarySize = 12;

export async function scanPixivOwnedProfile(args: {
  context: PixivOwnedProfileContext;
  currentUrl: string;
  request: JsonRequest;
  known?: Set<string>;
  stopped?: () => boolean;
  chunkSize?: number;
}): Promise<SourceIntakeChunk> {
  const chunkSize = boundedChunkSize(args.chunkSize ?? defaultChunkSize);
  const offset = profileOffset(args.currentUrl);
  const profile = await args.request(
    `/ajax/user/${args.context.userId}/profile/all?lang=en`,
  );
  const ids = pixivOwnedProfileWorkIds(profile, maximumIndexedWorks);
  if (offset > ids.length) {
    throw new Error("Pixiv profile checkpoint is beyond the current work index.");
  }

  const items: SourceIntakeItem[] = [];
  let consumed = 0;
  let consecutiveKnown = 0;
  let knownBoundary = false;

  for (let index = offset; index < ids.length && consumed < chunkSize; index += 1) {
    if (args.stopped?.()) {
      throw new Error("Paused; current Pixiv profile chunk will be replayed.");
    }
    const providerId = ids[index]!;
    consumed += 1;
    if (args.known?.has(providerId)) {
      consecutiveKnown += 1;
      if (consecutiveKnown >= knownBoundarySize) {
        knownBoundary = true;
        break;
      }
      continue;
    }
    consecutiveKnown = 0;
    items.push(
      await pixivOwnedArtwork(
        providerId,
        args.context,
        index,
        args.request,
      ),
    );
  }

  const nextOffset = offset + consumed;
  const exhausted = knownBoundary || nextOffset >= ids.length;
  return {
    provider: "pixiv_owned_profile",
    sourceUrl: args.context.sourceUrl,
    currentUrl: args.currentUrl,
    cursor: `works:${nextOffset}`,
    items,
    reportedCount: ids.length,
    exhausted,
    ...(!exhausted
      ? { nextUrl: pixivOwnedProfileOffsetUrl(args.context.sourceUrl, nextOffset) }
      : {}),
  };
}

export function pixivOwnedProfileOffsetUrl(sourceUrl: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Pixiv profile offset must be a non-negative integer.");
  }
  const url = new URL(sourceUrl);
  if (offset > 0) url.searchParams.set("ourchival_offset", String(offset));
  else url.searchParams.delete("ourchival_offset");
  return url.toString();
}

export function profileOffset(value: string) {
  const url = new URL(value);
  const raw = url.searchParams.get("ourchival_offset");
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) throw new Error("Pixiv profile checkpoint is invalid.");
  const offset = Number(raw);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maximumIndexedWorks) {
    throw new Error("Pixiv profile checkpoint is out of range.");
  }
  return offset;
}

function boundedChunkSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120) {
    throw new Error("Pixiv profile chunks must contain between 1 and 120 works.");
  }
  return value;
}
