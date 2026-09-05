import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Platform = "x" | "pinterest" | "pixiv" | "discord" | "manual" | "generic";

type Origin = {
  platform: Platform;
  containerType: string;
  containerKey: string;
  containerUrl?: string;
  containerName?: string;
  providerItemId: string;
  ordinal?: number;
  jsonMetadata?: string;
};

export function referenceOriginFromRawMetadata(
  value: unknown,
): Origin | undefined {
  const raw = jsonObject(value);
  const source = jsonObject(raw?.source);
  const provenance = jsonObject(source?.provenance ?? raw?.provenance);
  const platform = platformValue(provenance?.platform);
  const containerType = shortString(provenance?.containerType, 80);
  const containerKey = shortString(provenance?.containerKey, 300);
  const providerItemId = shortString(raw?.providerId, 300);
  if (!platform || !containerType || !containerKey || !providerItemId) {
    return undefined;
  }

  const containerUrl = publicUrl(provenance?.containerUrl);
  const containerName = shortString(provenance?.containerName, 300);
  const ordinal = nonNegativeInteger(raw?.ordinal);
  return {
    platform,
    containerType,
    containerKey,
    providerItemId,
    ...(containerUrl ? { containerUrl } : {}),
    ...(containerName ? { containerName } : {}),
    ...(ordinal !== undefined ? { ordinal } : {}),
    jsonMetadata: JSON.stringify(provenance),
  };
}

export async function recordReferenceOrigin(
  ctx: MutationCtx,
  args: {
    referenceId: Id<"references">;
    rawMetadata: unknown;
    captureSessionId?: string;
    observedAt: number;
  },
) {
  const origin = referenceOriginFromRawMetadata(args.rawMetadata);
  if (!origin) return null;

  const existing = await ctx.db
    .query("referenceOrigins")
    .withIndex("by_platform_and_container_key_and_provider_item_id", (q) =>
      q
        .eq("platform", origin.platform)
        .eq("containerKey", origin.containerKey)
        .eq("providerItemId", origin.providerItemId),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      referenceId: args.referenceId,
      lastObservedAt: args.observedAt,
      ...(origin.containerUrl ? { containerUrl: origin.containerUrl } : {}),
      ...(origin.containerName ? { containerName: origin.containerName } : {}),
      ...(args.captureSessionId
        ? { captureSessionId: args.captureSessionId }
        : {}),
      ...(origin.ordinal !== undefined ? { ordinal: origin.ordinal } : {}),
      ...(origin.jsonMetadata ? { jsonMetadata: origin.jsonMetadata } : {}),
    });
    return existing._id;
  }

  return await ctx.db.insert("referenceOrigins", {
    referenceId: args.referenceId,
    platform: origin.platform,
    containerType: origin.containerType,
    containerKey: origin.containerKey,
    ...(origin.containerUrl ? { containerUrl: origin.containerUrl } : {}),
    ...(origin.containerName ? { containerName: origin.containerName } : {}),
    providerItemId: origin.providerItemId,
    ...(args.captureSessionId
      ? { captureSessionId: args.captureSessionId }
      : {}),
    firstObservedAt: args.observedAt,
    lastObservedAt: args.observedAt,
    ...(origin.ordinal !== undefined ? { ordinal: origin.ordinal } : {}),
    ...(origin.jsonMetadata ? { jsonMetadata: origin.jsonMetadata } : {}),
  });
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shortString(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function publicUrl(value: unknown) {
  const text = shortString(value, 2_000);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function platformValue(value: unknown): Platform | undefined {
  return value === "x" ||
    value === "pinterest" ||
    value === "pixiv" ||
    value === "discord" ||
    value === "manual" ||
    value === "generic"
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
