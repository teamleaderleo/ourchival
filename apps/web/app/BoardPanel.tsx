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
  reference,
}: {
  query: string;
  onChange: (query: string) => void;
  reference?: SavedReference;
}) {
  const boards = useAllReferenceBoards();
  const activeBoardId = boardToken(query);
  const [createName, setCreateName] = useState("");
  const [assignmentBoardId, setAssignmentBoardId] = useState("");
  const [assignedBoardIds, setAssignedBoardIds] = useState(reference?.boardIds ?? []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setAssignedBoardIds(reference?.boardIds ?? []);
  }, [reference?._id, (reference?.boardIds ?? []).join(",")]);

  const assignedBoards = useMemo(
    () => boards.filter((board) => assignedBoardIds.includes(board._id)),
    [assignedBoardIds, boards],
  );
  const availableBoards = boards.filter((board) => !assignedBoardIds.includes(board._id));

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

  async function assignBoard() {
    if (!reference || !assignmentBoardId) return;
    setBusy(true);
    setStatus("Adding to board…");
    try {
      const boardIds = await mutateReferenceBoards(reference._id, {
        addBoardIds: [assignmentBoardId],
      });
      setAssignedBoardIds(boardIds);
      setAssignmentBoardId("");
      setStatus("Added to board.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update board membership.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssignment(boardId: string) {
    if (!reference) return;
    setBusy(true);
    setStatus("Removing from board…");
    try {
      const boardIds = await mutateReferenceBoards(reference._id, {
        removeBoardIds: [boardId],
      });
      setAssignedBoardIds(boardIds);
      setStatus("Removed from board.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update board membership.");
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
      setAssignedBoardIds((ids) => ids.filter((id) => id !== boardId));
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

      {reference ? (
        <div className="board-assignment">
          <div>
            <strong>Selected reference</strong>
            <span>
              {assignedBoards.length > 0
                ? `${assignedBoards.length} ${assignedBoards.length === 1 ? "board" : "boards"}`
                : "No boards"}
            </span>
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
                {availableBoards.length > 0 ? "Choose a board" : "Already in every board"}
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
              Add selected
            </button>
          </div>
        </div>
      ) : null}

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
        {boards.length > 0 ? (
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
        ) : (
          <p className="board-empty">Create a board to group reusable references.</p>
        )}
      </details>
      {status ? <p className="board-status" aria-live="polite">{status}</p> : null}
    </section>
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
