import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { detectPlatform } from "./lib/platform";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CaptureBody = {
  kind?: "image" | "post" | "page" | "video_frame" | "file";
  sourceUrl?: string;
  assetUrl?: string;
  pageTitle?: string;
  selectedText?: string;
  capturedAt?: string;
};

http.route({
  path: "/capture",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }),
});

http.route({
  path: "/capture",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: CaptureBody;

    try {
      body = (await request.json()) as CaptureBody;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const sourceUrl = cleanString(body.sourceUrl);
    const assetUrl = cleanString(body.assetUrl);
    const pageTitle = cleanString(body.pageTitle);
    const selectedText = cleanString(body.selectedText);

    if (!sourceUrl) {
      return jsonResponse({ ok: false, error: "sourceUrl is required" }, 400);
    }

    const capturedAt = parseCapturedAt(body.capturedAt);
    const kind = body.kind ?? (assetUrl ? "image" : "page");
    const platform = detectPlatform(sourceUrl);

    const referenceId = await ctx.db.insert("references", {
      kind,
      title: pageTitle,
      sourceUrl,
      platform,
      capturedAt,
      boardIds: [],
      tagIds: [],
      favorite: false,
      archived: false,
      deleted: false,
    });

    let assetId = null;

    if (assetUrl) {
      assetId = await ctx.db.insert("assets", {
        referenceId,
        originalUrl: assetUrl,
        dominantColors: [],
      });
    }

    await ctx.db.insert("sourceSnapshots", {
      referenceId,
      pageTitle,
      selectedText,
      jsonMetadata: JSON.stringify(body),
      createdAt: Date.now(),
    });

    return jsonResponse({ ok: true, referenceId, assetId }, 201);
  }),
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanString(value: unknown) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCapturedAt(value: unknown) {
  if (typeof value !== "string") return Date.now();

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export default http;
