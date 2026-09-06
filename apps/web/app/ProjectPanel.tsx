"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SavedReference } from "./referenceVaultModel";
import {
  createReferenceProject,
  removeProjectUse,
  removeReferenceProject,
  saveProjectUse,
  setProjectReferenceUsed,
  updateReferenceProject,
  useAllReferenceProjects,
  useProjectUses,
  type ProjectReferenceUse,
  type ProjectStatus,
} from "./useReferenceProjects";

export function ProjectPanel({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const projects = useAllReferenceProjects();
  const activeProjectId = projectToken(query);
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    description: string;
    status: ProjectStatus;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  function applyProject(projectId: string) {
    const text = stripProjectToken(query);
    onChange(
      [text, projectId ? `project:${projectId}` : ""].filter(Boolean).join(" "),
    );
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    setStatus("Creating project…");
    try {
      await createReferenceProject(name);
      setCreateName("");
      setStatus(`Created “${name}”.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not create project.",
      );
    } finally {
      setBusy(false);
    }
  }

  function editProject(
    id: string,
    name: string,
    description: string | undefined,
    status: ProjectStatus,
  ) {
    setEditing({ id, name, description: description ?? "", status });
  }

  async function saveProjectEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing?.name.trim() || !isProjectStatus(editing.status)) return;
    setBusy(true);
    try {
      await updateReferenceProject(editing.id, {
        name: editing.name.trim(),
        description: editing.description,
        status: editing.status,
      });
      setStatus("Project updated.");
      setEditing(null);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not update project.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(projectId: string, name: string) {
    if (pendingDelete?.id !== projectId) {
      setPendingDelete({ id: projectId, name });
      return;
    }
    setBusy(true);
    setStatus("Deleting project…");
    try {
      const result = await removeReferenceProject(projectId);
      setPendingDelete(null);
      if (activeProjectId === projectId) applyProject("");
      setStatus(
        result.removed
          ? `Deleted project and ${result.usesRemoved} ${result.usesRemoved === 1 ? "project link" : "project links"}.`
          : "Project was already removed.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not delete project.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return (
      <section
        className="project-panel project-panel-empty"
        aria-label="Projects"
      >
        <div>
          <strong>Projects</strong>
          <span>Build a shortlist for your next project.</span>
        </div>
        <form className="project-create-row" onSubmit={createProject}>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="First project name"
            maxLength={100}
          />
          <button
            type="submit"
            className="button secondary"
            disabled={!createName.trim() || busy}
          >
            Create project
          </button>
        </form>
        {status ? (
          <p className="project-status" aria-live="polite">
            {status}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="project-panel" aria-label="Projects">
      <div className="project-filter-row">
        <label>
          <span>Project</span>
          <select
            value={activeProjectId}
            onChange={(event) => applyProject(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project._id} value={project._id}>
                {project.name} ({project.referenceCount})
              </option>
            ))}
          </select>
        </label>
        <div className="project-filter-chips">
          {projects.slice(0, 6).map((project) => (
            <button
              key={project._id}
              type="button"
              className={activeProjectId === project._id ? "active" : ""}
              onClick={() =>
                applyProject(activeProjectId === project._id ? "" : project._id)
              }
            >
              {project.name}
              <span
                className={`project-status-dot ${project.status}`}
                title={project.status}
              />
              <span>{project.referenceCount}</span>
            </button>
          ))}
        </div>
      </div>

      {editing ? (
        <form className="project-edit-form" onSubmit={saveProjectEdit}>
          <label>
            Name
            <input
              value={editing.name}
              maxLength={100}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
            />
          </label>
          <label>
            Purpose
            <textarea
              value={editing.description}
              onChange={(event) =>
                setEditing({ ...editing, description: event.target.value })
              }
            />
          </label>
          <label>
            Status
            <select
              value={editing.status}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  status: event.target.value as ProjectStatus,
                })
              }
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="finished">Finished</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <div className="viewer-actions">
            <button
              className="button primary"
              disabled={busy || !editing.name.trim()}
            >
              Save
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {pendingDelete ? (
        <div className="project-delete-confirm">
          <p>
            Delete “{pendingDelete.name}” and its project-use records? The saved
            references will remain.
          </p>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() =>
              void deleteProject(pendingDelete.id, pendingDelete.name)
            }
          >
            Delete project
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <details className="project-manager">
        <summary>Manage projects</summary>
        <form className="project-create-row" onSubmit={createProject}>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="New project name"
            maxLength={100}
          />
          <button
            type="submit"
            className="button secondary"
            disabled={!createName.trim() || busy}
          >
            Create
          </button>
        </form>
        <div className="project-manager-list">
          {projects.map((project) => (
            <div key={project._id}>
              <button type="button" onClick={() => applyProject(project._id)}>
                <strong>{project.name}</strong>
                <span>
                  {project.status} · {project.referenceCount}
                </span>
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() =>
                  void editProject(
                    project._id,
                    project.name,
                    project.description,
                    project.status,
                  )
                }
                disabled={busy}
              >
                Edit
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void deleteProject(project._id, project.name)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </details>
      {status ? (
        <p className="project-status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

export function ReferenceProjectAssignment({
  reference,
}: {
  reference: SavedReference;
}) {
  const projects = useAllReferenceProjects();
  const [uses, setUses] = useProjectUses(reference._id);
  const [projectId, setProjectId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setProjectId("");
    setReason("");
    setNotes("");
  }, [reference._id]);

  const usedProjectIds = useMemo(
    () => new Set(uses.map((use) => use.projectId)),
    [uses],
  );
  const availableProjects = projects.filter(
    (project) =>
      !usedProjectIds.has(project._id) && project.status !== "archived",
  );

  async function saveUse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setStatus("Saving to the project shortlist…");
    try {
      const saved = await saveProjectUse({
        projectId,
        referenceId: reference._id,
        assetId: reference.assets[0]?._id,
        reason: reason.trim(),
        notes: notes.trim(),
      });
      const project = projects.find((item) => item._id === projectId);
      if (project) {
        setUses((items) => [
          { ...saved, project },
          ...items.filter((item) => item.projectId !== projectId),
        ]);
      }
      setProjectId("");
      setReason("");
      setNotes("");
      setStatus("Project shortlist saved.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not save to this project.",
      );
    } finally {
      setBusy(false);
    }
  }

  function editUse(use: ProjectReferenceUse) {
    setProjectId(use.projectId);
    setReason(use.reason ?? "");
    setNotes(use.notes ?? "");
  }

  async function removeUse(use: ProjectReferenceUse) {
    setBusy(true);
    setStatus("Removing from project…");
    try {
      await removeProjectUse(use.projectId, reference._id);
      setUses((items) => items.filter((item) => item._id !== use._id));
      setStatus("Removed from project.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not remove from project.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleUsed(use: ProjectReferenceUse) {
    setBusy(true);
    try {
      const saved = await setProjectReferenceUsed(
        use.projectId,
        reference._id,
        use.usageStatus !== "used",
      );
      setUses((items) =>
        items.map((item) =>
          item._id === use._id ? { ...item, ...saved } : item,
        ),
      );
      setStatus(
        saved.usageStatus === "used"
          ? "Marked as used in this project."
          : "Returned to the shortlist.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not update project usage.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) return null;

  return (
    <div
      className="reference-project-assignment"
      aria-label="Selected reference projects"
    >
      <div className="reference-project-heading">
        <strong>Projects</strong>
        <span>
          {uses.filter((use) => use.usageStatus === "used").length} used ·{" "}
          {uses.length} linked
        </span>
      </div>
      <p className="project-usage-hint">
        Shortlist possibilities here. Mark used only when you actually reference
        one; favorites stay separate.
      </p>
      {uses.length > 0 ? (
        <div className="project-use-list">
          {uses.map((use) => (
            <div key={use._id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => editUse(use)}
              >
                <strong>{use.project.name}</strong>
                <span>
                  {use.usageStatus === "used"
                    ? use.usedAt
                      ? `Used · ${new Date(use.usedAt).toLocaleDateString()}`
                      : "Used in this project"
                    : use.usageStatus === "shortlisted"
                      ? "Shortlisted"
                      : "Usage not recorded"}
                </span>
                {use.reason ? <span>{use.reason}</span> : null}
              </button>
              <button
                className="button ghost project-used-toggle"
                type="button"
                aria-pressed={use.usageStatus === "used"}
                disabled={busy}
                onClick={() => void toggleUsed(use)}
              >
                {use.usageStatus === "used" ? "Undo used" : "Mark used"}
              </button>
              <button
                type="button"
                aria-label={`Remove ${use.project.name}`}
                onClick={() => void removeUse(use)}
                disabled={busy}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <form className="project-use-form" onSubmit={saveUse}>
        <select
          aria-label="Project for this reference"
          value={projectId}
          onChange={(event) => {
            const nextId = event.target.value;
            setProjectId(nextId);
            const existing = uses.find((use) => use.projectId === nextId);
            setReason(existing?.reason ?? "");
            setNotes(existing?.notes ?? "");
          }}
          disabled={busy}
        >
          <option value="">Add to project</option>
          {uses.map((use) => (
            <option key={use.projectId} value={use.projectId}>
              Edit: {use.project.name}
            </option>
          ))}
          {availableProjects.map((project) => (
            <option key={project._id} value={project._id}>
              {project.name}
            </option>
          ))}
        </select>
        {projectId ? (
          <>
            <input
              aria-label="Reference purpose"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What it helps with: pose, palette, lighting…"
              maxLength={120}
            />
            <textarea
              aria-label="Project-specific notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Project-specific notes"
              rows={2}
              maxLength={1000}
            />
            <button type="submit" className="button secondary" disabled={busy}>
              Save to shortlist
            </button>
          </>
        ) : null}
      </form>
      {status ? <p aria-live="polite">{status}</p> : null}
    </div>
  );
}

function projectToken(value: string) {
  const token = value
    .trim()
    .split(/\s+/)
    .find((part) => /^project:/i.test(part));
  return token?.slice(token.indexOf(":") + 1) ?? "";
}

function stripProjectToken(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => !/^project:/i.test(token))
    .join(" ");
}

function isProjectStatus(value: string): value is ProjectStatus {
  return (
    value === "active" ||
    value === "paused" ||
    value === "finished" ||
    value === "archived"
  );
}
