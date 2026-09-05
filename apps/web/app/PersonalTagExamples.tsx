"use client";
import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";
import { useAllReferenceTags } from "./useReferenceTags";
import { usePrivateImageUrl } from "./usePrivateImageUrl";
import type {
  ReferenceAsset,
  ReferenceTag,
  SavedReference,
} from "./referenceVaultModel";

type Example = { positive: boolean; definitionVersion: number } | null;
const read = makeFunctionReference<
  "query",
  { accessKey: string; tagId: string; assetId: string },
  Example
>("tags:examplesForAsset");
const save = makeFunctionReference<
  "mutation",
  {
    accessKey: string;
    tagId: string;
    assetId: string;
    definitionVersion: number;
    positive: boolean | null;
  },
  null
>("tags:setExample");
function client() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Archive connection is unavailable.");
  return new ConvexHttpClient(url);
}

export function PersonalTagExamples({
  reference,
}: {
  reference: SavedReference;
}) {
  const tags = useAllReferenceTags().filter((tag) => tag.definition);
  const [selected, setSelected] = useState("");
  const tag = tags.find((item) => item._id === selected);
  return (
    <div className="inspector-organization-body personal-tag-teaching">
      <p>Show what you mean with examples and counterexamples.</p>
      {!tags.length ? (
        <p>Create a definition in Tools → My tag definitions first.</p>
      ) : (
        <label>
          Teach a tag
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a tag</option>
            {tags.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {tag && (
        <>
          <p>{tag.definition}</p>
          {reference.assets.map((asset) => (
            <ExampleImage
              key={`${asset._id}:${tag._id}:${tag.definitionVersion}`}
              asset={asset}
              tag={tag}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ExampleImage({
  asset,
  tag,
}: {
  asset: ReferenceAsset;
  tag: ReferenceTag;
}) {
  const image = usePrivateImageUrl(
    asset.previewUrl ?? asset.storedUrl ?? asset.thumbUrl ?? undefined,
  );
  const [example, setExample] = useState<Example>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [failedImage, setFailedImage] = useState(false);
  useEffect(() => {
    let active = true;
    client()
      .query(read, withOwnerAccess({ tagId: tag._id, assetId: asset._id }))
      .then((value) => {
        if (active) setExample(value);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Could not load the previous example. You can save a new choice.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [asset._id, tag._id]);
  async function choose(positive: boolean | null) {
    setBusy(true);
    try {
      await client().mutation(
        save,
        withOwnerAccess({
          tagId: tag._id,
          assetId: asset._id,
          definitionVersion: tag.definitionVersion!,
          positive,
        }),
      );
      setExample(
        positive === null
          ? null
          : { positive, definitionVersion: tag.definitionVersion! },
      );
      setMessage(positive === null ? "Example cleared." : "Example saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="personal-tag-example">
      {image.resolvedUrl && !failedImage ? (
        // Private blob URLs must be displayed directly, without an image proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.resolvedUrl}
          alt="Image to evaluate for this tag"
          onError={() => setFailedImage(true)}
        />
      ) : (
        <p>{image.loading ? "Loading preview…" : "Preview unavailable."}</p>
      )}
      {example && (
        <p>
          {example.definitionVersion !== tag.definitionVersion
            ? "Earlier definition—review this example."
            : example.positive
              ? "Marked as an example"
              : "Marked as a counterexample"}
        </p>
      )}
      {image.resolvedUrl && !failedImage && (
        <div>
          <button disabled={busy} onClick={() => void choose(true)}>
            Shows this
          </button>{" "}
          <button disabled={busy} onClick={() => void choose(false)}>
            Does not show this
          </button>
          {example && (
            <button disabled={busy} onClick={() => void choose(null)}>
              Clear example
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
