import { internalMutation } from "./_generated/server";

// Bounded janitor for write-once operational history. Receipts
// (captureSessions) are kept (the sweep only stamps observationsSweptAt)
// and live jobs are never touched; only terminal,
// aged-out rows go, capped per run so a large backlog drains over days
// instead of blowing a transaction.
const observationsTtlMs = 7 * 24 * 60 * 60 * 1000;
const jobsTtlMs = 30 * 24 * 60 * 60 * 1000;
const sessionBatch = 50;
const observationBatch = 1000;
const jobBatch = 500;

const observationStatuses = [
  "discovered",
  "rendered",
  "archived",
  "failed",
] as const;
const sweptSessionStatuses = ["completed", "interrupted"] as const;

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let observations = 0;
    let jobs = 0;
    let sessionsSwept = 0;

    // Only terminal, aged-out, not-yet-drained sessions are read, so
    // running sessions and already-swept receipts can never pin the batch
    // and starve newer eligible sessions.
    const cutoff = now - observationsTtlMs;
    const sessions = [];
    for (const status of sweptSessionStatuses) {
      if (sessions.length >= sessionBatch) break;
      sessions.push(
        ...(await ctx.db
          .query("captureSessions")
          .withIndex("by_status_and_observations_swept_at_and_updated_at", (q) =>
            q
              .eq("status", status)
              .eq("observationsSweptAt", undefined)
              .lte("updatedAt", cutoff),
          )
          .order("asc")
          .take(sessionBatch - sessions.length)),
      );
    }
    for (const session of sessions) {
      let drained = true;
      for (const status of observationStatuses) {
        const rows = await ctx.db
          .query("captureObservations")
          .withIndex("by_session_key_and_status", (q) =>
            q.eq("sessionKey", session.sessionKey).eq("status", status),
          )
          .take(observationBatch);
        for (const row of rows) {
          await ctx.db.delete(row._id);
          observations += 1;
        }
        if (rows.length >= observationBatch) drained = false;
      }
      // A session with more rows than one batch stays eligible and is
      // resumed next run; a drained one drops out of the index range.
      if (drained) {
        await ctx.db.patch(session._id, { observationsSweptAt: now });
        sessionsSwept += 1;
      }
    }

    const candidates = await ctx.db
      .query("enrichmentJobs")
      .withIndex("by_updated_at")
      .order("asc")
      .take(jobBatch);
    for (const job of candidates) {
      if (
        job.status !== "succeeded" &&
        job.status !== "failed" &&
        job.status !== "dismissed"
      )
        continue;
      if (job.updatedAt > now - jobsTtlMs) continue;
      await ctx.db.delete(job._id);
      jobs += 1;
    }

    return { observations, jobs, sessionsSwept };
  },
});
