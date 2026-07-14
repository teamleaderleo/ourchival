"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { VaultView } from "./VaultNavigation";

export type SavedSearch = {
  _id: string;
  name: string;
  query: string;
  view: VaultView;
  createdAt: number;
  updatedAt: number;
};

type SaveSearchArgs = {
  name: string;
  query: string;
  view: VaultView;
};
type UpdateSavedSearchArgs = SaveSearchArgs & { savedSearchId: string };
type SavedSearchIdArgs = { savedSearchId: string };

const listSavedSearchesReference = makeFunctionReference<
  "query",
  {},
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

export async function createSavedSearch(args: SaveSearchArgs) {
  await getClient().mutation(createSavedSearchReference, args);
  return await refreshSearches();
}

export async function updateSavedSearch(args: UpdateSavedSearchArgs) {
  await getClient().mutation(updateSavedSearchReference, args);
  return await refreshSearches();
}

export async function removeSavedSearch(savedSearchId: string) {
  const result = await getClient().mutation(removeSavedSearchReference, {
    savedSearchId,
  });
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
      .query(listSavedSearchesReference, {})
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
