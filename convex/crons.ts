import {
  cronJobs,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { internal } from "./_generated/api";

const queueMissingMedia = makeFunctionReference<
  "mutation",
  { limit?: number },
  { queued: number; active: number; skipped: number }
>("mediaDerivatives:queueMissing") as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit?: number },
  { queued: number; active: number; skipped: number }
>;

const queueDriveDerivatives = makeFunctionReference<
  "mutation",
  { limit?: number },
  { queued: number; active: number; skipped: number }
>("driveDerivatives:queueMissing") as unknown as FunctionReference<
  "mutation",
  "internal",
  { limit?: number },
  { queued: number; active: number; skipped: number }
>;

const crons = cronJobs();

crons.interval(
  "queue missing media derivatives",
  { minutes: 2 },
  queueMissingMedia,
  { limit: 8 },
);

// Daily janitor: terminal capture observations (>7d) and enrichment jobs
// (>30d). Receipts and live jobs are never touched; each run is capped.
crons.interval("retention sweep", { hours: 24 }, internal.retention.sweep, {});

// Derivative mirrors to Drive: verified size + md5 before the IDs are
// recorded, Convex blobs stay as fallback until reclaimed separately.
crons.interval(
  "queue missing drive derivatives",
  { minutes: 5 },
  queueDriveDerivatives,
  { limit: 4 },
);

export default crons;
