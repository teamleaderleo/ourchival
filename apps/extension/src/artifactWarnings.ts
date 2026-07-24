export type ArtifactWarningKind =
  | "page_screenshot"
  | "readable_text"
  | "page_snapshot";

export type ArtifactWarning = {
  referenceId: string;
  kind: ArtifactWarningKind;
  error: string;
  updatedAt: string;
};

export const ARTIFACT_WARNINGS_KEY = "ourchivalArtifactWarnings";

const maxWarnings = 24;
let warningWrite = Promise.resolve();

export async function trackArtifactResult<T extends {
  uploaded: boolean;
  reason?: string;
  error?: string;
}>(
  referenceId: string | undefined,
  kind: ArtifactWarningKind,
  result: T,
): Promise<T> {
  if (!referenceId || result.reason === "missing_capture") return result;
  if (result.uploaded) {
    await removeArtifactWarning(referenceId, kind);
  } else {
    await recordArtifactWarning({
      referenceId,
      kind,
      error: cleanError(result.error, result.reason),
      updatedAt: new Date().toISOString(),
    });
  }
  return result;
}

export async function listArtifactWarnings() {
  const values = await chrome.storage.local.get(ARTIFACT_WARNINGS_KEY);
  return normalizeWarnings(values[ARTIFACT_WARNINGS_KEY]);
}

export async function clearArtifactWarnings() {
  await enqueueWarningWrite(async () => {
    await chrome.storage.local.remove(ARTIFACT_WARNINGS_KEY);
  });
}

async function recordArtifactWarning(warning: ArtifactWarning) {
  await enqueueWarningWrite(async () => {
    const current = await listArtifactWarnings();
    const next = [
      warning,
      ...current.filter(
        (item) =>
          item.referenceId !== warning.referenceId || item.kind !== warning.kind,
      ),
    ].slice(0, maxWarnings);
    await chrome.storage.local.set({ [ARTIFACT_WARNINGS_KEY]: next });
  });
}

async function removeArtifactWarning(
  referenceId: string,
  kind: ArtifactWarningKind,
) {
  await enqueueWarningWrite(async () => {
    const current = await listArtifactWarnings();
    const next = current.filter(
      (item) => item.referenceId !== referenceId || item.kind !== kind,
    );
    if (next.length === current.length) return;
    if (next.length) {
      await chrome.storage.local.set({ [ARTIFACT_WARNINGS_KEY]: next });
    } else {
      await chrome.storage.local.remove(ARTIFACT_WARNINGS_KEY);
    }
  });
}

async function enqueueWarningWrite(operation: () => Promise<void>) {
  const next = warningWrite.then(operation, operation);
  warningWrite = next.catch(() => undefined);
  await next;
}

function normalizeWarnings(value: unknown): ArtifactWarning[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ArtifactWarning => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<ArtifactWarning>;
      return (
        typeof candidate.referenceId === "string" &&
        isArtifactKind(candidate.kind) &&
        typeof candidate.error === "string" &&
        typeof candidate.updatedAt === "string"
      );
    })
    .slice(0, maxWarnings);
}

function isArtifactKind(value: unknown): value is ArtifactWarningKind {
  return (
    value === "page_screenshot" ||
    value === "readable_text" ||
    value === "page_snapshot"
  );
}

function cleanError(error: string | undefined, reason: string | undefined) {
  return (error?.trim() || reason?.trim() || "Preservation upload failed.").slice(
    0,
    500,
  );
}
