import type { BatchCaptureState } from "./storage";

export type SessionReportConnection = {
  endpoint: string;
  deviceToken: string;
};

type ReportCheckpoint = {
  completed: number;
  attemptedAt: number;
};

type ConvexMutationResponse = {
  status?: "success" | "error";
  errorMessage?: string;
};

const reportCheckpoints = new Map<string, ReportCheckpoint>();
const reportEveryItems = 8;
const reportEveryMs = 2_000;

export function captureSessionReport(state: BatchCaptureState) {
  const sourceItem = state.items.find((item) => item.payload?.sourceUrl || item.url);
  const sourceUrl = sourceItem?.payload?.sourceUrl ?? sourceItem?.url;
  const startedAt = Date.parse(state.startedAt);
  const completedAt = state.completedAt ? Date.parse(state.completedAt) : undefined;

  return {
    sessionKey: state.jobId,
    source: state.source,
    kind: state.source === "x_post" ? ("bundle" as const) : ("import" as const),
    label: captureSessionLabel(state),
    ...(state.source === "x_post" && sourceUrl ? { sourceUrl } : {}),
    expectedCount: state.total,
    completedCount: state.completed,
    savedCount: state.saved,
    duplicateCount: state.duplicates,
    skippedCount: state.skipped,
    failedCount: state.failed,
    status: state.running
      ? ("running" as const)
      : state.completedAt
        ? ("completed" as const)
        : ("interrupted" as const),
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    ...(completedAt && Number.isFinite(completedAt) ? { completedAt } : {}),
  };
}

export function convexMutationUrl(captureEndpoint: string) {
  try {
    const url = new URL(captureEndpoint);
    if (url.hostname.endsWith(".convex.site")) {
      url.hostname = url.hostname.replace(/\.convex\.site$/, ".convex.cloud");
    } else if (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3211"
    ) {
      url.port = "3210";
    } else if (!url.hostname.endsWith(".convex.cloud")) {
      return undefined;
    }
    url.pathname = "/api/mutation";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function reportCaptureSession(
  connection: SessionReportConnection,
  state: BatchCaptureState,
  options: { force?: boolean } = {},
) {
  const endpoint = convexMutationUrl(connection.endpoint);
  if (!endpoint) return { reported: false, reason: "unsupported_endpoint" as const };

  const now = Date.now();
  const previous = reportCheckpoints.get(state.jobId);
  if (
    !options.force &&
    previous &&
    state.completed - previous.completed < reportEveryItems &&
    now - previous.attemptedAt < reportEveryMs
  ) {
    return { reported: false, reason: "throttled" as const };
  }
  reportCheckpoints.set(state.jobId, { completed: state.completed, attemptedAt: now });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "captureSessions:reportFromClipper",
        args: {
          deviceToken: connection.deviceToken,
          ...captureSessionReport(state),
        },
        format: "json",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ConvexMutationResponse;
    if (!response.ok || body.status === "error") {
      return {
        reported: false,
        reason: "request_failed" as const,
        error: body.errorMessage ?? response.statusText,
      };
    }
    return { reported: true as const };
  } catch (error) {
    return {
      reported: false,
      reason: "request_failed" as const,
      error: error instanceof Error ? error.message : "Session report failed.",
    };
  }
}

function captureSessionLabel(state: BatchCaptureState) {
  const firstTitle = state.items.find((item) => item.title)?.title?.trim();
  if (state.source === "x_post") {
    return firstTitle || `${state.total} captured images`;
  }
  if (state.source === "current_tab") return firstTitle || "Current tab";
  if (state.source === "selected_tabs") return `${state.total} selected tabs`;
  if (state.source === "window") return `${state.total} tabs from browser window`;
  if (state.source === "bookmarks") return `${state.total} imported bookmarks`;
  if (state.source === "retry") return `${state.total} retried captures`;
  return `${state.total} imported URLs`;
}
