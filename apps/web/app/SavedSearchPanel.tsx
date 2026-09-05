"use client";
import { Popover } from "./Popover";

import { useState, type FormEvent } from "react";
import type { VaultView } from "./VaultNavigation";
import {
  createSavedSearch,
  removeSavedSearch,
  updateSavedSearch,
  useSavedSearches,
  type SavedSearch,
} from "./useSavedSearches";

export function SavedSearchPanel({
  activeView,
  query,
  onApply,
}: {
  activeView: VaultView;
  query: string;
  onApply: (search: Pick<SavedSearch, "view" | "query">) => void;
}) {
  const searches = useSavedSearches();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const canSaveCurrent = Boolean(query.trim()) || activeView !== "all";

  async function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedName = name.trim();
    if (!savedName || !canSaveCurrent) return;

    setBusy(true);
    setStatus("Saving search…");
    try {
      await createSavedSearch({ name: savedName, query, view: activeView });
      setName("");
      setStatus(`Saved “${savedName}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save search.");
    } finally {
      setBusy(false);
    }
  }

  async function replaceSearch(search: SavedSearch) {
    if (!canSaveCurrent) return;
    setBusy(true);
    setStatus(`Updating “${search.name}”…`);
    try {
      await updateSavedSearch({
        savedSearchId: search._id,
        name: search.name,
        query,
        view: activeView,
      });
      setStatus(`Updated “${search.name}” from the current view.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update search.");
    } finally {
      setBusy(false);
    }
  }

  async function renameSearch(search: SavedSearch) {
    const nextName = window.prompt("Rename saved search", search.name)?.trim();
    if (!nextName || nextName === search.name) return;

    setBusy(true);
    setStatus("Renaming search…");
    try {
      await updateSavedSearch({
        savedSearchId: search._id,
        name: nextName,
        query: search.query,
        view: search.view,
      });
      setStatus(`Renamed to “${nextName}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not rename search.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSearch(search: SavedSearch) {
    if (!window.confirm(`Delete saved search “${search.name}”?`)) return;
    setBusy(true);
    setStatus("Deleting search…");
    try {
      await removeSavedSearch(search._id);
      setStatus(`Deleted “${search.name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete search.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover className="saved-search-panel" label={<>
        <span>Saved searches</span>
        {searches.length > 0 ? <span>{searches.length}</span> : null}
      </>}>
      <form className="saved-search-create" onSubmit={saveCurrent}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this search"
          maxLength={80}
          disabled={busy}
        />
        <button
          type="submit"
          className="button secondary"
          disabled={busy || !name.trim() || !canSaveCurrent}
        >
          Save current
        </button>
      </form>
      {!canSaveCurrent ? (
        <p className="saved-search-hint">
          Enter a search or switch to a focused vault view before saving.
        </p>
      ) : null}
      {searches.length > 0 ? (
        <div className="saved-search-list">
          {searches.map((search) => (
            <div key={search._id}>
              <button
                type="button"
                className="saved-search-apply"
                onClick={() => onApply(search)}
                disabled={busy}
              >
                <strong>{search.name}</strong>
                <span>{describeSearch(search)}</span>
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void replaceSearch(search)}
                disabled={busy || !canSaveCurrent}
                title="Replace with the current view and query"
              >
                Replace
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={() => void renameSearch(search)}
                disabled={busy}
              >
                Rename
              </button>
              <button
                type="button"
                className="button ghost danger"
                onClick={() => void deleteSearch(search)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="saved-search-hint">Saved searches will appear here.</p>
      )}
      {status ? (
        <p className="saved-search-status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </Popover>
  );
}

function describeSearch(search: SavedSearch) {
  const view = search.view === "all" ? "Library" : capitalize(search.view);
  return search.query ? `${view} · ${search.query}` : view;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
