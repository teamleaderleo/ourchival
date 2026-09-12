import type { FailureRecord } from "./failureLog";

export function diagnoseFailure(record: Pick<FailureRecord, "message" | "httpStatus" | "stage" | "attempts">) {
  const text = record.message.toLowerCase();
  const status = record.httpStatus ?? Number(text.match(/(?:http|status)\s*[:=]?\s*(\d{3})/i)?.[1]);
  if (status === 429 || /rate.limit|too many requests/.test(text))
    return { category: "temporary", label: "Rate limited", action: "Let the import back off before retrying. Starting another pass can prolong the limit." };
  if (status === 401 || /sign.in|log.in|authentication/.test(text))
    return { category: "attention", label: "Session needs attention", action: "Check that the source tab is signed in, then resume the retained import." };
  if (status === 403)
    return { category: "attention", label: "Access refused", action: "Check source access and image request context. A 403 does not prove the artwork was deleted." };
  if (status === 404 || status === 410 || /deleted|private|unavailable bookmark/.test(text))
    return { category: "unavailable", label: "Source unavailable", action: "Check the source when convenient. Preserve this record; repeated immediate retries may not help." };
  if (status >= 500 || /timeout|timed out|network|fetch failed|failed to fetch|internal server error|receiving end|connection/.test(text))
    return record.attempts >= 5
      ? { category: "attention", label: "Repeated failure", action: "Inspect the saved error before another full pass. This may require a reader or storage fix." }
      : { category: "temporary", label: "Temporary failure", action: "Resume the retained import after its retry delay; saved images and checkpoints can be reused." };
  return { category: "attention", label: record.stage === "metadata" ? "Metadata gap" : "Needs investigation", action: "Inspect this artwork and its saved error. Do not treat it as complete or assume another full scan will fix it." };
}
