"use client";

import { useState, type FormEvent } from "react";
import { useBatchSelection } from "./batchSelection";
import {
  mutateReferencesBoards,
  useAllReferenceBoards,
} from "./useReferenceBoards";
import {
  removeProjectUses,
  saveProjectUses,
  useAllReferenceProjects,
} from "./useReferenceProjects";
import {
  mutateReferencesTags,
  useAllReferenceTags,
} from "./useReferenceTags";

type AddRemove = "add" | "remove";

export function BatchOrganizationBar() {
  const { selectedIds, mountedIds, clear, selectAllMounted } = useBatchSelection();
  const tags = useAllReferenceTags();
  const boards = useAllReferenceBoards();
  const projects = useAllReferenceProjects();
  const [tagName, setTagName] = useState("");
  const [tagAction, setTagAction] = useState<AddRemove>("add");
  const [boardId, setBoardId] = useState("");
  const [boardAction, setBoardAction] = useState<AddRemove>("add");
  const [projectId, setProjectId] = useState("");
  const [projectAction, setProjectAction] = useState<AddRemove>("add");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const selectedCount = selectedIds.length;
  const availableProjects =
    projectAction === "add"
      ? projects.filter((project) => project.status !== "archived")
      : projects;

  async function applyTags(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = tagName.trim();
    if (!value || selectedCount === 0) return;

    setBusy(true);
    setStatus(`${tagAction === "add" ? "Adding" : "Removing"} tag…`);
    try {
      const matchingTag = tags.find(
        (tag) =>
          tag.name.toLocaleLowerCase() === value.toLocaleLowerCase() ||
          tag.slug === slugify(value),
      );
      if (tagAction === "remove" && !matchingTag) {
        throw new Error("Choose an existing tag to remove.");
      }
      const result = await mutateReferencesTags(selectedIds, {
        addNames: tagAction === "add" ? [value] : [],
        removeIds: tagAction === "remove" && matchingTag ? [matchingTag._id] : [],
      });
      setStatus(
        `${tagAction === "add" ? "Added" : "Removed"} tag for ${referenceCountLabel(result.updated)}.`,
      );
      if (tagAction === "add") setTagName("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update tags.");
    } finally {
      setBusy(false);
    }
  }

  async function applyBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!boardId || selectedCount === 0) return;

    setBusy(true);
    setStatus(`${boardAction === "add" ? "Adding to" : "Removing from"} board…`);
    try {
      const result = await mutateReferencesBoards(selectedIds, boardId, boardAction);
      const board = boards.find((item) => item._id === boardId);
      setStatus(
        `${boardAction === "add" ? "Added to" : "Removed from"} “${board?.name ?? "board"}” for ${referenceCountLabel(result.updated)}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update board membership.");
    } finally {
      setBusy(false);
    }
  }

  async function applyProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || selectedCount === 0) return;

    setBusy(true);
    setStatus(`${projectAction === "add" ? "Saving" : "Removing"} project reuse…`);
    try {
      const result =
        projectAction === "add"
          ? await saveProjectUses({
              projectId,
              referenceIds: selectedIds,
              reason: reason.trim() || undefined,
              notes: notes.trim() || undefined,
            })
          : await removeProjectUses(projectId, selectedIds);
      const project = projects.find((item) => item._id === projectId);
      setStatus(
        `${projectAction === "add" ? "Saved reuse in" : "Removed reuse from"} “${project?.name ?? "project"}” for ${referenceCountLabel(result.updated)}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update project reuse.");
    } finally {
      setBusy(false);
    }
  }

  if (mountedIds.length === 0) return null;

  return (
    <section className={`batch-organizer ${selectedCount > 0 ? "active" : ""}`}>
      <div className="batch-organizer-heading">
        <div>
          <strong>Batch organize</strong>
          <span>
            {selectedCount > 0
              ? `${selectedCount} selected on this page`
              : "Select cards to update several references together."}
          </span>
        </div>
        <div className="batch-selection-actions">
          <button
            type="button"
            className="button ghost"
            onClick={selectAllMounted}
            disabled={busy || selectedCount === mountedIds.length}
          >
            Select page
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={clear}
            disabled={busy || selectedCount === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => window.location.reload()}
            disabled={busy}
          >
            Refresh page
          </button>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="batch-organizer-forms">
          <form onSubmit={applyTags}>
            <p>Tags</p>
            <div className="batch-form-row">
              <select
                value={tagAction}
                onChange={(event) => setTagAction(event.target.value as AddRemove)}
                disabled={busy}
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
              <input
                list="batch-tag-options"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder={tagAction === "add" ? "Tag name" : "Existing tag"}
                maxLength={48}
                disabled={busy}
              />
              <datalist id="batch-tag-options">
                {tags.map((tag) => (
                  <option key={tag._id} value={tag.name} />
                ))}
              </datalist>
              <button
                type="submit"
                className="button secondary"
                disabled={busy || !tagName.trim()}
              >
                Apply
              </button>
            </div>
          </form>

          <form onSubmit={applyBoard}>
            <p>Boards</p>
            <div className="batch-form-row">
              <select
                value={boardAction}
                onChange={(event) => setBoardAction(event.target.value as AddRemove)}
                disabled={busy}
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
              <select
                value={boardId}
                onChange={(event) => setBoardId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose board</option>
                {boards.map((board) => (
                  <option key={board._id} value={board._id}>
                    {board.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="button secondary"
                disabled={busy || !boardId}
              >
                Apply
              </button>
            </div>
          </form>

          <form onSubmit={applyProject}>
            <p>Projects</p>
            <div className="batch-form-row project-row">
              <select
                value={projectAction}
                onChange={(event) => {
                  setProjectAction(event.target.value as AddRemove);
                  setProjectId("");
                }}
                disabled={busy}
              >
                <option value="add">Save reuse</option>
                <option value="remove">Remove reuse</option>
              </select>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose project</option>
                {availableProjects.map((project) => (
                  <option key={project._id} value={project._id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {projectAction === "add" ? (
                <>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Shared reuse reason"
                    maxLength={120}
                    disabled={busy}
                  />
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Shared project note"
                    maxLength={1000}
                    disabled={busy}
                  />
                </>
              ) : null}
              <button
                type="submit"
                className="button secondary"
                disabled={busy || !projectId}
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {status ? (
        <p className="batch-status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function slugify(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function referenceCountLabel(count: number) {
  return `${count} ${count === 1 ? "reference" : "references"}`;
}
