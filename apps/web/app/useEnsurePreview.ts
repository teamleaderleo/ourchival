"use client";
import { useEffect } from "react";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { withOwnerAccess } from "./privateAccess";
import type { ReferenceAsset } from "./referenceVaultModel";

const ensure = makeFunctionReference<"mutation", { accessKey: string; assetId: string }, string>("mediaDerivatives:ensurePreview");
let client: ConvexHttpClient | undefined;

export function useEnsurePreview(asset: ReferenceAsset | undefined, visible: boolean) {
  const id = asset?._id;
  const missing = !asset?.thumbUrl && !asset?.previewUrl;
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!visible || !missing || !id || !url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function request() {
      try {
        client ??= new ConvexHttpClient(url!);
        const result = await client.mutation(ensure, withOwnerAccess({ assetId: id! }));
        if (!stopped && result === "busy" && ++attempts < 4) timer = setTimeout(request, 30_000);
      } catch { /* Existing preview state and owner-access UI provide recovery. */ }
    }
    void request();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [id, missing, visible]);
}
