"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SavedReference } from "./referenceVaultModel";
import {
  createReferenceProject,
  removeProjectUse,
  removeReferenceProject,
  saveProjectUse,
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

  function applyProject(projectId: string) {
    const text = stripProjectToken(query);
    onChange([text, projectId ? `project:${projectId}` : ""].filter(Boolean).join(" "));
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
      setStatus(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setBusy(false);
    }
  }

  async function editProject(
    projectId: string,
    currentName: string,
    description: string | undefined,
    currentStatus: ProjectStatus,
  ) {
    const name = window.prompt("Project name", currentName)?.trim();
    if (!name) return;
    const nextStatus = window.prompt(
      "Status: active, paused, finished, or archived",
      currentStatus,
    )?.trim() as ProjectStatus | undefined;
    if (!nextStatus || !isProjectStatus(nextStatus)) return;

    setBusy(true);
    setStatus("Updating project…");
    try {
      await updateReferenceProject(projectId, { name, description, status: nextStatus });
      setStatus(`Updated “${name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update project.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(projectId: string, name: string) {
    if (!window.confirm(`Delete “${name}” and its reuse records? References stay in the vault.`)) {
      return;
    }
    setBusy(true);
    setStatus("Deleting project…");
    try {
      const result = await removeReferenceProject(projectId);
      if (activeProjectId === projectId) applyProject("");
      setStatus(
        result.removed
          ? `Deleted project and ${result.usesRemoved} ${result.usesRemoved === 1 ? "reuse record" : "reuse records"}.`
          : "Project was already removed.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete project.");
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) {
    return (
      <section className="project-panel project-panel-empty" aria-label="Projects">
        <div>
          <strong>Projects</strong>
          <span>Track where a reference is actively being reused.</span>
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
        {status ? <p className="project-status" aria-live="polite">{status}</p> : null}
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
              <span className={`project-status-dot ${project.status}`} title={project.status} />
              <span>{project.referenceCount}</span>
            </button>
          ))}
        </div>
      </div>

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
                <span>{project.status} · {project.referenceCount}</span>
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
      {status ? <p className="project-status" aria-live="polite">{status}</p> : null}
    </section>
  );
}

export function ReferenceProjectAssignment({ reference }: { reference: SavedReference }) {
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
    (project) => !usedProjectIds.has(project._id) && project.status !== "archived",
  );

  async function saveUse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setStatus("Saving reuse record…");
    try {
      const saved = await saveProjectUse({
        projectId,
        referenceId: reference._id,
        assetId: reference.assets[0]?._id,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
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
      setStatus("Project reuse saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save project reuse.");
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
    setStatus("Removing project reuse…");
    try {
      await removeProjectUse(use.projectId, reference._id);
      setUses((items) => items.filter((item) => item._id !== use._id));
      setStatus("Project reuse removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not remove project reuse.");
    } finally {
      setBusy(false);
    }
  }

  if (projects.length === 0) return null;

  return (
    <div className="reference-project-assignment" aria-label="Selected reference projects">
      <div className="reference-project-heading">
        <strong>Projects</strong>
        <span>{uses.length}</span>
      </div>
      {uses.length > 0 ? (
        <div className="project-use-list">
          {uses.map((use) => (
            <div key={use._id}>
              <button type="button" onClick={() => editUse(use)}>
                <strong>{use.project.name}</strong>
                <span>{use.reason || "No reuse reason"}</span>
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
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reuse reason: panel pose, color key…"
              maxLength={120}
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Project-specific notes"
              rows={2}
              maxLength={1000}
            />
            <button type="submit" className="button secondary" disabled={busy}>
              Save project reuse
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
  return value === "active" || value === "paused" || value === "finished" || value === "archived";
}
