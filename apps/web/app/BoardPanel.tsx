"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SavedReference } from "./referenceVaultModel";
import {
  createReferenceBoard,
  mutateReferenceBoards,
  removeReferenceBoard,
  updateReferenceBoard,
  useAllReferenceBoards,
} from "./useReferenceBoards";

export function BoardPanel({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const boards = useAllReferenceBoards();
  const activeBoardId = boardToken(query);
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  function applyBoard(boardId: string) {
    const text = stripBoardToken(query);
    onChange([text, boardId ? `board:${boardId}` : ""].filter(Boolean).join(" "));
  }

  async function createBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = createName.trim();
    if (!name) return;

    setBusy(true);
    setStatus("Creating board…");
    try {
      await createReferenceBoard(name);
      setCreateName("");
      setStatus(`Created “${name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create board.");
    } finally {
      setBusy(false);
    }
  }

  async function renameBoard(boardId: string, currentName: string, description?: string) {
    const name = window.prompt("Rename board", currentName)?.trim();
    if (!name || name === currentName) return;

    setBusy(true);
    setStatus("Renaming board…");
    try {
      await updateReferenceBoard(boardId, name, description);
      setStatus(`Renamed to “${name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not rename board.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBoard(boardId: string, name: string) {
    if (!window.confirm(`Delete “${name}”? References stay in the vault.`)) return;

    setBusy(true);
    setStatus("Deleting board…");
    try {
      const result = await removeReferenceBoard(boardId);
      if (activeBoardId === boardId) applyBoard("");
      setStatus(
        result.removed
          ? `Deleted board and updated ${result.referencesUpdated} ${result.referencesUpdated === 1 ? "reference" : "references"}.`
          : "Board was already removed.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete board.");
    } finally {
      setBusy(false);
    }
  }

  if (boards.length === 0) {
    return (
      <section className="board-panel board-panel-empty" aria-label="Boards">
        <div>
          <strong>Boards</strong>
          <span>Group references for a project, study, or reusable pack.</span>
        </div>
        <form className="board-create-row" onSubmit={createBoard}>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="First board name"
            maxLength={80}
          />
          <button
            type="submit"
            className="button secondary"
            disabled={!createName.trim() || busy}
          >
            Create board
          </button>
        </form>
        {status ? <p className="board-status" aria-live="polite">{status}</p> : null}
      </section>
    );
  }

  return (
    <section className="board-panel" aria-label="Boards">
      <div className="board-filter-row">
        <label>
          <span>Board</span>
          <select value={activeBoardId} onChange={(event) => applyBoard(event.target.value)}>
            <option value="">All boards</option>
            {boards.map((board) => (
              <option key={board._id} value={board._id}>
                {board.name} ({board.referenceCount})
              </option>
            ))}
          </select>
        </label>
        <div className="board-filter-chips">
          {boards.slice(0, 6).map((board) => (
            <button
              key={board._id}
              type="button"
              className={activeBoardId === board._id ? "active" : ""}
              onClick={() => applyBoard(activeBoardId === board._id ? "" : board._id)}
            >
              {board.name} <span>{board.referenceCount}</span>
            </button>
          ))}
        </div>
      </div>

      <details className="board-manager">
        <summary>Manage boards</summary>
        <form className="board-create-row" onSubmit={createBoard}>
          <input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="New board name"
            maxLength={80}
          />
          <button
            type="submit"
            className="button secondary"
            disabled={!createName.trim() || busy}
          >
            Create
          </button>
        </form>
        <div className="board-manager-list">
          {boards.map((board) => (
            <div key={board._id}>
              <button type="button" onClick={() => applyBoard(board._id)}>
                <strong>{board.name}</strong>
                <span>{board.referenceCount}</span>
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void renameBoard(board._id, board.name, board.description)}
                disabled={busy}
              >
                Rename
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void deleteBoard(board._id, board.name)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </details>
      {status ? <p className="board-status" aria-live="polite">{status}</p> : null}
    </section>
  );
}

export function ReferenceBoardAssignment({ reference }: { reference: SavedReference }) {
  const boards = useAllReferenceBoards();
  const [assignmentBoardId, setAssignmentBoardId] = useState("");
  const [assignedBoardIds, setAssignedBoardIds] = useState(reference.boardIds ?? []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setAssignedBoardIds(reference.boardIds ?? []);
  }, [reference._id, (reference.boardIds ?? []).join(",")]);

  const assignedBoards = useMemo(
    () => boards.filter((board) => assignedBoardIds.includes(board._id)),
    [assignedBoardIds, boards],
  );
  const availableBoards = boards.filter((board) => !assignedBoardIds.includes(board._id));

  async function assignBoard() {
    if (!assignmentBoardId) return;
    setBusy(true);
    setStatus("Adding…");
    try {
      const boardIds = await mutateReferenceBoards(reference._id, {
        addBoardIds: [assignmentBoardId],
      });
      setAssignedBoardIds(boardIds);
      setAssignmentBoardId("");
      setStatus("Added.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update boards.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(boardId: string) {
    setBusy(true);
    setStatus("Removing…");
    try {
      const boardIds = await mutateReferenceBoards(reference._id, {
        removeBoardIds: [boardId],
      });
      setAssignedBoardIds(boardIds);
      setStatus("Removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update boards.");
    } finally {
      setBusy(false);
    }
  }

  if (boards.length === 0) return null;

  return (
    <div className="reference-board-assignment" aria-label="Selected reference boards">
      <div className="reference-board-heading">
        <strong>Boards</strong>
        <span>{assignedBoards.length}</span>
      </div>
      {assignedBoards.length > 0 ? (
        <div className="assigned-boards">
          {assignedBoards.map((board) => (
            <button
              key={board._id}
              type="button"
              title={`Remove from ${board.name}`}
              onClick={() => void removeAssignment(board._id)}
              disabled={busy}
            >
              {board.name} ×
            </button>
          ))}
        </div>
      ) : null}
      <div className="board-assign-row">
        <select
          value={assignmentBoardId}
          onChange={(event) => setAssignmentBoardId(event.target.value)}
          disabled={availableBoards.length === 0 || busy}
        >
          <option value="">
            {availableBoards.length > 0 ? "Add to board" : "In every board"}
          </option>
          {availableBoards.map((board) => (
            <option key={board._id} value={board._id}>
              {board.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button secondary"
          onClick={() => void assignBoard()}
          disabled={!assignmentBoardId || busy}
        >
          Add
        </button>
      </div>
      {status ? <p aria-live="polite">{status}</p> : null}
    </div>
  );
}

function boardToken(value: string) {
  const token = value
    .trim()
    .split(/\s+/)
    .find((part) => /^board:/i.test(part));
  return token?.slice(token.indexOf(":") + 1) ?? "";
}

function stripBoardToken(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => !/^board:/i.test(token))
    .join(" ");
}
