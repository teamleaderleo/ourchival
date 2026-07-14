"use client";

import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type DuplicateReferencePreview = {
  _id: string;
  title?: string;
  sourceUrl: string;
  platform: string;
  capturedAt: number;
  favorite: boolean;
  tagCount: number;
  boardCount: number;
  previewUrl?: string | null;
};

export type DuplicateGroup = {
  perceptualHash: string;
  references: DuplicateReferencePreview[];
  hiddenCount: number;
};

type ListGroupsArgs = { limit?: number };
type ListGroupsResult = {
  groups: DuplicateGroup[];
  scanned: number;
  truncated: boolean;
};
type DismissArgs = { perceptualHash: string; referenceIds: string[] };
type MergeArgs = {
  perceptualHash: string;
  keepReferenceId: string;
  duplicateReferenceIds: string[];
};

const listGroups = makeFunctionReference<
  "query",
  ListGroupsArgs,
  ListGroupsResult
>("duplicateReview:listGroups");
const dismissGroup = makeFunctionReference<
  "mutation",
  DismissArgs,
  { recorded: number }
>("duplicateReview:dismissGroup");
const mergeGroup = makeFunctionReference<
  "mutation",
  MergeArgs,
  {
    merged: number;
    projectsTransferred: number;
    tagCount: number;
    boardCount: number;
    favorite: boolean;
  }
>("duplicateReview:mergeGroup");

let client: ConvexHttpClient | undefined;

export function useDuplicateReview(limit = 12) {
  const [result, setResult] = useState<ListGroupsResult>({
    groups: [],
    scanned: 0,
    truncated: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(listGroups, { limit });
      setResult(next);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load duplicate review groups.",
      );
      return { groups: [], scanned: 0, truncated: false };
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...result, loading, error, refresh };
}

export async function dismissDuplicateGroup(group: DuplicateGroup) {
  return await getClient().mutation(dismissGroup, {
    perceptualHash: group.perceptualHash,
    referenceIds: group.references.map((reference) => reference._id),
  });
}

export async function mergeDuplicateGroup(
  group: DuplicateGroup,
  keepReferenceId: string,
) {
  return await getClient().mutation(mergeGroup, {
    perceptualHash: group.perceptualHash,
    keepReferenceId,
    duplicateReferenceIds: group.references
      .map((reference) => reference._id)
      .filter((referenceId) => referenceId !== keepReferenceId),
  });
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before reviewing duplicates.");
  client = new ConvexHttpClient(url);
  return client;
}
