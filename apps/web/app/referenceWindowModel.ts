export type ReferenceWindowItem = {
  _id: string;
};

export function appendOlderReferences<T extends ReferenceWindowItem>(
  current: T[],
  older: T[],
) {
  return mergeByOrderAndFreshness({
    order: [...current, ...older],
    stale: current,
    fresh: older,
  });
}

export function prependNewerReferences<T extends ReferenceWindowItem>(
  current: T[],
  newer: T[],
) {
  return mergeByOrderAndFreshness({
    order: [...newer, ...current],
    stale: current,
    fresh: newer,
  });
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

function mergeByOrderAndFreshness<T extends ReferenceWindowItem>(args: {
  order: T[];
  stale: T[];
  fresh: T[];
}) {
  const values = new Map<string, T>();
  for (const item of args.stale) values.set(item._id, item);
  for (const item of args.fresh) values.set(item._id, item);

  const result: T[] = [];
  const emitted = new Set<string>();
  for (const item of args.order) {
    if (emitted.has(item._id)) continue;
    emitted.add(item._id);
    const value = values.get(item._id);
    if (value) result.push(value);
  }
  return result;
}
