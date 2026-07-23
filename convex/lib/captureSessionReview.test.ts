import { describe, expect, it } from "vitest";
import {
  captureSessionReviewDestination,
  captureSessionReviewPatch,
  isPendingCaptureSessionReference,
} from "./captureSessionReview";

describe("capture session review helpers", () => {
  it("maps review destinations onto the existing reference triage fields", () => {
    expect(captureSessionReviewPatch("keep", 10)).toEqual({
      triageState: "kept",
      reviewedAt: 10,
      archived: false,
      deleted: false,
    });
    expect(captureSessionReviewPatch("later", 11)).toEqual({
      triageState: "later",
      reviewedAt: 11,
      archived: false,
      deleted: false,
    });
    expect(captureSessionReviewPatch("archive", 12)).toEqual({
      reviewedAt: 12,
      archived: true,
      deleted: false,
    });
    expect(captureSessionReviewPatch("trash", 13)).toEqual({
      reviewedAt: 13,
      archived: true,
      deleted: true,
    });
  });

  it("restores a reference to the inbox for undo", () => {
    expect(captureSessionReviewPatch("inbox", 20)).toEqual({
      triageState: "inbox",
      reviewedAt: 20,
      archived: false,
      deleted: false,
    });
  });

  it("derives the current destination for reversible review", () => {
    expect(
      captureSessionReviewDestination({
        triageState: "inbox",
        archived: false,
        deleted: false,
      }),
    ).toBe("inbox");
    expect(
      captureSessionReviewDestination({
        triageState: "later",
        archived: false,
        deleted: false,
      }),
    ).toBe("later");
    expect(
      captureSessionReviewDestination({
        triageState: "kept",
        archived: true,
        deleted: false,
      }),
    ).toBe("archive");
    expect(
      captureSessionReviewDestination({
        triageState: "kept",
        archived: true,
        deleted: true,
      }),
    ).toBe("trash");
  });

  it("treats only active inbox references as pending", () => {
    expect(
      isPendingCaptureSessionReference({
        triageState: "inbox",
        archived: false,
        deleted: false,
      }),
    ).toBe(true);
    expect(
      isPendingCaptureSessionReference({
        triageState: "kept",
        archived: false,
        deleted: false,
      }),
    ).toBe(false);
    expect(
      isPendingCaptureSessionReference({
        triageState: "inbox",
        archived: true,
        deleted: false,
      }),
    ).toBe(false);
  });
});
