// Every patch creates a full document revision in the vault's history, even
// when the only difference is a timestamp. These helpers let a write site
// skip revisions that would carry no information, or throttle heartbeat-style
// timestamps to a coarse resolution.

/** Whether any field in `patch` differs from `existing`, ignoring `ignored`. */
export function patchChangesFields<T extends object>(
  existing: T,
  patch: Partial<T>,
  ignored: readonly (keyof T)[] = [],
): boolean {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (ignored.includes(key)) continue;
    if (!Object.is(existing[key], patch[key])) return true;
  }
  return false;
}

/** Whether a timestamp-only bump from `previous` to `next` is worth a revision. */
export function timestampBumpDue(
  previous: number | undefined,
  next: number,
  resolutionMs: number,
): boolean {
  return previous === undefined || next - previous >= resolutionMs;
}

// Capture clients re-report progress and observations they have already sent,
// so most reports leave the session unchanged. Bumping updatedAt on each of them produced
// thousands of timestamp-only session revisions. An hourly resolution keeps
// updatedAt a truthful "still reporting" signal for listRecent ordering, the
// "Last checkpoint" label and retention's 7-day observation TTL.
export const CAPTURE_SESSION_TOUCH_RESOLUTION_MS = 60 * 60 * 1000;
