"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { referenceTagGroups, filterReviewTags } from "./referenceTagGroups";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";
import { usePrivateImageUrl } from "./usePrivateImageUrl";
import type { SavedReference } from "./referenceVaultModel";

type Corrections = {
  rejectedTags: string[];
  hideOcr: boolean;
  hideCaption: boolean;
  revision: number;
};
type Item = {
  assetId: string;
  state: "ready" | "stale" | "not_analyzed";
  generatedAt: number | null;
  tags: Array<{
    name: string;
    category: string;
    confidence: number;
    rejected: boolean;
  }>;
  ocrText: string;
  caption: string;
  models: Array<{ id: string; revision: string; task: string }>;
  corrections: Corrections;
};
type Metadata = { items: Item[]; truncated: boolean };
const inspect = makeFunctionReference<
  "query",
  { accessKey: string; referenceId: string },
  Metadata
>("visualEnrichment:inspect");
const correct = makeFunctionReference<
  "mutation",
  {
    accessKey: string;
    assetId: string;
    rejectedTags: string[];
    hideOcr: boolean;
    hideCaption: boolean;
    expectedRevision: number;
  },
  null
>("visualEnrichment:correct");
let client: ConvexHttpClient | undefined;
function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Archive connection is unavailable.");
  return (client = new ConvexHttpClient(url));
}

/** Mounted only when the owner opens the metadata disclosure. No idle polling. */
export function ReferenceVisualMetadata({
  reference,
  compact = false,
}: {
  reference: SavedReference;
  compact?: boolean;
}) {
  const [data, setData] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requests = useRef({ serial: 0 }).current;
  const load = useCallback(async () => {
    const serial = ++requests.serial;
    setLoading(true);
    try {
      const next = await getClient().query(
        inspect,
        withOwnerAccess({ referenceId: reference._id }),
      );
      if (serial === requests.serial) {
        setData(next);
        setMessage("");
      }
      return true;
    } catch {
      if (serial === requests.serial) {
        setData(null);
        setMessage("Could not load image metadata. Try reloading.");
      }
      return false;
    } finally {
      if (serial === requests.serial) setLoading(false);
    }
  }, [reference._id, requests]);
  useEffect(() => {
    void load();
    return () => {
      requests.serial++;
    };
  }, [load, requests]);

  async function save(item: Item, next: Corrections) {
    setBusy(true);
    setMessage("");
    try {
      await getClient().mutation(
        correct,
        withOwnerAccess({
          assetId: item.assetId,
          rejectedTags: next.rejectedTags,
          hideOcr: next.hideOcr,
          hideCaption: next.hideCaption,
          expectedRevision: item.corrections.revision,
        }),
      );
      const loaded = await load();
      setMessage(
        loaded
          ? "Search preferences saved. They will survive future image analysis."
          : "Change saved, but updated metadata could not be loaded. Reload to continue.",
      );
    } catch {
      await load();
      setMessage(
        "Could not confirm this change. Review the reloaded metadata before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="visual-metadata" aria-label="Image metadata">
      <div className="visual-metadata-heading">
        <strong>{compact ? "Model suggestions" : "Generated image metadata"}</strong>
        <button
          type="button"
          className="button ghost"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Reload
        </button>
      </div>
      <p>
        {compact ? "Predictions, separate from your accepted tags." : "Keep useful search terms and exclude mistakes. These are model predictions, separate from your saved tags and source credit."}
      </p>
      {loading && !data ? <p role="status">Loading image metadata…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {data?.items.length === 0 ? (
        <p>No saved images to analyze in this reference.</p>
      ) : null}
      {data?.items.map((item, index) => (
        <AssetMetadata
          key={item.assetId}
          item={item}
          index={index}
          source={
            compact ? undefined : reference.assets.find((asset) => asset._id === item.assetId)
              ?.previewUrl ??
            reference.assets.find((asset) => asset._id === item.assetId)
              ?.storedUrl
          }
          disabled={busy || loading}
          onSave={(next) => save(item, next)}
        />
      ))}
      {data?.truncated ? (
        <p>Showing the first 32 images in this reference.</p>
      ) : null}
    </section>
  );
}

export function AssetMetadata({
  item,
  index,
  source,
  disabled,
  onSave,
}: {
  item: Item;
  index: number;
  source?: string | null;
  disabled: boolean;
  onSave: (next: Corrections) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const image = usePrivateImageUrl(source);
  const groups = referenceTagGroups(item.tags);
  const visibleGroups = expanded
    ? [{ name: "All model terms", tags: filterReviewTags(item.tags, tagQuery) }]
    : groups.map((group) => ({ ...group, tags: group.tags.slice(0, 3) }));
  useEffect(() => {
    setImageFailed(false);
  }, [source]);
  return (
    <article className="visual-metadata-asset">
      <div className="visual-metadata-image">
        {image.resolvedUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.resolvedUrl}
            alt={`Image ${index + 1} being reviewed`}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span>
            {image.loading ? "Loading preview…" : "Preview unavailable"}
          </span>
        )}
        <div>
          <strong>Image {index + 1}</strong>
          <p>
            {item.state === "ready"
              ? "Generated · ready to review"
              : item.state === "stale"
                ? "Image changed · analysis needs updating"
                : "Not analyzed yet"}
          </p>
        </div>
      </div>
      {item.state === "stale" ? (
        <p>
          Previous predictions are excluded from search until this image is
          analyzed again.
        </p>
      ) : null}
      {item.state === "not_analyzed" ? (
        <p>
          No model analysis has been saved for this image. Downloading it does
          not automatically run image tagging. Source details and your saved
          tags are still searchable.
        </p>
      ) : null}
      {item.state === "ready" ? (
        <>
          <p className="visual-metadata-hint">
            Scores reflect model confidence, not verified facts. Select a term
            to exclude it; select it again to restore it.
          </p>
          {expanded ? (
            <label>
              Find a model term
              <input
                type="search"
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                placeholder="Pose, clothing, artist…"
              />
            </label>
          ) : (
            <p>
              Reference details · up to three terms per group. All other terms
              remain searchable unless excluded.
            </p>
          )}
          {!expanded && !groups.length && item.tags.length > 0 ? (
            <p>
              No reference details were recognized. Open all terms to review the
              remaining predictions.
            </p>
          ) : null}
          {visibleGroups.map((group) => (
            <section key={group.name} aria-label={group.name}>
              <strong>{group.name}</strong>
              <div className="visual-metadata-tags">
                {group.tags.map((tag) => (
                  <button
                    type="button"
                    key={tag.name}
                    disabled={disabled}
                    aria-pressed={tag.rejected}
                    aria-label={`${tag.rejected ? "Restore" : "Exclude"} ${tag.name.replace(/_/g, " ")} ${tag.rejected ? "in" : "from"} search`}
                    onClick={() =>
                      void onSave({
                        ...item.corrections,
                        rejectedTags: tag.rejected
                          ? item.corrections.rejectedTags.filter(
                              (name) => name !== tag.name,
                            )
                          : [...item.corrections.rejectedTags, tag.name],
                      })
                    }
                  >
                    <span>{tag.name.replace(/_/g, " ")}</span>
                    <small>
                      {tag.rejected
                        ? "Excluded"
                        : `Score ${tag.confidence.toFixed(2)}`}
                    </small>
                  </button>
                ))}
              </div>
              {expanded && !group.tags.length ? (
                <p>No terms match this search.</p>
              ) : null}
            </section>
          ))}
          {item.tags.length > 0 ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setExpanded(!expanded);
                setTagQuery("");
              }}
              aria-expanded={expanded}
            >
              {expanded
                ? "Show reference details"
                : `Show all ${item.tags.length} terms`}
            </button>
          ) : null}
          {!item.tags.length ? (
            <p>No visual tags passed this model&apos;s threshold.</p>
          ) : null}
          {item.ocrText ? (
            <details>
              <summary>Recognized text · machine</summary>
              <p className="visual-metadata-text">{item.ocrText}</p>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!item.corrections.hideOcr}
                  onChange={(event) =>
                    void onSave({
                      ...item.corrections,
                      hideOcr: !event.target.checked,
                    })
                  }
                />{" "}
                Include recognized text in search
              </label>
            </details>
          ) : null}
          {item.caption ? (
            <details>
              <summary>Description · machine</summary>
              <p className="visual-metadata-text">{item.caption}</p>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!item.corrections.hideCaption}
                  onChange={(event) =>
                    void onSave({
                      ...item.corrections,
                      hideCaption: !event.target.checked,
                    })
                  }
                />{" "}
                Include this description in search
              </label>
            </details>
          ) : null}
        </>
      ) : null}
      {item.models.length ? (
        <details>
          <summary>Analysis source</summary>
          <p>
            Generated{" "}
            {item.generatedAt
              ? new Date(item.generatedAt).toLocaleString()
              : "at an unknown time"}
            .
          </p>
          {item.models.map((model) => (
            <p key={`${model.id}:${model.task}`}>
              {model.id}
              <br />
              <small>Revision {model.revision.slice(0, 12)}</small>
            </p>
          ))}
        </details>
      ) : null}
    </article>
  );
}
