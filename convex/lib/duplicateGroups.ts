export type DuplicateAssetInput = {
  _id: string;
  referenceId: string;
  perceptualHash?: string;
};

export type DuplicateGroup = {
  perceptualHash: string;
  referenceIds: string[];
};

export function groupExactDuplicates(
  assets: DuplicateAssetInput[],
  dismissedPairs: Set<string> = new Set(),
) {
  const referencesByHash = new Map<string, Set<string>>();
  for (const asset of assets) {
    const hash = normalizeHash(asset.perceptualHash);
    if (!hash) continue;
    const references = referencesByHash.get(hash) ?? new Set<string>();
    references.add(String(asset.referenceId));
    referencesByHash.set(hash, references);
  }

  const groups: DuplicateGroup[] = [];
  for (const [perceptualHash, referenceSet] of referencesByHash) {
    const referenceIds = Array.from(referenceSet).sort();
    if (referenceIds.length < 2) continue;

    const connected = connectedDuplicateComponents(referenceIds, dismissedPairs);
    for (const component of connected) {
      if (component.length >= 2) {
        groups.push({ perceptualHash, referenceIds: component });
      }
    }
  }

  return groups.sort(
    (left, right) =>
      right.referenceIds.length - left.referenceIds.length ||
      left.perceptualHash.localeCompare(right.perceptualHash),
  );
}

export function duplicatePairKey(leftReferenceId: string, rightReferenceId: string) {
  return [String(leftReferenceId), String(rightReferenceId)].sort().join(":");
}

export function mergeOrganizationIds(left: string[], right: string[]) {
  return Array.from(new Set([...left.map(String), ...right.map(String)]));
}

function connectedDuplicateComponents(
  referenceIds: string[],
  dismissedPairs: Set<string>,
) {
  const remaining = new Set(referenceIds);
  const components: string[][] = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value as string;
    remaining.delete(start);
    const queue = [start];
    const component = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const candidate of Array.from(remaining)) {
        if (dismissedPairs.has(duplicatePairKey(current, candidate))) continue;
        remaining.delete(candidate);
        queue.push(candidate);
        component.push(candidate);
      }
    }

    components.push(component.sort());
  }

  return components;
}

function normalizeHash(value?: string) {
  const normalized = value?.trim().toLocaleLowerCase() ?? "";
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : "";
}
