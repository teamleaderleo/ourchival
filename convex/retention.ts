import { internalMutation } from "./_generated/server";

// Bounded janitor for write-once operational history. Receipts
// (captureSessions) and live jobs are never touched; only terminal,
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

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let observations = 0;
    let jobs = 0;

    const sessions = await ctx.db
      .query("captureSessions")
      .withIndex("by_updated_at")
      .order("asc")
      .take(sessionBatch);
    for (const session of sessions) {
      if (session.status !== "completed" && session.status !== "interrupted")
        continue;
      if (session.updatedAt > now - observationsTtlMs) continue;
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

    return { observations, jobs };
  },
});
