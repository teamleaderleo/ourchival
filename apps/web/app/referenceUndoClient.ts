import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";
import type { SavedReference, TriageState } from "./referenceVaultModel";

type RestoreArgs = {
  accessKey: string;
  referenceId: string;
  triageState: TriageState | null;
  reviewedAt: number | null;
  archived: boolean;
  deleted: boolean;
};

type RestoreResult = {
  _id: string;
  triageState?: TriageState;
  reviewedAt?: number;
  archived: boolean;
  deleted: boolean;
};

const restoreMoveReference = makeFunctionReference<
  "mutation",
  RestoreArgs,
  RestoreResult
>("referenceUndo:restoreMove");

let client: ConvexHttpClient | undefined;

export async function restoreReferenceMove(reference: SavedReference) {
  return await getClient().mutation(
    restoreMoveReference,
    withOwnerAccess({
      referenceId: reference._id,
      triageState: reference.triageState ?? null,
      reviewedAt: reference.reviewedAt ?? null,
      archived: Boolean(reference.archived),
      deleted: Boolean(reference.deleted),
    }),
  );
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before undoing moves.");
  client = new ConvexHttpClient(url);
  return client;
}
