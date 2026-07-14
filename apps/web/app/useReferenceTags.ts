"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ReferenceTag } from "./referenceVaultModel";

type UpdateReferenceTagsArgs = {
  referenceId: string;
  addNames: string[];
  removeIds: string[];
};

const listTagsReference = makeFunctionReference<"query", {}, ReferenceTag[]>(
  "tags:list",
);
const updateReferenceTagsReference = makeFunctionReference<
  "mutation",
  UpdateReferenceTagsArgs,
  ReferenceTag[]
>("tags:updateReference");

let client: ConvexHttpClient | undefined;
let allTagsPromise: Promise<ReferenceTag[]> | undefined;

export function useReferenceTags(
  tagIds: string[] | undefined,
  initialTags: ReferenceTag[] = [],
) {
  const [tags, setTags] = useState<ReferenceTag[]>(initialTags);
  const key = (tagIds ?? []).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!tagIds?.length) {
      setTags(initialTags);
      return;
    }

    void loadAllTags()
      .then((allTags) => {
        if (cancelled) return;
        const ids = new Set(tagIds);
        setTags(allTags.filter((tag) => ids.has(String(tag._id))));
      })
      .catch(() => {
        if (!cancelled) setTags(initialTags);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return [tags, setTags] as const;
}

export async function mutateReferenceTags(
  referenceId: string,
  args: { addNames?: string[]; removeIds?: string[] },
) {
  const result = await getClient().mutation(updateReferenceTagsReference, {
    referenceId,
    addNames: args.addNames ?? [],
    removeIds: args.removeIds ?? [],
  });
  allTagsPromise = undefined;
  return result;
}

async function loadAllTags() {
  if (!allTagsPromise) {
    allTagsPromise = getClient().query(listTagsReference, {});
  }
  return await allTagsPromise;
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before editing tags.");
  client = new ConvexHttpClient(url);
  return client;
}
