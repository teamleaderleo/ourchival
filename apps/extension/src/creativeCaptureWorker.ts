import type { CapturePayload } from "@ourchival/shared";
import {
  appendCreativeCaptureQueueItem,
  createCreativeCaptureQueueItem,
  recordCreativeCaptureFailure,
  removeCreativeCaptureQueueItem,
} from "./creativeCaptureQueue";
import {
  getCreativeCaptureQueue,
  getSettings,
  INLINE_SAVED_KEYS,
  normalizeCaptureEndpoint,
  saveCreativeCaptureEvent,
  saveCreativeCaptureQueue,
  saveLastCapture,
  saveLastResult,
  type BatchCaptureSource,
  type CaptureResult,
  type CreativeCaptureQueueItem,
} from "./storage";

type QueueCaptureMessage = {
  type: "OURCHIVAL_QUEUE_CAPTURE_PAYLOADS";
  payloads: CapturePayload[];
  source?: BatchCaptureSource;
  sourceKey?: string;
};

type CaptureResponse = {
  ok?: boolean;
  error?: string;
  referenceId?: string;
  assetId?: string | null;
  storageStatus?: string;
  alreadySaved?: boolean;
  duplicateReason?: "asset_url" | "canonical_url" | "source_url";
  existingReference?: CaptureResult["existingReference"];
};

type CaptureConnection = {
  endpoint: string;
  deviceToken: string;
};

const MAX_INLINE_SAVED_KEYS = 20_000;
let queueMutationTail: Promise<void> = Promise.resolve();
let queueDraining = false;

chrome.runtime.onMessage.addListener((message: QueueCaptureMessage, _sender, sendResponse) => {
  if (message?.type !== "OURCHIVAL_QUEUE_CAPTURE_PAYLOADS") return false;

  queueMutationTail = queueMutationTail
    .catch(() => undefined)
    .then(async () => {
      const item = createCreativeCaptureQueueItem({
        id: createQueueId(),
        ...(message.sourceKey ? { sourceKey: message.sourceKey } : {}),
        source: message.source ?? "x_post",
        payloads: message.payloads,
      });
      const queue = appendCreativeCaptureQueueItem(
        await getCreativeCaptureQueue(),
        item,
      );
      await saveCreativeCaptureQueue(queue);
      await saveCreativeCaptureEvent({
        queueId: item.id,
        ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
        state: "queued",
        updatedAt: new Date().toISOString(),
      });
      sendResponse({ ok: true, queued: true, queueId: item.id });
      void drainCreativeCaptureQueue();
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: errorMessage(error, "Could not queue this capture."),
      });
    });

  return true;
});

async function drainCreativeCaptureQueue() {
  if (queueDraining) return;
  queueDraining = true;

  try {
    const queuedAtStart = await getCreativeCaptureQueue();
    const ids = queuedAtStart.map((item) => item.id);

    // Attempt each item that existed when this drain began once. Failures stay
    // queued for the next worker start or later enqueue instead of hot-looping.
    for (const id of ids) {
      const queue = await getCreativeCaptureQueue();
      const item = queue.find((candidate) => candidate.id === id);
      if (!item) continue;

      await saveCreativeCaptureEvent({
        queueId: item.id,
        ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
        state: "saving",
        updatedAt: new Date().toISOString(),
      });

      try {
        await captureQueuedGroup(item);
        const latestQueue = await getCreativeCaptureQueue();
        await saveCreativeCaptureQueue(
          removeCreativeCaptureQueueItem(latestQueue, item.id),
        );
        if (item.sourceKey) await rememberSavedSourceKey(item.sourceKey);
        await saveCreativeCaptureEvent({
          queueId: item.id,
          ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
          state: "saved",
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = errorMessage(error, "Creative capture failed.");
        const latestQueue = await getCreativeCaptureQueue();
        await saveCreativeCaptureQueue(
          recordCreativeCaptureFailure(latestQueue, item.id, message),
        );
        await saveCreativeCaptureEvent({
          queueId: item.id,
          ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
          state: "warning",
          updatedAt: new Date().toISOString(),
          error: message,
        });
      }
    }
  } finally {
    queueDraining = false;
  }
}

async function captureQueuedGroup(item: CreativeCaptureQueueItem) {
  const connection = await getCaptureConnection();
  const captureSessionId = `creative-${item.id}`;

  for (const originalPayload of item.payloads) {
    const payload: CapturePayload = {
      ...originalPayload,
      captureSessionId: originalPayload.captureSessionId ?? captureSessionId,
    };
    const result = await capturePayload(connection, payload);
    await saveLastCapture(payload);
    await saveLastResult(toCaptureResult(result));
    if (!result.ok) {
      throw new Error(result.error || `Capture failed with status ${result.status}`);
    }
  }
}

async function getCaptureConnection(): Promise<CaptureConnection> {
  const settings = await getSettings();
  const endpoint = normalizeCaptureEndpoint(settings.captureEndpoint);
  const deviceToken = settings.deviceToken?.trim();
  if (!endpoint || !deviceToken) {
    throw new Error("Pair this browser from the Ourchival Clipper popup first.");
  }
  return { endpoint, deviceToken };
}

async function capturePayload(
  connection: CaptureConnection,
  payload: CapturePayload,
) {
  const response = await fetch(connection.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.deviceToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as CaptureResponse;
  return {
    ok: response.ok && body.ok !== false,
    status: response.status,
    body,
    error: body.error ?? response.statusText,
  };
}

function toCaptureResult(
  result: Awaited<ReturnType<typeof capturePayload>>,
): CaptureResult {
  return {
    ok: result.ok,
    status: result.status,
    message: result.ok
      ? result.body.alreadySaved
        ? "Already saved to Ourchival."
        : ["Saved to Ourchival.", result.body.storageStatus]
            .filter(Boolean)
            .join(" ")
      : result.error,
    storageStatus: result.body.storageStatus,
    referenceId: result.body.referenceId,
    assetId: result.body.assetId,
    alreadySaved: result.body.alreadySaved,
    duplicateReason: result.body.duplicateReason,
    existingReference: result.body.existingReference,
    savedAt: new Date().toISOString(),
  };
}

async function rememberSavedSourceKey(sourceKey: string) {
  const stored = await chrome.storage.local.get(INLINE_SAVED_KEYS);
  const current = Array.isArray(stored[INLINE_SAVED_KEYS])
    ? (stored[INLINE_SAVED_KEYS] as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  const next = [...current.filter((value) => value !== sourceKey), sourceKey].slice(
    -MAX_INLINE_SAVED_KEYS,
  );
  await chrome.storage.local.set({ [INLINE_SAVED_KEYS]: next });
}

function createQueueId() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

void drainCreativeCaptureQueue();
