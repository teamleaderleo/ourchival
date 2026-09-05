"use client";
import { useState } from "react";
import { ReferenceVisualMetadata } from "./ReferenceVisualMetadata";

import { ReferenceBoardAssignment } from "./BoardPanel";
import { ReferenceEnrichmentPanel } from "./ReferenceEnrichmentPanel";
import { ReferenceProjectAssignment } from "./ProjectPanel";
import { RelatedReferencesPanel } from "./RelatedReferencesPanel";
import { ReferenceSuggestedTagsPanel } from "./ReferenceSuggestedTagsPanel";
import { referenceMode, type SavedReference } from "./referenceVaultModel";

export function InspectorOrganization({
  reference,
}: {
  reference: SavedReference;
}) {
  const [metadataOpen, setMetadataOpen] = useState(false);
  const linkLike = referenceMode(reference.kind) === "links";

  return (
    <div
      className="inspector-organization"
      aria-label="Reference organization and discovery"
    >
      {reference.assets.length ? (
        <details
          onToggle={(event) => setMetadataOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Image metadata</span>
            <small>Review generated terms</small>
          </summary>
          {metadataOpen ? (
            <ReferenceVisualMetadata
              key={reference._id}
              reference={reference}
            />
          ) : null}
        </details>
      ) : null}
      <details open>
        <summary>
          <span>Organize</span>
          <small>Boards · projects</small>
        </summary>
        <div className="inspector-organization-body">
          <ReferenceBoardAssignment reference={reference} />
          <ReferenceProjectAssignment reference={reference} />
        </div>
      </details>

      <details>
        <summary>
          <span>Discover</span>
          <small>Suggestions · related</small>
        </summary>
        <div className="inspector-organization-body">
          <ReferenceSuggestedTagsPanel referenceId={reference._id} />
          <RelatedReferencesPanel referenceId={reference._id} />
          <ReferenceEnrichmentPanel
            referenceId={reference._id}
            enabled={linkLike}
          />
        </div>
      </details>
    </div>
  );
}
