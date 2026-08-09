export type CaptureSessionReviewDestination =
  | "inbox"
  | "keep"
  | "later"
  | "archive"
  | "trash";

type ReviewableReference = {
  triageState?: "inbox" | "kept" | "later";
  archived: boolean;
  deleted: boolean;
};

export function captureSessionReviewPatch(
  destination: CaptureSessionReviewDestination,
  reviewedAt: number,
) {
  if (destination === "inbox") {
    return {
      triageState: "inbox" as const,
      reviewedAt,
      archived: false,
      deleted: false,
    };
  }
  if (destination === "keep") {
    return {
      triageState: "kept" as const,
      reviewedAt,
      archived: false,
      deleted: false,
    };
  }
  if (destination === "later") {
    return {
      triageState: "later" as const,
      reviewedAt,
      archived: false,
      deleted: false,
    };
  }
  if (destination === "archive") {
    return { reviewedAt, archived: true, deleted: false };
  }
  return { reviewedAt, archived: true, deleted: true };
}

export function captureSessionReviewDestination(
  reference: ReviewableReference,
): CaptureSessionReviewDestination {
  if (reference.deleted) return "trash";
  if (reference.archived) return "archive";
  if (reference.triageState === "later") return "later";
  if (reference.triageState === "inbox") return "inbox";
  return "keep";
}

export function isPendingCaptureSessionReference(reference: ReviewableReference) {
  return !reference.deleted && !reference.archived && reference.triageState === "inbox";
}
