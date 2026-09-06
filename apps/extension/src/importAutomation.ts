export const AUTOMATION_KEY = "importAutomation";
export const HEARTBEATS_KEY = "importReaderHeartbeats";
export const AUTOMATION_ALARM = "ourchival-import-recovery";
export type ImportPurpose = "history" | "sync" | "repair";
export type AutomationState = {
  enabled?: boolean;
  pausedSources?: string[];
  syncAfter?: Record<string, number>;
  repairAfter?: Record<string, number>;
  requestedSync?: string[];
  message?: string;
};
export type ReaderHeartbeat = {
  at: number;
  phase: "reading" | "saving";
  tabId: number;
};
export const syncInterval = 6 * 60 * 60_000;
export const repairInterval = 24 * 60 * 60_000;
export function retryPlan(
  message: string | undefined,
  attempts = 0,
  now = Date.now(),
) {
  if (
    /invalid_grant|reconnect Google|(?:Google|Drive).*(?:reconnect|authorization)|sign.?in|log.?in|(?:HTTP|status) (401|403)|unauthorized|pair.*again|not configured|env vars.*missing/i.test(
      message ?? "",
    )
  )
    return { attention: true, retryAt: undefined };
  const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  return attempts >= delays.length
    ? { attention: true, retryAt: undefined }
    : { attention: false, retryAt: now + delays[attempts]! };
}
export function readerIsStalled(args: {
  now: number;
  updatedAt: string;
  workerTabId?: number;
  heartbeat?: ReaderHeartbeat;
  batchUpdatedAt?: string;
  activeBatch: boolean;
}) {
  if (args.activeBatch) return false;
  const heartbeat =
    args.heartbeat?.tabId === args.workerTabId ? args.heartbeat : undefined;
  const lastProgress = Math.max(
    Date.parse(args.updatedAt) || 0,
    Date.parse(args.batchUpdatedAt ?? "") || 0,
    heartbeat?.phase === "reading" ? heartbeat.at : 0,
  );
  return args.now - lastProgress > 3 * 60_000;
}
