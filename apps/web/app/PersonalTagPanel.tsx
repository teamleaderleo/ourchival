"use client";

import { useState, type FormEvent } from "react";
import { saveTagDefinition, useAllReferenceTags } from "./useReferenceTags";
import type { ReferenceTag } from "./referenceVaultModel";
import { usePersonalTagSelection } from "./usePersonalTagSelection";

export function PersonalTagPanel() {
  const tags = useAllReferenceTags();
  const [selected, setSelected] = usePersonalTagSelection();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <details
      className="personal-tag-catalog"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>My tag definitions</summary>
      {open && (
        <div className="inspector-organization-body">
          <label>
            Find a tag
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Name or previous name"
            />
          </label>
          <label>
            Tag{" "}
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Create a personal tag</option>
              {tags
                .filter(
                  (tag) =>
                    tag._id === selected ||
                    [tag.name, ...(tag.aliases ?? [])]
                      .join(" ")
                      .toLowerCase()
                      .includes(filter.toLowerCase()),
                )
                .map((tag) => (
                  <option key={tag._id} value={tag._id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          </label>
          <TagDefinitionForm
            key={selected}
            tag={tags.find((tag) => tag._id === selected)}
            onSaved={setSelected}
          />
        </div>
      )}
    </details>
  );
}

export function TagDefinitionForm({
  tag,
  onSaved,
  requireDefinition = false,
}: {
  tag?: ReferenceTag;
  onSaved: (id: string) => void;
  requireDefinition?: boolean;
}) {
  const [name, setName] = useState(tag?.name ?? "");
  const [definition, setDefinition] = useState(tag?.definition ?? "");
  const [revision, setRevision] = useState(tag?.revision ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const id = await saveTagDefinition({
        tagId: tag?._id,
        expectedRevision: revision,
        name,
        definition,
      });
      setRevision(revision + 1);
      setMessage("Saved. This name applies everywhere.");
      onSaved(id);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="personal-tag-form">
      <label>
        Name
        <input
          required
          maxLength={48}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        What this tag means
        <textarea
          required={requireDefinition}
          maxLength={2000}
          rows={3}
          value={definition}
          placeholder="For example: broken, scratchy outlines with visible gaps. Smooth continuous outlines do not count."
          onChange={(event) => setDefinition(event.target.value)}
        />
      </label>
      {definition !== (tag?.definition ?? "") && tag?.definition && (
        <p>Changing the meaning keeps your earlier examples for review.</p>
      )}
      <button disabled={busy} type="submit">
        {busy ? "Saving…" : tag ? "Save tag definition" : "Create tag"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
