import type { CapturePayload } from "@ourchival/shared";
import type {
  BatchCaptureSource,
  CreativeCaptureQueueItem,
} from "./storage";

export const MAX_CREATIVE_CAPTURE_QUEUE_ITEMS = 500;
export const MAX_CREATIVE_CAPTURE_PAYLOADS_PER_ITEM = 16;

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
  const withoutSameId = queue.filter((existing) => existing.id !== item.id);
  const withoutSameSource = item.sourceKey
    ? withoutSameId.filter((existing) => existing.sourceKey !== item.sourceKey)
    : withoutSameId;
  return [...withoutSameSource, item].slice(-MAX_CREATIVE_CAPTURE_QUEUE_ITEMS);
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
