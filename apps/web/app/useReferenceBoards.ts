"use client";

import { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";

export type ReferenceBoard = {
  _id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  referenceCount: number;
};

type AccessArgs = { accessKey: string };
type CreateBoardArgs = AccessArgs & { name: string; description?: string };
type UpdateBoardArgs = AccessArgs & {
  boardId: string;
  name: string;
  description?: string;
};
type RemoveBoardArgs = AccessArgs & { boardId: string };
type UpdateReferenceBoardsArgs = AccessArgs & {
  referenceId: string;
  addBoardIds: string[];
  removeBoardIds: string[];
};
type UpdateReferencesBoardsArgs = AccessArgs & {
  referenceIds: string[];
  boardId: string;
  mode: "add" | "remove";
};

const listBoardsReference = makeFunctionReference<
  "query",
  AccessArgs,
  ReferenceBoard[]
>("boards:list");
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
  await getClient().mutation(
    createBoardReference,
    withOwnerAccess({ name, description }),
  );
  return await refreshBoards();
}

export async function updateReferenceBoard(
  boardId: string,
  name: string,
  description?: string,
) {
  await getClient().mutation(
    updateBoardReference,
    withOwnerAccess({ boardId, name, description }),
  );
  return await refreshBoards();
}

export async function removeReferenceBoard(boardId: string) {
  const result = await getClient().mutation(
    removeBoardReference,
    withOwnerAccess({ boardId }),
  );
  await refreshBoards();
  return result;
}

export async function mutateReferenceBoards(
  referenceId: string,
  args: { addBoardIds?: string[]; removeBoardIds?: string[] },
) {
  const boardIds = await getClient().mutation(
    updateReferenceBoardsReference,
    withOwnerAccess({
      referenceId,
      addBoardIds: args.addBoardIds ?? [],
      removeBoardIds: args.removeBoardIds ?? [],
    }),
  );
  await refreshBoards();
  return boardIds;
}

export async function mutateReferencesBoards(
  referenceIds: string[],
  boardId: string,
  mode: "add" | "remove",
) {
  const result = await getClient().mutation(
    updateReferencesBoardsReference,
    withOwnerAccess({ referenceIds, boardId, mode }),
  );
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
    boardsPromise = getClient()
      .query(listBoardsReference, withOwnerAccess({}))
      .then((boards) => {
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
