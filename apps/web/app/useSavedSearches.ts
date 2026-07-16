"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { VaultView } from "./VaultNavigation";
import { withOwnerAccess } from "./privateAccess";

export type SavedSearch = {
  _id: string;
  name: string;
  query: string;
  view: VaultView;
  createdAt: number;
  updatedAt: number;
};

type AccessArgs = { accessKey: string };
type SaveSearchArgs = AccessArgs & {
  name: string;
  query: string;
  view: VaultView;
};
type UpdateSavedSearchArgs = SaveSearchArgs & { savedSearchId: string };
type SavedSearchIdArgs = AccessArgs & { savedSearchId: string };

const listSavedSearchesReference = makeFunctionReference<
  "query",
  AccessArgs,
  SavedSearch[]
>("savedSearches:list");
const createSavedSearchReference = makeFunctionReference<
  "mutation",
  SaveSearchArgs,
  SavedSearch
>("savedSearches:create");
const updateSavedSearchReference = makeFunctionReference<
  "mutation",
  UpdateSavedSearchArgs,
  SavedSearch
>("savedSearches:update");
const removeSavedSearchReference = makeFunctionReference<
  "mutation",
  SavedSearchIdArgs,
  boolean
>("savedSearches:remove");

let client: ConvexHttpClient | undefined;
let searchesPromise: Promise<SavedSearch[]> | undefined;
let searchesCache: SavedSearch[] | undefined;
const listeners = new Set<(searches: SavedSearch[]) => void>();

export function useSavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>(searchesCache ?? []);

  useEffect(() => {
    listeners.add(setSearches);
    void loadSearches().then(setSearches).catch(() => undefined);
    return () => {
      listeners.delete(setSearches);
    };
  }, []);

  return searches;
}

export async function createSavedSearch(
  args: Omit<SaveSearchArgs, "accessKey">,
) {
  await getClient().mutation(createSavedSearchReference, withOwnerAccess(args));
  return await refreshSearches();
}

export async function updateSavedSearch(
  args: Omit<UpdateSavedSearchArgs, "accessKey">,
) {
  await getClient().mutation(updateSavedSearchReference, withOwnerAccess(args));
  return await refreshSearches();
}

export async function removeSavedSearch(savedSearchId: string) {
  const result = await getClient().mutation(
    removeSavedSearchReference,
    withOwnerAccess({ savedSearchId }),
  );
  await refreshSearches();
  return result;
}

async function refreshSearches() {
  searchesPromise = undefined;
  searchesCache = undefined;
  const searches = await loadSearches();
  for (const listener of listeners) listener(searches);
  return searches;
}

async function loadSearches() {
  if (searchesCache) return searchesCache;
  if (!searchesPromise) {
    searchesPromise = getClient()
      .query(listSavedSearchesReference, withOwnerAccess({}))
      .then((searches) => {
        searchesCache = searches;
        return searches;
      });
  }
  return await searchesPromise;
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before saving searches.");
  client = new ConvexHttpClient(url);
  return client;
}
