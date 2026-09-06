import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// Run from the canonical checkout. Credentials stay in memory on this Mac.
const config = JSON.parse(
  await readFile(".convex/local/default/config.json", "utf8"),
);
const client = new ConvexHttpClient("http://127.0.0.1:3210");
client.setAdminAuth(config.adminKey);
await mkdir(".convex/reconciliation", { recursive: true });
const receipt = ".convex/reconciliation/browse-lanes.json";
let state = { cursor: null, done: false, observed: 0, changed: 0, links: 0 };
try {
  state = JSON.parse(await readFile(receipt, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
while (!state.done) {
  const page = await client.mutation(
    makeFunctionReference("browseMigration:backfill"),
    { cursor: state.cursor },
  );
  state = {
    cursor: page.cursor,
    done: page.done,
    observed: state.observed + page.observed,
    changed: state.changed + page.changed,
    links: state.links + page.links,
  };
  const pending = `${receipt}.${process.pid}.tmp`;
  await writeFile(pending, JSON.stringify(state), { mode: 0o600 });
  await rename(pending, receipt);
}
console.log(JSON.stringify({ ...state, cursor: undefined }));
