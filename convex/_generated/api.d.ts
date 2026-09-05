/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as archiveSearch from "../archiveSearch.js";
import type * as boards from "../boards.js";
import type * as captureObservations from "../captureObservations.js";
import type * as captureSessions from "../captureSessions.js";
import type * as crons from "../crons.js";
import type * as enrichmentBatch from "../enrichmentBatch.js";
import type * as enrichmentJobs from "../enrichmentJobs.js";
import type * as http from "../http.js";
import type * as httpDb from "../httpDb.js";
import type * as lib_assetQuality from "../lib/assetQuality.js";
import type * as lib_captureSessions from "../lib/captureSessions.js";
import type * as lib_compactVisual from "../lib/compactVisual.js";
import type * as lib_drive from "../lib/drive.js";
import type * as lib_enrichmentJobState from "../lib/enrichmentJobState.js";
import type * as lib_imageAnalysis from "../lib/imageAnalysis.js";
import type * as lib_linkIntake from "../lib/linkIntake.js";
import type * as lib_linkMetadata from "../lib/linkMetadata.js";
import type * as lib_perceptualHash from "../lib/perceptualHash.js";
import type * as lib_platform from "../lib/platform.js";
import type * as lib_privateAccess from "../lib/privateAccess.js";
import type * as lib_referenceCatalog from "../lib/referenceCatalog.js";
import type * as lib_referenceOrigin from "../lib/referenceOrigin.js";
import type * as lib_relatedReferences from "../lib/relatedReferences.js";
import type * as lib_reviewPreferences from "../lib/reviewPreferences.js";
import type * as lib_searchDocument from "../lib/searchDocument.js";
import type * as lib_searchIndex from "../lib/searchIndex.js";
import type * as lib_searchMatches from "../lib/searchMatches.js";
import type * as lib_searchSchema from "../lib/searchSchema.js";
import type * as lib_sourceContext from "../lib/sourceContext.js";
import type * as lib_sourceMetadata from "../lib/sourceMetadata.js";
import type * as lib_suggestedTags from "../lib/suggestedTags.js";
import type * as lib_tagCodec from "../lib/tagCodec.js";
import type * as lib_tagIdentity from "../lib/tagIdentity.js";
import type * as lib_tags from "../lib/tags.js";
import type * as lib_urls from "../lib/urls.js";
import type * as lib_visualMetadata from "../lib/visualMetadata.js";
import type * as lib_visualValidation from "../lib/visualValidation.js";
import type * as mediaDerivatives from "../mediaDerivatives.js";
import type * as mediaDerivativesNode from "../mediaDerivativesNode.js";
import type * as metadataMigration from "../metadataMigration.js";
import type * as preferenceExport from "../preferenceExport.js";
import type * as projects from "../projects.js";
import type * as referenceOrigins from "../referenceOrigins.js";
import type * as references from "../references.js";
import type * as relatedReferences from "../relatedReferences.js";
import type * as savedSearches from "../savedSearches.js";
import type * as suggestedTags from "../suggestedTags.js";
import type * as tags from "../tags.js";
import type * as visualEnrichment from "../visualEnrichment.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  archiveSearch: typeof archiveSearch;
  boards: typeof boards;
  captureObservations: typeof captureObservations;
  captureSessions: typeof captureSessions;
  crons: typeof crons;
  enrichmentBatch: typeof enrichmentBatch;
  enrichmentJobs: typeof enrichmentJobs;
  http: typeof http;
  httpDb: typeof httpDb;
  "lib/assetQuality": typeof lib_assetQuality;
  "lib/captureSessions": typeof lib_captureSessions;
  "lib/compactVisual": typeof lib_compactVisual;
  "lib/drive": typeof lib_drive;
  "lib/enrichmentJobState": typeof lib_enrichmentJobState;
  "lib/imageAnalysis": typeof lib_imageAnalysis;
  "lib/linkIntake": typeof lib_linkIntake;
  "lib/linkMetadata": typeof lib_linkMetadata;
  "lib/perceptualHash": typeof lib_perceptualHash;
  "lib/platform": typeof lib_platform;
  "lib/privateAccess": typeof lib_privateAccess;
  "lib/referenceCatalog": typeof lib_referenceCatalog;
  "lib/referenceOrigin": typeof lib_referenceOrigin;
  "lib/relatedReferences": typeof lib_relatedReferences;
  "lib/reviewPreferences": typeof lib_reviewPreferences;
  "lib/searchDocument": typeof lib_searchDocument;
  "lib/searchIndex": typeof lib_searchIndex;
  "lib/searchMatches": typeof lib_searchMatches;
  "lib/searchSchema": typeof lib_searchSchema;
  "lib/sourceContext": typeof lib_sourceContext;
  "lib/sourceMetadata": typeof lib_sourceMetadata;
  "lib/suggestedTags": typeof lib_suggestedTags;
  "lib/tagCodec": typeof lib_tagCodec;
  "lib/tagIdentity": typeof lib_tagIdentity;
  "lib/tags": typeof lib_tags;
  "lib/urls": typeof lib_urls;
  "lib/visualMetadata": typeof lib_visualMetadata;
  "lib/visualValidation": typeof lib_visualValidation;
  mediaDerivatives: typeof mediaDerivatives;
  mediaDerivativesNode: typeof mediaDerivativesNode;
  metadataMigration: typeof metadataMigration;
  preferenceExport: typeof preferenceExport;
  projects: typeof projects;
  referenceOrigins: typeof referenceOrigins;
  references: typeof references;
  relatedReferences: typeof relatedReferences;
  savedSearches: typeof savedSearches;
  suggestedTags: typeof suggestedTags;
  tags: typeof tags;
  visualEnrichment: typeof visualEnrichment;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
