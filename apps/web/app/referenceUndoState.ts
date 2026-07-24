import {
  referenceCollection,
  type ReferenceCollection,
  type SavedReference,
} from "./referenceVaultModel";
import type { VaultView } from "./VaultNavigation";

export type ReferenceUndoMove = {
  referenceId: string;
  title: string;
  before: SavedReference;
  after: SavedReference;
};

export function createReferenceUndoMove(
  reference: SavedReference,
  patch: Partial<SavedReference>,
): ReferenceUndoMove {
  return {
    referenceId: reference._id,
    title: reference.title || reference.sourceUrl,
    before: reference,
    after: { ...reference, ...patch },
  };
}

export function mergeRestoredReference(
  undo: ReferenceUndoMove,
  restoredPatch: Partial<SavedReference>,
): SavedReference {
  return {
    ...undo.before,
    ...restoredPatch,
  };
}

export function restoredReferenceView(reference: SavedReference): VaultView {
  return viewForCollection(referenceCollection(reference));
}

function viewForCollection(collection: ReferenceCollection): VaultView {
  if (collection === "inbox") return "inbox";
  if (collection === "later") return "later";
  if (collection === "archive") return "archive";
  if (collection === "trash") return "trash";
  return "all";
}
