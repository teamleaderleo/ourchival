import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "queue missing media derivatives",
  { minutes: 1 },
  internal.mediaDerivatives.queueMissing,
  { limit: 4 },
);

export default crons;
