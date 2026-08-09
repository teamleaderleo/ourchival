import type { CapturePayload } from "@ourchival/shared";
import type {
  BatchCaptureSource,
  CreativeCaptureQueueItem,
} from "./storage";

export const MAX_CREATIVE_CAPTURE_QUEUE_ITEMS = 500;
export const MAX_CREATIVE_CAPTURE_PAYLOADS_PER_ITEM = 16;
export const MAX_CREATIVE_CAPTURE_QUEUE_BYTES = 4_000_000;

export function createCreativeCaptureQueueItem(args: {
  id: string;
  sourceKey?: string;
  source: BatchCaptureSource;
  payloads: CapturePayload[];
  queuedAt?: string;
}): CreativeCaptureQueueItem {
  if (!args.id.trim()) throw new Error("Creative capture queue item needs an ID.");
  if (args.payloads.length === 0) {
    throw new Error("Creative capture queue item needs at least one payload.");
  }
  if (args.payloads.length > MAX_CREATIVE_CAPTURE_PAYLOADS_PER_ITEM) {
    throw new Error(
      `Creative capture queue item exceeds ${MAX_CREATIVE_CAPTURE_PAYLOADS_PER_ITEM} payloads.`,
    );
  }

  return {
    id: args.id,
    ...(args.sourceKey?.trim() ? { sourceKey: args.sourceKey.trim() } : {}),
    source: args.source,
    payloads: args.payloads,
    queuedAt: args.queuedAt ?? new Date().toISOString(),
    attempts: 0,
  };
}

export function appendCreativeCaptureQueueItem(
  queue: CreativeCaptureQueueItem[],
  item: CreativeCaptureQueueItem,
) {
  const replacesExisting = queue.some(
    (existing) =>
      existing.id === item.id ||
      Boolean(item.sourceKey && existing.sourceKey === item.sourceKey),
  );
  const withoutSameId = queue.filter((existing) => existing.id !== item.id);
  const withoutSameSource = item.sourceKey
    ? withoutSameId.filter((existing) => existing.sourceKey !== item.sourceKey)
    : withoutSameId;

  if (!replacesExisting && withoutSameSource.length >= MAX_CREATIVE_CAPTURE_QUEUE_ITEMS) {
    throw new Error(
      `Creative capture queue is full (${MAX_CREATIVE_CAPTURE_QUEUE_ITEMS} items).`,
    );
  }

  const next = [...withoutSameSource, item];
  if (serializedByteLength(next) > MAX_CREATIVE_CAPTURE_QUEUE_BYTES) {
    throw new Error(
      `Creative capture queue exceeds its ${MAX_CREATIVE_CAPTURE_QUEUE_BYTES}-byte storage budget.`,
    );
  }
  return next;
}

export function removeCreativeCaptureQueueItem(
  queue: CreativeCaptureQueueItem[],
  id: string,
) {
  return queue.filter((item) => item.id !== id);
}

export function recordCreativeCaptureFailure(
  queue: CreativeCaptureQueueItem[],
  id: string,
  error: string,
) {
  return queue.map((item) =>
    item.id === id
      ? {
          ...item,
          attempts: item.attempts + 1,
          lastError: error,
        }
      : item,
  );
}

function serializedByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
