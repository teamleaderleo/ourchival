export type ReferencePrefetchItem = {
  id: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
};

export type ReferencePrefetchPlan = {
  thumbnails: Array<{ id: string; url: string }>;
  previews: Array<{ id: string; url: string }>;
};

export function planReferencePrefetch(args: {
  items: ReferencePrefetchItem[];
  visibleStart: number;
  visibleEnd: number;
  selectedId?: string | null;
  thumbnailAhead?: number;
  previewRadius?: number;
}): ReferencePrefetchPlan {
  const itemCount = args.items.length;
  if (itemCount === 0) return { thumbnails: [], previews: [] };

  const visibleStart = clampIndex(args.visibleStart, itemCount);
  const visibleEnd = Math.max(
    visibleStart,
    clampIndex(args.visibleEnd, itemCount),
  );
  const thumbnailAhead = nonNegativeInteger(args.thumbnailAhead, 24);
  const previewRadius = nonNegativeInteger(args.previewRadius, 3);

  const thumbnails = collectUrls(
    args.items,
    visibleEnd + 1,
    Math.min(itemCount, visibleEnd + 1 + thumbnailAhead),
    "thumbnailUrl",
  );

  const selectedIndex = args.selectedId
    ? args.items.findIndex((item) => item.id === args.selectedId)
    : -1;
  const previewCenter = selectedIndex >= 0 ? selectedIndex : visibleStart;
  const previews = collectUrls(
    args.items,
    Math.max(0, previewCenter - previewRadius),
    Math.min(itemCount, previewCenter + previewRadius + 1),
    "previewUrl",
  );

  return {
    thumbnails,
    previews,
  };
}

function collectUrls(
  items: ReferencePrefetchItem[],
  start: number,
  end: number,
  field: "thumbnailUrl" | "previewUrl",
) {
  const result: Array<{ id: string; url: string }> = [];
  const seen = new Set<string>();
  for (let index = start; index < end; index += 1) {
    const item = items[index];
    const url = item?.[field]?.trim();
    if (!item || !url || seen.has(url)) continue;
    seen.add(url);
    result.push({ id: item.id, url });
  }
  return result;
}

function clampIndex(value: number, itemCount: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(itemCount - 1, Math.max(0, Math.trunc(value)));
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}
