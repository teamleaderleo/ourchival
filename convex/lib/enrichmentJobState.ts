export type EnrichmentJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "dismissed";

export function canRetryEnrichmentJob(status: EnrichmentJobStatus) {
  return status === "failed" || status === "dismissed" || status === "succeeded";
}

export function canDismissEnrichmentJob(status: EnrichmentJobStatus) {
  return status !== "running" && status !== "dismissed";
}

export function isActiveEnrichmentJob(status: EnrichmentJobStatus) {
  return status === "queued" || status === "running";
}
