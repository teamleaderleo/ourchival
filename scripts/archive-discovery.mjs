#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";

const mode = process.argv[2] || "status";
if (!["status", "start"].includes(mode)) throw new Error("Use: node scripts/archive-discovery.mjs [status|start]");
const accessKey = (await readFile(new URL("../.convex/local-owner-key", import.meta.url), "utf8")).trim();
const client = new ConvexHttpClient("http://127.0.0.1:3210", { logger: false });
if (mode === "start") await client.mutation("archiveDiscovery:ensure", { accessKey });
const result = await client.query("archiveDiscovery:list", { accessKey, revealSensitive: true });
const receipt = { checkedAt: new Date().toISOString(), scope: "Active references excluding My Art; all sensitivities", ...result };
if (result.ready) {
  const directory = new URL("../.convex/reconciliation/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const temporary = new URL("archive-discovery.tmp", directory);
  await writeFile(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  await rename(temporary, new URL("archive-discovery.json", directory));
}
console.log(JSON.stringify({ ready: result.ready, scanned: result.scanned, artists: result.artists.slice(0,3), tags: result.tags.slice(0,3) }, null, 2));
