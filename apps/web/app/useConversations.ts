"use client";

import { buildConversationFingerprints } from "@ourchival/shared";
import { useCallback, useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  serializeConversationArchive,
  type ConversationArchive,
  type ConversationImportFormat,
} from "./conversationImport";
import { withOwnerAccess } from "./privateAccess";
import { retryOnce } from "./retryOnce";

export type ConversationSummary = {
  _id: string;
  referenceId: string;
  provider: "generic" | "chatgpt" | "claude" | "gemini";
  providerConversationId?: string;
  canonicalUrl?: string;
  title: string;
  snapshotCount: number;
  firstCapturedAt: number;
  lastCapturedAt: number;
  createdAt: number;
  updatedAt: number;
  reference: {
    _id: string;
    title?: string;
    sourceUrl: string;
    triageState?: "inbox" | "kept" | "later";
    favorite: boolean;
    archived: boolean;
  };
  latestSnapshot: {
    _id: string;
    messageCount: number;
    addedCount: number;
    changedCount: number;
    removedCount: number;
    capturedAt: number;
  };
};

export type ConversationDetail = ConversationSummary & {
  reference: ConversationSummary["reference"] & { notes?: string };
  latestSnapshot: ConversationSummary["latestSnapshot"] & {
    storageId: string;
    contentHash: string;
    messageFingerprints: string[];
    captureMethod: "import" | "browser";
    format: "json" | "markdown" | "provider";
    adapter: string;
    previousSnapshotId?: string;
    createdAt: number;
    storageUrl: string | null;
  };
};

type AccessArgs = { accessKey: string };
type ListArgs = AccessArgs & { limit?: number };
type GetArgs = AccessArgs & { conversationId: string };
type CommitArgs = AccessArgs & {
  storageId: string;
  provider: ConversationArchive["provider"];
  providerConversationId?: string;
  sourceUrl?: string;
  title: string;
  format: "json" | "markdown" | "provider";
  adapter: string;
  messageCount: number;
  messageFingerprints: string[];
  capturedAt?: number;
};
type CommitResult = {
  conversationId: string;
  referenceId: string;
  snapshotId: string;
  duplicate: boolean;
  addedCount: number;
  changedCount: number;
  removedCount: number;
};

const createUploadReference = makeFunctionReference<
  "mutation",
  AccessArgs,
  { uploadUrl: string }
>("conversations:createImportUpload");
const commitImportReference = makeFunctionReference<
  "mutation",
  CommitArgs,
  CommitResult
>("conversations:commitImport");
const listRecentReference = makeFunctionReference<
  "query",
  ListArgs,
  ConversationSummary[]
>("conversations:listRecent");
const getOneReference = makeFunctionReference<
  "query",
  GetArgs,
  ConversationDetail | null
>("conversations:getOne");

let client: ConvexHttpClient | undefined;

export function useConversations(limit = 40) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        listRecentReference,
        withOwnerAccess({ limit }),
      );
      setConversations(next);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load conversations.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, loading, error, refresh };
}

export function useConversation(conversationId?: string) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [archive, setArchive] = useState<ConversationArchive | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setDetail(null);
      setArchive(null);
      return null;
    }
    setLoading(true);
    setError("");
    try {
      const next = await getClient().query(
        getOneReference,
        withOwnerAccess({ conversationId }),
      );
      setDetail(next);
      if (!next?.latestSnapshot.storageUrl) {
        setArchive(null);
        return next;
      }
      const response = await fetch(next.latestSnapshot.storageUrl);
      if (!response.ok) throw new Error("Could not load the conversation snapshot.");
      const body = (await response.json()) as ConversationArchive;
      setArchive(body);
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load the conversation.",
      );
      setDetail(null);
      setArchive(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { detail, archive, loading, error, refresh };
}

export async function importConversationArchive(args: {
  archive: ConversationArchive;
  originalFormat: ConversationImportFormat;
}) {
  const normalized = serializeConversationArchive(args.archive);
  const file = new Blob([normalized], {
    type: "application/json;charset=utf-8",
  });
  if (file.size > 5_000_000) {
    throw new Error("Normalized conversation is too large to upload.");
  }
  const client = getClient();
  const upload = await client.mutation(
    createUploadReference,
    withOwnerAccess({}),
  );
  const response = await fetch(upload.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const body = (await response.json().catch(() => ({}))) as {
    storageId?: string;
  };
  if (!response.ok || !body.storageId) {
    throw new Error(response.statusText || "Conversation upload failed.");
  }
  const fingerprintBundle = buildConversationFingerprints(args.archive.messages);
  const commitArgs = withOwnerAccess({
    storageId: body.storageId,
    provider: args.archive.provider,
    ...(args.archive.providerConversationId
      ? { providerConversationId: args.archive.providerConversationId }
      : {}),
    ...(args.archive.sourceUrl ? { sourceUrl: args.archive.sourceUrl } : {}),
    title: args.archive.title,
    format: args.originalFormat,
    adapter: `generic.${args.originalFormat}.v2;identity=${fingerprintBundle.confidence}`,
    messageCount: args.archive.messages.length,
    messageFingerprints: fingerprintBundle.fingerprints,
    capturedAt: Date.parse(args.archive.capturedAt),
  });

  return await retryOnce(() =>
    client.mutation(commitImportReference, commitArgs),
  );
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Add NEXT_PUBLIC_CONVEX_URL before using conversations.");
  client = new ConvexHttpClient(url);
  return client;
}
