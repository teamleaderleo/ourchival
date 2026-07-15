import {
  cronJobs,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

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

const crons = cronJobs();

crons.interval(
  "queue missing media derivatives",
  { minutes: 1 },
  queueMissingMedia,
  { limit: 4 },
);

export default crons;
