export type ReferenceWindowItem = {
  _id: string;
};

export function appendOlderReferences<T extends ReferenceWindowItem>(
  current: T[],
  older: T[],
) {
  return mergeUnique(current, older);
}

export function prependNewerReferences<T extends ReferenceWindowItem>(
  current: T[],
  newer: T[],
) {
  return mergeUnique(newer, current);
}

export function boundReferenceWindow<T extends ReferenceWindowItem>(args: {
  items: T[];
  maxItems: number;
  anchorId?: string | null;
}) {
  const maxItems = Math.max(1, Math.trunc(args.maxItems));
  if (args.items.length <= maxItems) return args.items;

  const anchorIndex = args.anchorId
    ? args.items.findIndex((item) => item._id === args.anchorId)
    : -1;
  if (anchorIndex < 0) return args.items.slice(0, maxItems);

  const before = Math.floor((maxItems - 1) / 2);
  let start = Math.max(0, anchorIndex - before);
  let end = start + maxItems;
  if (end > args.items.length) {
    end = args.items.length;
    start = Math.max(0, end - maxItems);
  }
  return args.items.slice(start, end);
}

function mergeUnique<T extends ReferenceWindowItem>(first: T[], second: T[]) {
  const result: T[] = [];
  const positions = new Map<string, number>();

  for (const item of [...first, ...second]) {
    const existing = positions.get(item._id);
    if (existing === undefined) {
      positions.set(item._id, result.length);
      result.push(item);
      continue;
    }
    // A later page can carry fresher hydrated metadata for the same reference
    // while preserving the position established by the earlier sequence.
    result[existing] = item;
  }

  return result;
}
