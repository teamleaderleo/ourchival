"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export type ReferenceBoard = {
  _id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  referenceCount: number;
};

type CreateBoardArgs = { name: string; description?: string };
type UpdateBoardArgs = { boardId: string; name: string; description?: string };
type RemoveBoardArgs = { boardId: string };
type UpdateReferenceBoardsArgs = {
  referenceId: string;
  addBoardIds: string[];
  removeBoardIds: string[];
};
type UpdateReferencesBoardsArgs = {
  referenceIds: string[];
  boardId: string;
  mode: "add" | "remove";
};

const listBoardsReference = makeFunctionReference<"query", {}, ReferenceBoard[]>(
  "boards:list",
);
const createBoardReference = makeFunctionReference<
  "mutation",
  CreateBoardArgs,
  ReferenceBoard
>("boards:create");
const updateBoardReference = makeFunctionReference<
  "mutation",
  UpdateBoardArgs,
  ReferenceBoard
>("boards:update");
const removeBoardReference = makeFunctionReference<
  "mutation",
  RemoveBoardArgs,
  { removed: boolean; referencesUpdated: number }
>("boards:remove");
const updateReferenceBoardsReference = makeFunctionReference<
  "mutation",
  UpdateReferenceBoardsArgs,
  string[]
>("boards:updateReference");
const updateReferencesBoardsReference = makeFunctionReference<
  "mutation",
  UpdateReferencesBoardsArgs,
  { updated: number }
>("boards:updateReferences");

let client: ConvexHttpClient | undefined;
let boardsPromise: Promise<ReferenceBoard[]> | undefined;
let boardsCache: ReferenceBoard[] | undefined;
const listeners = new Set<(boards: ReferenceBoard[]) => void>();

export function useAllReferenceBoards() {
  const [boards, setBoards] = useState<ReferenceBoard[]>(boardsCache ?? []);

  useEffect(() => {
    listeners.add(setBoards);
    void loadBoards().then(setBoards).catch(() => undefined);
    return () => {
      listeners.delete(setBoards);
    };
  }, []);

  return boards;
}

export async function createReferenceBoard(name: string, description?: string) {
  await getClient().mutation(createBoardReference, { name, description });
  return await refreshBoards();
}

export async function updateReferenceBoard(
  boardId: string,
  name: string,
  description?: string,
) {
  await getClient().mutation(updateBoardReference, { boardId, name, description });
  return await refreshBoards();
}

export async function removeReferenceBoard(boardId: string) {
  const result = await getClient().mutation(removeBoardReference, { boardId });
  await refreshBoards();
  return result;
}

export async function mutateReferenceBoards(
  referenceId: string,
  args: { addBoardIds?: string[]; removeBoardIds?: string[] },
) {
  const boardIds = await getClient().mutation(updateReferenceBoardsReference, {
    referenceId,
    addBoardIds: args.addBoardIds ?? [],
    removeBoardIds: args.removeBoardIds ?? [],
  });
  await refreshBoards();
  return boardIds;
}

export async function mutateReferencesBoards(
  referenceIds: string[],
  boardId: string,
  mode: "add" | "remove",
) {
  const result = await getClient().mutation(updateReferencesBoardsReference, {
    referenceIds,
    boardId,
    mode,
  });
  await refreshBoards();
  return result;
}

async function refreshBoards() {
  boardsPromise = undefined;
  boardsCache = undefined;
  const boards = await loadBoards();
  for (const listener of listeners) listener(boards);
  return boards;
}

async function loadBoards() {
  if (boardsCache) return boardsCache;
  if (!boardsPromise) {
    boardsPromise = getClient().query(listBoardsReference, {}).then((boards) => {
      boardsCache = boards;
      return boards;
    });
  }
  return await boardsPromise;
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before editing boards.");
  client = new ConvexHttpClient(url);
  return client;
}
