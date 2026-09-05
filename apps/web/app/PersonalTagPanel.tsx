"use client";

import { useState, type FormEvent } from "react";
import { saveTagDefinition, useAllReferenceTags } from "./useReferenceTags";
import type { ReferenceTag } from "./referenceVaultModel";

export function PersonalTagPanel() {
  const tags = useAllReferenceTags();
  const [selected, setSelected] = useState("");
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
            Tag{" "}
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Create a personal tag</option>
              {tags.map((tag) => (
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

function TagDefinitionForm({
  tag,
  onSaved,
}: {
  tag?: ReferenceTag;
  onSaved: (id: string) => void;
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
      setMessage(
        "Saved. Existing assignments keep this tag; search names refresh in the background.",
      );
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
          maxLength={2000}
          rows={3}
          value={definition}
          placeholder="For example: broken, scratchy outlines with visible gaps. Smooth continuous outlines do not count."
          onChange={(event) => setDefinition(event.target.value)}
        />
      </label>
      <p>
        Renaming applies everywhere. Changing the meaning starts a new
        definition; earlier examples need review.
      </p>
      <button disabled={busy} type="submit">
        {busy ? "Saving…" : tag ? "Save tag definition" : "Create tag"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
