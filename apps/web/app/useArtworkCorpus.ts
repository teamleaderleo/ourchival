"use client";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";

export type ArtworkStatus = "wip" | "finished" | "abandoned" | "study";
export type ArtworkRepresentationKind =
  | "editable_source"
  | "master_export"
  | "web_derivative";
export type ArtworkSourceApplication =
  | "procreate"
  | "clip_studio_paint"
  | "blender"
  | "photoshop"
  | "other";

export type Artwork = {
  _id: string;
  title: string;
  notes?: string;
  status: ArtworkStatus;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type ArtworkRepresentation = {
  _id: string;
  artworkId: string;
  kind: ArtworkRepresentationKind;
  storageProvider: "google_drive" | "convex" | "linked";
  driveFileId?: string;
  linkedUrl?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  contentHash?: string;
  width?: number;
  height?: number;
  sourceApplication?: ArtworkSourceApplication;
  createdAt: number;
  updatedAt: number;
};

export type ArtworkPublication = {
  _id: string;
  artworkId: string;
  referenceId: string;
  createdAt: number;
  updatedAt: number;
  reference: {
    id: string;
    title: string | null;
    sourceUrl: string;
    canonicalUrl: string | null;
    platform: string;
    postId: string | null;
    publishedAt: number | null;
    deleted: boolean;
  } | null;
};

export type ArtworkDetail = {
  artwork: Artwork;
  representations: ArtworkRepresentation[];
  publications: ArtworkPublication[];
  representationsTruncated: boolean;
  publicationsTruncated: boolean;
};

type AccessArgs = { accessKey: string };
type ArtworkIdArgs = AccessArgs & { artworkId: string };
type ListArgs = AccessArgs & {
  status?: ArtworkStatus;
  paginationOpts: { numItems: number; cursor: string | null };
};
type ListResult = {
  page: Artwork[];
  isDone: boolean;
  continueCursor: string;
};
type CreateArgs = AccessArgs & {
  title: string;
  notes?: string;
  status?: ArtworkStatus;
};
type AddRepresentationArgs = AccessArgs & {
  artworkId: string;
  kind: ArtworkRepresentationKind;
  storageProvider: "google_drive";
  driveFileId: string;
  fileName?: string;
  sourceApplication?: ArtworkSourceApplication;
};
type RepresentationIdArgs = AccessArgs & { representationId: string };
type PublicationArgs = AccessArgs & { artworkId: string; referenceId: string };
type LinkPublicationByUrlArgs = AccessArgs & { artworkId: string; url: string };
type LinkPublicationByUrlResult = {
  publication: { _id: string; referenceId: string } | null;
  reference: {
    id: string;
    title: string | null;
    platform: string;
    sourceUrl: string;
    canonicalUrl: string | null;
    postId: string | null;
    publishedAt: number | null;
  };
};

const listReference = makeFunctionReference<"query", ListArgs, ListResult>("artworks:list");
const getReference = makeFunctionReference<"query", ArtworkIdArgs, ArtworkDetail | null>(
  "artworks:get",
);
const createReference = makeFunctionReference<"mutation", CreateArgs, Artwork>(
  "artworks:create",
);
const addRepresentationReference = makeFunctionReference<
  "mutation",
  AddRepresentationArgs,
  ArtworkRepresentation
>("artworks:addRepresentation");
const removeRepresentationReference = makeFunctionReference<
  "mutation",
  RepresentationIdArgs,
  { removed: boolean }
>("artworks:removeRepresentation");
const unlinkPublicationReference = makeFunctionReference<
  "mutation",
  PublicationArgs,
  { removed: boolean }
>("artworks:unlinkPublication");
const linkPublicationByUrlReference = makeFunctionReference<
  "mutation",
  LinkPublicationByUrlArgs,
  LinkPublicationByUrlResult
>("artworkPublicationIntake:linkByUrl");

let client: ConvexHttpClient | undefined;

export async function listArtworks() {
  const result = await getClient().query(
    listReference,
    withOwnerAccess({ paginationOpts: { numItems: 100, cursor: null } }),
  );
  return result.page;
}

export async function getArtworkDetail(artworkId: string) {
  return await getClient().query(getReference, withOwnerAccess({ artworkId }));
}

export async function createArtwork(args: {
  title: string;
  notes?: string;
  status?: ArtworkStatus;
}) {
  return await getClient().mutation(createReference, withOwnerAccess(args));
}

export async function attachDriveRepresentation(args: {
  artworkId: string;
  kind: ArtworkRepresentationKind;
  driveFileId: string;
  fileName?: string;
  sourceApplication?: ArtworkSourceApplication;
}) {
  return await getClient().mutation(
    addRepresentationReference,
    withOwnerAccess({ ...args, storageProvider: "google_drive" as const }),
  );
}

export async function removeArtworkRepresentation(representationId: string) {
  return await getClient().mutation(
    removeRepresentationReference,
    withOwnerAccess({ representationId }),
  );
}

export async function linkArtworkPublicationByUrl(artworkId: string, url: string) {
  return await getClient().mutation(
    linkPublicationByUrlReference,
    withOwnerAccess({ artworkId, url }),
  );
}

export async function unlinkArtworkPublication(artworkId: string, referenceId: string) {
  return await getClient().mutation(
    unlinkPublicationReference,
    withOwnerAccess({ artworkId, referenceId }),
  );
}

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) throw new Error("Open the working Ourchival vault before editing artworks.");
  client = new ConvexHttpClient(url);
  return client;
}
