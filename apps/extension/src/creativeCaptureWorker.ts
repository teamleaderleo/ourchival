import type { CapturePayload } from "@ourchival/shared";
import {
  appendCreativeCaptureQueueItem,
  createCreativeCaptureQueueItem,
  recordCreativeCaptureFailure,
  removeCreativeCaptureQueueItem,
} from "./creativeCaptureQueue";
import { reportCaptureSession } from "./sessionReporting";
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
  type BatchCaptureState,
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

class CaptureHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaptureHttpError";
  }
}

const MAX_INLINE_SAVED_KEYS = 20_000;
const CREATIVE_QUEUE_RECOVERY_ALARM = "ourchival-creative-capture-recovery";
const RECOVERY_DELAY_MINUTES = 0.5;
let queueMutationTail: Promise<void> = Promise.resolve();
let queueDraining = false;
let activeQueueId: string | undefined;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isCreativeQueueMessage(message)) return false;

  let candidate: CreativeCaptureQueueItem;
  try {
    candidate = createCreativeCaptureQueueItem({
      id: createQueueId(),
      ...(message.sourceKey ? { sourceKey: message.sourceKey } : {}),
      source: message.source ?? "x_post",
      payloads: message.payloads,
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: errorMessage(error, "Could not validate this capture."),
    });
    return false;
  }

  void mutateCreativeCaptureQueue((queue) => {
    const activeSameSource = candidate.sourceKey
      ? queue.find(
          (item) =>
            item.id === activeQueueId && item.sourceKey === candidate.sourceKey,
        )
      : undefined;
    if (activeSameSource) {
      return { queue, result: activeSameSource };
    }

    const next = appendCreativeCaptureQueueItem(queue, candidate);
    const persisted = candidate.sourceKey
      ? next.find((item) => item.sourceKey === candidate.sourceKey)
      : next.find((item) => item.id === candidate.id);
    if (!persisted) {
      throw new Error("Queued creative capture could not be resolved after persistence.");
    }
    return { queue: next, result: persisted };
  })
    .then((item) => {
      // Persistence is the acknowledgement boundary. These helpers improve
      // recovery/visibility, but a transient helper failure must not turn a
      // safely queued deliberate save into an apparent rejection.
      void ensureRecoveryWakeup().catch(() => undefined);
      void saveCreativeCaptureEvent({
        queueId: item.id,
        ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
        state: activeQueueId === item.id ? "saving" : "queued",
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      sendResponse({ ok: true, queued: true, queueId: item.id });
      void drainCreativeCaptureQueue().catch(() => undefined);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: errorMessage(error, "Could not queue this capture."),
      });
    });

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CREATIVE_QUEUE_RECOVERY_ALARM) {
    void drainCreativeCaptureQueue().catch(() => undefined);
  }
});

async function drainCreativeCaptureQueue() {
  if (queueDraining) return;
  queueDraining = true;
  let attemptedIds = new Set<string>();

  try {
    const queuedAtStart = await readCreativeCaptureQueue();
    const ids = queuedAtStart.map((item) => item.id);
    attemptedIds = new Set(ids);

    // Attempt each item that existed when this drain began once. Failures stay
    // queued for a later worker wake-up instead of hot-looping.
    for (const id of ids) {
      const queue = await readCreativeCaptureQueue();
      const item = queue.find((candidate) => candidate.id === id);
      if (!item) continue;

      activeQueueId = item.id;
      void saveCreativeCaptureEvent({
        queueId: item.id,
        ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
        state: "saving",
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);

      try {
        try {
          await captureQueuedGroup(item);
        } catch (error) {
          const message = errorMessage(error, "Creative capture failed.");
          let queueWriteFailed = false;
          try {
            await mutateCreativeCaptureQueue((current) => ({
              queue: recordCreativeCaptureFailure(current, item.id, message),
              result: undefined,
            }));
          } catch {
            queueWriteFailed = true;
          }
          void saveCreativeCaptureEvent({
            queueId: item.id,
            ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
            state: "warning",
            updatedAt: new Date().toISOString(),
            error: message,
          }).catch(() => undefined);
          if (queueWriteFailed || shouldStopDrain(error)) break;
          continue;
        }

        // Remote capture has completed. Removing the durable queue entry is the
        // only critical local success write; Saved-cache/UI updates are helpers.
        try {
          await mutateCreativeCaptureQueue((current) => ({
            queue: removeCreativeCaptureQueueItem(current, item.id),
            result: undefined,
          }));
        } catch (error) {
          void saveCreativeCaptureEvent({
            queueId: item.id,
            ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
            state: "warning",
            updatedAt: new Date().toISOString(),
            error: `Saved remotely; local queue cleanup failed: ${errorMessage(error, "storage error")}`,
          }).catch(() => undefined);
          break;
        }

        if (item.sourceKey) {
          void rememberSavedSourceKey(item.sourceKey).catch(() => undefined);
        }
        void saveCreativeCaptureEvent({
          queueId: item.id,
          ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
          state: "saved",
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
      } finally {
        if (activeQueueId === item.id) activeQueueId = undefined;
      }
    }
  } finally {
    queueDraining = false;
    activeQueueId = undefined;
    // Run one follow-up pass only for IDs that arrived after this pass began;
    // failed IDs from this pass wait for a later wake-up.
    try {
      const remaining = await readCreativeCaptureQueue();
      if (remaining.length === 0) {
        await chrome.alarms.clear(CREATIVE_QUEUE_RECOVERY_ALARM);
      } else if (remaining.some((item) => !attemptedIds.has(item.id))) {
        void drainCreativeCaptureQueue().catch(() => undefined);
      }
    } catch {
      // The persisted queue remains available for the next worker startup.
    }
  }
}

async function captureQueuedGroup(item: CreativeCaptureQueueItem) {
  const connection = await getCaptureConnection();
  const captureSessionId = `creative-${item.id}`;
  const session = createSessionState(item, captureSessionId);
  await reportCaptureSession(connection, session, { force: true });

  try {
    for (const originalPayload of item.payloads) {
      const payload: CapturePayload = {
        ...originalPayload,
        captureSessionId: originalPayload.captureSessionId ?? captureSessionId,
      };
      const result = await capturePayload(connection, payload);
      await saveLastCapture(payload);
      await saveLastResult(toCaptureResult(result));
      session.completed += 1;
      session.nextIndex = session.completed;

      if (!result.ok) {
        session.failed += 1;
        session.running = false;
        await reportCaptureSession(connection, session, { force: true });
        throw new CaptureHttpError(
          result.error || `Capture failed with status ${result.status}`,
          result.status,
        );
      }

      if (result.body.alreadySaved) session.duplicates += 1;
      else session.saved += 1;
      await reportCaptureSession(connection, session);
    }

    session.running = false;
    session.completedAt = new Date().toISOString();
    await reportCaptureSession(connection, session, { force: true });
  } catch (error) {
    if (session.running) {
      session.running = false;
      await reportCaptureSession(connection, session, { force: true });
    }
    throw error;
  }
}

function createSessionState(
  item: CreativeCaptureQueueItem,
  captureSessionId: string,
): BatchCaptureState {
  return {
    jobId: captureSessionId,
    source: item.source,
    running: true,
    startedAt: item.queuedAt,
    total: item.payloads.length,
    completed: 0,
    nextIndex: 0,
    saved: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    items: item.payloads.map((payload) => ({
      url: payload.sourceUrl,
      title: payload.pageTitle,
      payload,
    })),
    successfulTabIds: [],
    failures: [],
  };
}

async function mutateCreativeCaptureQueue<T>(
  mutation: (
    queue: CreativeCaptureQueueItem[],
  ) => { queue: CreativeCaptureQueueItem[]; result: T },
): Promise<T> {
  let resolveResult: ((value: T) => void) | undefined;
  let rejectResult: ((reason: unknown) => void) | undefined;
  const resultPromise = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  queueMutationTail = queueMutationTail
    .catch(() => undefined)
    .then(async () => {
      try {
        const current = await getCreativeCaptureQueue();
        const next = mutation(current);
        await saveCreativeCaptureQueue(next.queue);
        resolveResult?.(next.result);
      } catch (error) {
        rejectResult?.(error);
      }
    });

  return await resultPromise;
}

async function readCreativeCaptureQueue() {
  await queueMutationTail.catch(() => undefined);
  return await getCreativeCaptureQueue();
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

function shouldStopDrain(error: unknown) {
  if (!(error instanceof CaptureHttpError)) return true;
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 429 ||
    error.status >= 500
  );
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

async function ensureRecoveryWakeup() {
  const existing = await chrome.alarms.get(CREATIVE_QUEUE_RECOVERY_ALARM);
  if (existing) return;
  await chrome.alarms.create(CREATIVE_QUEUE_RECOVERY_ALARM, {
    delayInMinutes: RECOVERY_DELAY_MINUTES,
  });
}

function isCreativeQueueMessage(value: unknown): value is QueueCaptureMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QueueCaptureMessage>;
  return (
    candidate.type === "OURCHIVAL_QUEUE_CAPTURE_PAYLOADS" &&
    Array.isArray(candidate.payloads)
  );
}

function createQueueId() {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

void readCreativeCaptureQueue()
  .then((queue) => {
    if (queue.length > 0) void ensureRecoveryWakeup().catch(() => undefined);
  })
  .catch(() => undefined);
void drainCreativeCaptureQueue().catch(() => undefined);
