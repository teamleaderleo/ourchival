"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@ourchival/convex/_generated/api";
import type { Id } from "@ourchival/convex/_generated/dataModel";
import { convexUrl } from "./providers";
import { assetLabel, filterReferences, getSelectedReference } from "./referenceVaultModel";

type ReferenceWithAssets = FunctionReturnType<typeof api.references.listWithAssets>[number];
type Board = FunctionReturnType<typeof api.boards.list>[number];
type Tag = FunctionReturnType<typeof api.tags.list>[number];

type StatusTone = "info" | "success" | "error";

export function ReferenceVault() {
  if (!convexUrl) {
    return (
      <section className="endpoint-panel setup-notice">
        <div>
          <p className="eyebrow">Setup needed</p>
          <code>NEXT_PUBLIC_CONVEX_URL is not set</code>
        </div>
        <p>
          Add <code>NEXT_PUBLIC_CONVEX_URL</code> to <code>.env.local</code> and restart the dev
          server to connect the vault to your Convex deployment.
        </p>
      </section>
    );
  }

  return <Vault />;
}

function Vault() {
  const siteUrl = useMemo(resolveConvexSiteUrl, []);

  const references = useQuery(api.references.listWithAssets);
  const boards = useQuery(api.boards.list) ?? [];
  const tags = useQuery(api.tags.list) ?? [];

  const updateReference = useMutation(api.references.update);
  const removeReference = useMutation(api.references.remove);
  const toggleBoard = useMutation(api.references.toggleBoard);
  const toggleTag = useMutation(api.references.toggleTag);
  const createBoard = useMutation(api.boards.create);
  const createTag = useMutation(api.tags.create);
  const generateUploadUrl = useMutation(api.references.generateUploadUrl);
  const createFromUpload = useMutation(api.references.createFromUpload);

  const [status, setStatus] = useState("Connecting to your vault…");
  const [statusTone, setStatusTone] = useState<StatusTone>("info");
  const [sourceUrl, setSourceUrl] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeBoardId, setActiveBoardId] = useState<Id<"boards"> | null>(null);
  const [tagFilterId, setTagFilterId] = useState<Id<"tags"> | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"references"> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoading = references === undefined;
  const allReferences = references ?? [];

  const tagsById = useMemo(() => {
    const map = new Map<Id<"tags">, Tag>();
    tags.forEach((tag) => map.set(tag._id, tag));
    return map;
  }, [tags]);

  function report(message: string, tone: StatusTone = "info") {
    setStatus(message);
    setStatusTone(tone);
  }

  const filteredReferences = useMemo(
    () =>
      filterReferences(allReferences, {
        query,
        favoritesOnly,
        boardId: activeBoardId,
        tagId: tagFilterId,
        tagNameFor: (tagId) => tagsById.get(tagId as Id<"tags">)?.name,
      }),
    [allReferences, activeBoardId, tagFilterId, favoritesOnly, query, tagsById],
  );

  const selectedReference = getSelectedReference(filteredReferences, selectedId);

  const activeBoardName = activeBoardId
    ? boards.find((board) => board._id === activeBoardId)?.name ?? "Board"
    : "All references";

  async function saveManualReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!siteUrl) {
      report("Add a Convex site URL before saving.", "error");
      return;
    }

    setIsSaving(true);
    report("Saving reference…", "info");

    try {
      const response = await fetch(`${siteUrl}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: assetUrl.trim() ? "image" : "page",
          sourceUrl,
          assetUrl,
          pageTitle,
          capturedAt: new Date().toISOString(),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        storageStatus?: string;
      };

      if (!response.ok || body.ok === false) {
        report(body.error ?? response.statusText, "error");
        return;
      }

      setSourceUrl("");
      setAssetUrl("");
      setPageTitle("");
      report(`Saved reference. ${body.storageStatus ?? ""}`.trim(), "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not save reference.", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setIsUploading(true);
    report(`Uploading ${file.name}…`, "info");

    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!result.ok) {
        report(`Upload failed: ${result.status}`, "error");
        return;
      }

      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
      await createFromUpload({ storageId, fileName: file.name, mimeType: file.type || undefined });
      report(`Uploaded ${file.name}.`, "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not upload file.", "error");
    } finally {
      setIsUploading(false);
      input.value = "";
    }
  }

  async function handleFavorite(reference: ReferenceWithAssets) {
    const next = !reference.favorite;
    try {
      await updateReference({ id: reference._id, favorite: next });
      report(next ? "Marked as favorite." : "Removed from favorites.", "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not update favorite.", "error");
    }
  }

  async function handleSaveDetails(referenceId: Id<"references">, patch: { title: string; notes: string }) {
    try {
      await updateReference({ id: referenceId, ...patch });
      report("Reference details saved.", "success");
      return true;
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not save details.", "error");
      return false;
    }
  }

  async function handleDelete(referenceId: Id<"references">) {
    const confirmed = window.confirm("Remove this reference from Reliquary? The original file is kept.");
    if (!confirmed) return;

    try {
      await removeReference({ id: referenceId });
      setSelectedId(null);
      report("Reference removed from Reliquary.", "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not delete reference.", "error");
    }
  }

  async function handleNewBoard() {
    const name = window.prompt("Name this board")?.trim();
    if (!name) return;

    try {
      const existing = boards.find((board) => board.name.toLowerCase() === name.toLowerCase());
      const boardId = existing?._id ?? (await createBoard({ name }));
      setActiveBoardId(boardId);
      report(existing ? `Switched to “${name}”.` : `Created board “${name}”.`, "success");
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not create board.", "error");
    }
  }

  async function handleToggleBoard(referenceId: Id<"references">, boardId: Id<"boards">) {
    try {
      await toggleBoard({ id: referenceId, boardId });
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not update board.", "error");
    }
  }

  async function handleToggleTag(referenceId: Id<"references">, tagId: Id<"tags">) {
    try {
      await toggleTag({ id: referenceId, tagId });
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not update tag.", "error");
    }
  }

  async function handleCreateTag(referenceId: Id<"references">, name: string) {
    const clean = name.trim();
    if (!clean) return;

    try {
      const existing = tags.find((tag) => tag.name.toLowerCase() === clean.toLowerCase());
      const tagId = existing?._id ?? (await createTag({ name: clean }));
      await toggleTag({ id: referenceId, tagId });
    } catch (error) {
      report(error instanceof Error ? error.message : "Could not add tag.", "error");
    }
  }

  function handleExport() {
    if (filteredReferences.length === 0) {
      report("Nothing to export in the current view.", "error");
      return;
    }

    const payload = filteredReferences.map((reference) => {
      const asset = reference.assets[0];
      return {
        title: reference.title ?? null,
        sourceUrl: reference.sourceUrl,
        platform: reference.platform,
        kind: reference.kind,
        capturedAt: new Date(reference.capturedAt).toISOString(),
        favorite: Boolean(reference.favorite),
        notes: reference.notes ?? null,
        tags: reference.tagIds.map((id) => tagsById.get(id)?.name).filter(Boolean),
        boards: reference.boardIds.map((id) => boards.find((b) => b._id === id)?.name).filter(Boolean),
        image: asset?.storedUrl ?? asset?.originalUrl ?? null,
        driveLink: asset?.driveWebViewLink ?? null,
      };
    });

    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), references: payload }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ourchival-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    report(`Exported ${payload.length} references.`, "success");
  }

  const favoriteCount = allReferences.filter((reference) => reference.favorite).length;

  return (
    <>
      <section className="endpoint-panel">
        <div>
          <p className="eyebrow">Clipper endpoint</p>
          <code>{siteUrl ? `${siteUrl}/capture` : "Missing Convex site URL"}</code>
        </div>
        <p>
          Paste this into the Edge extension popup. The gallery updates live as references are saved —
          no refresh needed.
        </p>
      </section>

      <form className="manual-capture" onSubmit={saveManualReference}>
        <div>
          <p className="eyebrow">Manual save</p>
          <h2>Add a reference</h2>
        </div>
        <label>
          Source URL
          <input
            required
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://example.com/post"
          />
        </label>
        <label>
          Image URL
          <input
            type="url"
            value={assetUrl}
            onChange={(event) => setAssetUrl(event.target.value)}
            placeholder="https://example.com/image.jpg"
          />
        </label>
        <label>
          Title
          <input
            value={pageTitle}
            onChange={(event) => setPageTitle(event.target.value)}
            placeholder="Optional title"
          />
        </label>
        <button disabled={isSaving}>{isSaving ? "Saving…" : "Save reference"}</button>
      </form>

      <section className="vault-workspace">
        <aside className="vault-sidebar">
          <p className="eyebrow">Boards</p>
          <div className="shelf-list">
            <button
              type="button"
              className={activeBoardId === null ? "active" : ""}
              onClick={() => setActiveBoardId(null)}
            >
              All references
            </button>
            {boards.map((board) => (
              <button
                type="button"
                className={board._id === activeBoardId ? "active" : ""}
                key={board._id}
                onClick={() => setActiveBoardId(board._id)}
              >
                {board.name}
              </button>
            ))}
            <button type="button" className="shelf-add" onClick={handleNewBoard}>
              + New board
            </button>
          </div>

          <div className="sidebar-block">
            <p className="eyebrow">Status</p>
            <p className={`status-line status-${statusTone}`}>{status}</p>
          </div>
        </aside>

        <section className="vault-main">
          <div className="vault-toolbar">
            <label>
              Search references
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="artist, source, tag, lighting, x.com…"
              />
            </label>
            <div className="toolbar-actions">
              <button
                type="button"
                className={`pill-toggle ${favoritesOnly ? "active" : ""}`}
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly((value) => !value)}
              >
                {favoritesOnly ? "★ Favorites" : "☆ Favorites"}
                {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleUpload}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? "Uploading…" : "Upload"}
              </button>
              <button type="button" onClick={handleNewBoard}>
                New board
              </button>
              <button type="button" onClick={handleExport}>
                Export pack
              </button>
            </div>
          </div>

          {tagFilterId ? (
            <button type="button" className="filter-chip" onClick={() => setTagFilterId(null)}>
              Tag: {tagsById.get(tagFilterId)?.name ?? "unknown"} ✕
            </button>
          ) : null}

          <div className="result-summary">
            <strong>{filteredReferences.length}</strong> references · {activeBoardName}
            {favoritesOnly ? " · favorites only" : ""}
          </div>

          <section className="grid">
            {isLoading ? (
              <article className="empty-card">
                <h2>Loading your Reliquary…</h2>
                <p>Fetching saved references from Convex.</p>
              </article>
            ) : filteredReferences.length === 0 ? (
              <article className="empty-card">
                <h2>
                  {favoritesOnly || query || activeBoardId || tagFilterId
                    ? "No matching references."
                    : "Your Reliquary is waiting."}
                </h2>
                <p>
                  {favoritesOnly || query || activeBoardId || tagFilterId
                    ? "Try clearing the filters or the search."
                    : "Right-click an image in Edge, save it to Ourchival, then watch it appear here."}
                </p>
              </article>
            ) : (
              filteredReferences.map((reference) => {
                const asset = reference.assets[0];
                const imageUrl = asset?.storedUrl ?? asset?.originalUrl;
                const isSelected = reference._id === selectedId;
                const referenceTags = reference.tagIds
                  .map((id) => tagsById.get(id))
                  .filter((tag): tag is Tag => Boolean(tag));

                return (
                  <article
                    className={`card ${isSelected ? "selected" : ""}`}
                    key={reference._id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(reference._id)}
                    onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(reference._id);
                      }
                    }}
                  >
                    <div className="thumb-wrap">
                      <ThumbImage imageUrl={imageUrl} title={reference.title} />
                      <button
                        type="button"
                        className={`favorite-toggle ${reference.favorite ? "active" : ""}`}
                        aria-label={reference.favorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={Boolean(reference.favorite)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleFavorite(reference);
                        }}
                      >
                        {reference.favorite ? "★" : "☆"}
                      </button>
                    </div>
                    <h2>{reference.title || reference.sourceUrl}</h2>
                    <p>{reference.platform} · {new Date(reference.capturedAt).toLocaleDateString()}</p>
                    {referenceTags.length > 0 ? (
                      <div className="card-tags">
                        {referenceTags.slice(0, 3).map((tag) => (
                          <span className="tag-chip" key={tag._id}>
                            {tag.name}
                          </span>
                        ))}
                        {referenceTags.length > 3 ? (
                          <span className="tag-chip muted">+{referenceTags.length - 3}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        </section>

        <aside className="inspector">
          <p className="eyebrow">Inspector</p>
          {selectedReference ? (
            <SelectedReference
              key={selectedReference._id}
              reference={selectedReference}
              boards={boards}
              tags={tags}
              onDelete={handleDelete}
              onToggleFavorite={handleFavorite}
              onSaveDetails={handleSaveDetails}
              onToggleBoard={handleToggleBoard}
              onToggleTag={handleToggleTag}
              onCreateTag={handleCreateTag}
              onFilterTag={setTagFilterId}
            />
          ) : (
            <p>Select a reference to view source, boards, tags, and actions.</p>
          )}
        </aside>
      </section>
    </>
  );
}

function ThumbImage({ imageUrl, title }: { imageUrl?: string | null; title?: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return <div className="thumb placeholder" aria-hidden={!title} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="thumb"
      src={imageUrl}
      alt={title ?? "Saved reference"}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function SelectedReference({
  reference,
  boards,
  tags,
  onDelete,
  onToggleFavorite,
  onSaveDetails,
  onToggleBoard,
  onToggleTag,
  onCreateTag,
  onFilterTag,
}: {
  reference: ReferenceWithAssets;
  boards: Board[];
  tags: Tag[];
  onDelete: (referenceId: Id<"references">) => void;
  onToggleFavorite: (reference: ReferenceWithAssets) => void;
  onSaveDetails: (referenceId: Id<"references">, patch: { title: string; notes: string }) => Promise<boolean>;
  onToggleBoard: (referenceId: Id<"references">, boardId: Id<"boards">) => void;
  onToggleTag: (referenceId: Id<"references">, tagId: Id<"tags">) => void;
  onCreateTag: (referenceId: Id<"references">, name: string) => void;
  onFilterTag: (tagId: Id<"tags">) => void;
}) {
  const asset = reference.assets[0];
  const imageUrl = asset?.storedUrl ?? asset?.originalUrl;

  const [titleDraft, setTitleDraft] = useState(reference.title ?? "");
  const [notesDraft, setNotesDraft] = useState(reference.notes ?? "");
  const [newTag, setNewTag] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const isDirty =
    titleDraft.trim() !== (reference.title ?? "") || notesDraft.trim() !== (reference.notes ?? "");

  async function handleSave() {
    setSavingDetails(true);
    await onSaveDetails(reference._id, { title: titleDraft.trim(), notes: notesDraft.trim() });
    setSavingDetails(false);
  }

  function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreateTag(reference._id, newTag);
    setNewTag("");
  }

  return (
    <div className="selected-reference">
      {imageUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={reference.title ?? "Selected reference"} onError={() => setImageFailed(true)} />
      ) : (
        <div className="selected-placeholder" />
      )}

      <div className="inspector-heading">
        <h2>{reference.title || "Untitled reference"}</h2>
        <button
          type="button"
          className={`favorite-toggle inline ${reference.favorite ? "active" : ""}`}
          aria-label={reference.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={Boolean(reference.favorite)}
          onClick={() => onToggleFavorite(reference)}
        >
          {reference.favorite ? "★" : "☆"}
        </button>
      </div>

      <dl>
        <div>
          <dt>Platform</dt>
          <dd>{reference.platform}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{new Date(reference.capturedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Asset</dt>
          <dd>{assetLabel(asset)}</dd>
        </div>
      </dl>

      <div className="inspector-section">
        <p className="eyebrow">Tags</p>
        <div className="chip-row">
          {tags.length === 0 ? <span className="chip-empty">No tags yet</span> : null}
          {tags.map((tag) => {
            const active = reference.tagIds.includes(tag._id);
            return (
              <button
                type="button"
                key={tag._id}
                className={`tag-chip toggle ${active ? "active" : ""}`}
                onClick={() => onToggleTag(reference._id, tag._id)}
                onDoubleClick={() => onFilterTag(tag._id)}
                title={active ? "Click to remove · double-click to filter" : "Click to add"}
              >
                {active ? "✓ " : ""}
                {tag.name}
              </button>
            );
          })}
        </div>
        <form className="chip-add" onSubmit={submitTag}>
          <input
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder="Add a tag…"
          />
          <button type="submit" disabled={!newTag.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="inspector-section">
        <p className="eyebrow">Boards</p>
        <div className="chip-row">
          {boards.length === 0 ? <span className="chip-empty">No boards yet</span> : null}
          {boards.map((board) => {
            const active = reference.boardIds.includes(board._id);
            return (
              <button
                type="button"
                key={board._id}
                className={`tag-chip toggle ${active ? "active" : ""}`}
                onClick={() => onToggleBoard(reference._id, board._id)}
              >
                {active ? "✓ " : ""}
                {board.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="inspector-fields">
        <label>
          Title
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder="Name this reference"
          />
        </label>
        <label>
          Notes
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder="Lighting, palette, why you saved it…"
            rows={3}
          />
        </label>
        <button type="button" onClick={handleSave} disabled={!isDirty || savingDetails}>
          {savingDetails ? "Saving…" : "Save details"}
        </button>
      </div>

      <div className="inspector-actions">
        <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
          Open source
        </a>
        {asset?.driveWebViewLink ? (
          <a href={asset.driveWebViewLink} target="_blank" rel="noreferrer">
            Open in Drive
          </a>
        ) : null}
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noreferrer">
            Open image
          </a>
        ) : null}
        <button type="button" className="danger" onClick={() => onDelete(reference._id)}>
          Remove reference
        </button>
      </div>
    </div>
  );
}

function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) return undefined;

  return url.replace(/\.convex\.cloud\/?$/, ".convex.site");
}
