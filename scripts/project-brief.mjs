#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";

// Read-only, bounded project receipts for local planning. Never emit the owner key.
const projectId = process.argv[2];
if (projectId === "--help") {
  console.log(
    "node scripts/project-brief.mjs [PROJECT_ID [CURSOR]]\nWithout an ID: list projects. With an ID: export up to 96 references; isDone/continueCursor report remaining pages.",
  );
} else {
  try {
    const accessKey = (
      await readFile(
        fileURLToPath(new URL("../.convex/local-owner-key", import.meta.url)),
        "utf8",
      )
    ).trim();
    const client = new ConvexHttpClient("http://127.0.0.1:3210", {
      logger: false,
    });
    const result = projectId
      ? await client.query("projects:listReferences", {
          accessKey,
          projectId,
          paginationOpts: { numItems: 96, cursor: process.argv[3] ?? null },
        })
      : await client.query("projects:list", { accessKey });
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error(
      "Could not read the project brief. Check that the local vault is running and that the project ID and cursor are valid.",
    );
    process.exitCode = 1;
  }
}
