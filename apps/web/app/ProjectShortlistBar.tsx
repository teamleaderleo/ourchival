"use client";
import { useState, type FormEvent } from "react";
import { useBatchSelection } from "./batchSelection";
import {
  saveProjectUses,
  useAllReferenceProjects,
} from "./useReferenceProjects";

export function ProjectShortlistBar() {
  const { selectedIds, clear } = useBatchSelection();
  return selectedIds.length ? (
    <ShortlistSelection referenceIds={selectedIds} onClear={clear} />
  ) : null;
}

function ShortlistSelection({
  referenceIds,
  onClear,
}: {
  referenceIds: string[];
  onClear: () => void;
}) {
  const projects = useAllReferenceProjects();
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!projectId || busy) return;
    const count = referenceIds.length;
    setBusy(true);
    try {
      const receipt = await saveProjectUses({ projectId, referenceIds });
      setMessage(
        `${receipt.updated} of ${count} references added to the shortlist. This does not mark them as used.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save the shortlist. Your selection is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="project-shortlist-bar"
      aria-label="Project shortlist selection"
    >
      <form onSubmit={save}>
        <strong>{referenceIds.length} selected</strong>
        <select
          aria-label="Shortlist project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={busy}
        >
          <option value="">Choose project</option>
          {projects
            .filter((p) => p.status !== "archived")
            .map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          className="button primary"
          disabled={busy || !projectId || referenceIds.length > 96}
        >
          {busy ? "Saving…" : "Add to shortlist"}
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={onClear}
          disabled={busy}
        >
          Clear selection
        </button>
      </form>
      {!projects.length ? (
        <p>
          Choose or create a project in Projects above, then add these
          references.
        </p>
      ) : null}
      {referenceIds.length > 96 ? (
        <p>
          Choose up to 96 references at a time. Your selection has been
          preserved.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
