/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as archiveDiscovery from "../archiveDiscovery.js";
import type * as archiveSearch from "../archiveSearch.js";
import type * as artworkAutoLink from "../artworkAutoLink.js";
import type * as artworkDriveRepresentationNode from "../artworkDriveRepresentationNode.js";
import type * as artworkIntake from "../artworkIntake.js";
import type * as artworkPublicationIntake from "../artworkPublicationIntake.js";
import type * as artworkReviewQueue from "../artworkReviewQueue.js";
import type * as artworks from "../artworks.js";
import type * as boards from "../boards.js";
import type * as browseMigration from "../browseMigration.js";
import type * as captureObservations from "../captureObservations.js";
import type * as captureSessions from "../captureSessions.js";
import type * as communityTags from "../communityTags.js";
import type * as crons from "../crons.js";
import type * as driveDerivatives from "../driveDerivatives.js";
import type * as driveDerivativesNode from "../driveDerivativesNode.js";
import type * as driveOrganization from "../driveOrganization.js";
import type * as enrichmentBatch from "../enrichmentBatch.js";
import type * as enrichmentJobs from "../enrichmentJobs.js";
import type * as http from "../http.js";
import type * as httpDb from "../httpDb.js";
import type * as lib_archiveOrder from "../lib/archiveOrder.js";
import type * as lib_artworkSchema from "../lib/artworkSchema.js";
import type * as lib_assetQuality from "../lib/assetQuality.js";
import type * as lib_captureSessions from "../lib/captureSessions.js";
import type * as lib_communityMetadata from "../lib/communityMetadata.js";
import type * as lib_communitySchema from "../lib/communitySchema.js";
import type * as lib_compactVisual from "../lib/compactVisual.js";
import type * as lib_discoveryIndex from "../lib/discoveryIndex.js";
import type * as lib_discoveryPage from "../lib/discoveryPage.js";
import type * as lib_discoverySchema from "../lib/discoverySchema.js";
import type * as lib_drive from "../lib/drive.js";
import type * as lib_driveBatch from "../lib/driveBatch.js";
import type * as lib_driveOrganization from "../lib/driveOrganization.js";
import type * as lib_enrichmentJobState from "../lib/enrichmentJobState.js";
import type * as lib_imageAnalysis from "../lib/imageAnalysis.js";
import type * as lib_linkIntake from "../lib/linkIntake.js";
import type * as lib_linkMetadata from "../lib/linkMetadata.js";
import type * as lib_missingWorkSchema from "../lib/missingWorkSchema.js";
import type * as lib_perceptualHash from "../lib/perceptualHash.js";
import type * as lib_platform from "../lib/platform.js";
import type * as lib_previewEncoding from "../lib/previewEncoding.js";
import type * as lib_privateAccess from "../lib/privateAccess.js";
import type * as lib_referenceCatalog from "../lib/referenceCatalog.js";
import type * as lib_referenceOrigin from "../lib/referenceOrigin.js";
import type * as lib_relatedReferences from "../lib/relatedReferences.js";
import type * as lib_researchLinks from "../lib/researchLinks.js";
import type * as lib_reviewPreferences from "../lib/reviewPreferences.js";
import type * as lib_searchDocument from "../lib/searchDocument.js";
import type * as lib_searchIndex from "../lib/searchIndex.js";
import type * as lib_searchMatches from "../lib/searchMatches.js";
import type * as lib_searchSchema from "../lib/searchSchema.js";
import type * as lib_sourceContext from "../lib/sourceContext.js";
import type * as lib_sourceMetadata from "../lib/sourceMetadata.js";
import type * as lib_storageDigest from "../lib/storageDigest.js";
import type * as lib_suggestedTags from "../lib/suggestedTags.js";
import type * as lib_tagCodec from "../lib/tagCodec.js";
import type * as lib_tagIdentity from "../lib/tagIdentity.js";
import type * as lib_tagSetCodec from "../lib/tagSetCodec.js";
import type * as lib_tags from "../lib/tags.js";
import type * as lib_urls from "../lib/urls.js";
import type * as lib_visualMetadata from "../lib/visualMetadata.js";
import type * as lib_visualValidation from "../lib/visualValidation.js";
import type * as mediaDerivatives from "../mediaDerivatives.js";
import type * as mediaDerivativesNode from "../mediaDerivativesNode.js";
import type * as metadataMigration from "../metadataMigration.js";
import type * as missingWorks from "../missingWorks.js";
import type * as preferenceExport from "../preferenceExport.js";
import type * as previewMigration from "../previewMigration.js";
import type * as projects from "../projects.js";
import type * as referenceOrigins from "../referenceOrigins.js";
import type * as references from "../references.js";
import type * as relatedReferences from "../relatedReferences.js";
import type * as retention from "../retention.js";
import type * as savedSearches from "../savedSearches.js";
import type * as suggestedTags from "../suggestedTags.js";
import type * as tagPayloadMigration from "../tagPayloadMigration.js";
import type * as tags from "../tags.js";
import type * as visualEnrichment from "../visualEnrichment.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  archiveDiscovery: typeof archiveDiscovery;
  archiveSearch: typeof archiveSearch;
  artworkAutoLink: typeof artworkAutoLink;
  artworkDriveRepresentationNode: typeof artworkDriveRepresentationNode;
  artworkIntake: typeof artworkIntake;
  artworkPublicationIntake: typeof artworkPublicationIntake;
  artworkReviewQueue: typeof artworkReviewQueue;
  artworks: typeof artworks;
  boards: typeof boards;
  browseMigration: typeof browseMigration;
  captureObservations: typeof captureObservations;
  captureSessions: typeof captureSessions;
  communityTags: typeof communityTags;
  crons: typeof crons;
  driveDerivatives: typeof driveDerivatives;
  driveDerivativesNode: typeof driveDerivativesNode;
  driveOrganization: typeof driveOrganization;
  enrichmentBatch: typeof enrichmentBatch;
  enrichmentJobs: typeof enrichmentJobs;
  http: typeof http;
  httpDb: typeof httpDb;
  "lib/archiveOrder": typeof lib_archiveOrder;
  "lib/artworkSchema": typeof lib_artworkSchema;
  "lib/assetQuality": typeof lib_assetQuality;
  "lib/captureSessions": typeof lib_captureSessions;
  "lib/communityMetadata": typeof lib_communityMetadata;
  "lib/communitySchema": typeof lib_communitySchema;
  "lib/compactVisual": typeof lib_compactVisual;
  "lib/discoveryIndex": typeof lib_discoveryIndex;
  "lib/discoveryPage": typeof lib_discoveryPage;
  "lib/discoverySchema": typeof lib_discoverySchema;
  "lib/drive": typeof lib_drive;
  "lib/driveBatch": typeof lib_driveBatch;
  "lib/driveOrganization": typeof lib_driveOrganization;
  "lib/enrichmentJobState": typeof lib_enrichmentJobState;
  "lib/imageAnalysis": typeof lib_imageAnalysis;
  "lib/linkIntake": typeof lib_linkIntake;
  "lib/linkMetadata": typeof lib_linkMetadata;
  "lib/missingWorkSchema": typeof lib_missingWorkSchema;
  "lib/perceptualHash": typeof lib_perceptualHash;
  "lib/platform": typeof lib_platform;
  "lib/previewEncoding": typeof lib_previewEncoding;
  "lib/privateAccess": typeof lib_privateAccess;
  "lib/referenceCatalog": typeof lib_referenceCatalog;
  "lib/referenceOrigin": typeof lib_referenceOrigin;
  "lib/relatedReferences": typeof lib_relatedReferences;
  "lib/researchLinks": typeof lib_researchLinks;
  "lib/reviewPreferences": typeof lib_reviewPreferences;
  "lib/searchDocument": typeof lib_searchDocument;
  "lib/searchIndex": typeof lib_searchIndex;
  "lib/searchMatches": typeof lib_searchMatches;
  "lib/searchSchema": typeof lib_searchSchema;
  "lib/sourceContext": typeof lib_sourceContext;
  "lib/sourceMetadata": typeof lib_sourceMetadata;
  "lib/storageDigest": typeof lib_storageDigest;
  "lib/suggestedTags": typeof lib_suggestedTags;
  "lib/tagCodec": typeof lib_tagCodec;
  "lib/tagIdentity": typeof lib_tagIdentity;
  "lib/tagSetCodec": typeof lib_tagSetCodec;
  "lib/tags": typeof lib_tags;
  "lib/urls": typeof lib_urls;
  "lib/visualMetadata": typeof lib_visualMetadata;
  "lib/visualValidation": typeof lib_visualValidation;
  mediaDerivatives: typeof mediaDerivatives;
  mediaDerivativesNode: typeof mediaDerivativesNode;
  metadataMigration: typeof metadataMigration;
  missingWorks: typeof missingWorks;
  preferenceExport: typeof preferenceExport;
  previewMigration: typeof previewMigration;
  projects: typeof projects;
  referenceOrigins: typeof referenceOrigins;
  references: typeof references;
  relatedReferences: typeof relatedReferences;
  retention: typeof retention;
  savedSearches: typeof savedSearches;
  suggestedTags: typeof suggestedTags;
  tagPayloadMigration: typeof tagPayloadMigration;
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
