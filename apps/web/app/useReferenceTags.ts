"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ReferenceTag } from "./referenceVaultModel";
import { withOwnerAccess } from "./privateAccess";

type AccessArgs = { accessKey: string };
type UpdateReferenceTagsArgs = AccessArgs & {
  referenceId: string;
  addNames: string[];
  removeIds: string[];
};

type UpdateReferencesTagsArgs = AccessArgs & {
  referenceIds: string[];
  addNames: string[];
  removeIds: string[];
};

const listTagsReference = makeFunctionReference<
  "query",
  AccessArgs,
  ReferenceTag[]
>("tags:list");
const updateReferenceTagsReference = makeFunctionReference<
  "mutation",
  UpdateReferenceTagsArgs,
  ReferenceTag[]
>("tags:updateReference");
const updateReferencesTagsReference = makeFunctionReference<
  "mutation",
  UpdateReferencesTagsArgs,
  { updated: number }
>("tags:updateReferences");

let client: ConvexHttpClient | undefined;
let allTagsPromise: Promise<ReferenceTag[]> | undefined;
let allTagsCache: ReferenceTag[] | undefined;
const tagListeners = new Set<(tags: ReferenceTag[]) => void>();

export function useAllReferenceTags() {
  const [tags, setTags] = useState<ReferenceTag[]>(allTagsCache ?? []);

  useEffect(() => {
    tagListeners.add(setTags);
    void loadAllTags()
      .then(setTags)
      .catch(() => undefined);
    return () => {
      tagListeners.delete(setTags);
    };
  }, []);

  return tags;
}

export function useReferenceTags(
  tagIds: string[] | undefined,
  initialTags: ReferenceTag[] = [],
) {
  const [tags, setTags] = useState<ReferenceTag[]>(initialTags);
  const key = (tagIds ?? []).join(",");

  useEffect(() => {
    let cancelled = false;
    const update = (allTags: ReferenceTag[]) => {
      const ids = new Set(tagIds ?? []);
      setTags(allTags.filter((tag) => ids.has(String(tag._id))));
    };
    tagListeners.add(update);
    if (!tagIds?.length) {
      setTags(initialTags);
      return () => {
        tagListeners.delete(update);
      };
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
      tagListeners.delete(update);
    };
  }, [key]);

  return [tags, setTags] as const;
}

export async function mutateReferenceTags(
  referenceId: string,
  args: { addNames?: string[]; removeIds?: string[] },
) {
  const result = await getClient().mutation(
    updateReferenceTagsReference,
    withOwnerAccess({
      referenceId,
      addNames: args.addNames ?? [],
      removeIds: args.removeIds ?? [],
    }),
  );
  await refreshReferenceTagCatalog();
  return result;
}

export async function mutateReferencesTags(
  referenceIds: string[],
  args: { addNames?: string[]; removeIds?: string[] },
) {
  const result = await getClient().mutation(
    updateReferencesTagsReference,
    withOwnerAccess({
      referenceIds,
      addNames: args.addNames ?? [],
      removeIds: args.removeIds ?? [],
    }),
  );
  await refreshReferenceTagCatalog();
  return result;
}

export async function refreshReferenceTagCatalog() {
  allTagsPromise = undefined;
  allTagsCache = undefined;
  const tags = await loadAllTags();
  for (const listener of tagListeners) listener(tags);
  return tags;
}

export async function saveTagDefinition(args: {
  tagId?: string;
  expectedRevision: number;
  name: string;
  definition: string;
}) {
  const tagId = args.tagId;
  if (!tagId) {
    const tag = await getClient().mutation(
      makeFunctionReference<
        "mutation",
        AccessArgs & { name: string; definition: string },
        ReferenceTag
      >("tags:createDefinition"),
      withOwnerAccess({ name: args.name, definition: args.definition }),
    );
    await refreshReferenceTagCatalog();
    return tag._id;
  }
  await getClient().mutation(
    makeFunctionReference<
      "mutation",
      AccessArgs & {
        tagId: string;
        expectedRevision: number;
        name: string;
        definition: string;
      },
      ReferenceTag
    >("tags:editDefinition"),
    withOwnerAccess({ ...args, tagId }),
  );
  await refreshReferenceTagCatalog();
  return tagId;
}

async function loadAllTags() {
  if (allTagsCache) return allTagsCache;
  if (!allTagsPromise) {
    allTagsPromise = getClient()
      .query(listTagsReference, withOwnerAccess({}))
      .then((tags) => {
        allTagsCache = tags;
        return tags;
      })
      .catch((error) => {
        allTagsPromise = undefined;
        throw error;
      });
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
