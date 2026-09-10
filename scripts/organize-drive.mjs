#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  appendFile,
  open,
  unlink,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
const directory = new URL(
  "../.convex/reconciliation/drive-organization/",
  import.meta.url,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const client = new ConvexHttpClient("http://127.0.0.1:3210", { logger: false });
const accessKey = (
  await readFile(new URL("../.convex/local-owner-key", import.meta.url), "utf8")
).trim();
const command = process.argv[2];
async function setLocalEnv(name, value) {
  const config = JSON.parse(
    await readFile(
      new URL("../.convex/local/default/config.json", import.meta.url),
      "utf8",
    ),
  );
  const envPath = new URL(`local-env-${process.pid}`, directory);
  await writeFile(
    envPath,
    `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "convex",
        "env",
        "set",
        name,
        value,
        "--env-file",
        envPath.pathname,
      ],
      { stdio: "pipe" },
    );
    if (result.status !== 0)
      throw new Error(
        "Could not activate local folder routing: " +
          String(result.stderr).replaceAll(config.adminKey, "[redacted]"),
      );
  } finally {
    await unlink(envPath);
  }
}
const lockPath = new URL("run.lock", directory);
const lock = await open(lockPath, "wx", 0o600);
try {
  if (command === "setup" || command === "activate") {
    const map =
      command === "activate"
        ? JSON.parse(await readFile(new URL("folders.json", directory), "utf8"))
        : await client.action("driveOrganization:setup", { accessKey });
    await writeFile(
      new URL("folders.json", directory),
      JSON.stringify(map, null, 2),
      { mode: 0o600 },
    );
    await setLocalEnv("GOOGLE_DRIVE_FOLDER_MAP", JSON.stringify(map));
    await setLocalEnv(
      "OURCHIVAL_OWN_SOURCE_PREFIXES",
      JSON.stringify([
        "https://x.com/teamleaderleo/",
        "https://twitter.com/teamleaderleo/",
      ]),
    );
    console.log(
      JSON.stringify({
        folders: Object.keys(map.folders).length,
        root: map.root,
        routing: "enabled",
      }),
    );
  } else if (command === "audit") {
    let cursor = null,
      done = false;
    const items = [];
    while (!done) {
      const page = await client.query("driveOrganization:rootPointers", {
        accessKey,
        paginationOpts: { cursor, numItems: 500 },
      });
      items.push(...page.items);
      cursor = page.cursor;
      done = page.done;
    }
    await writeFile(
      new URL("root-pointers.json", directory),
      JSON.stringify(items),
      { mode: 0o600 },
    );
    const ids = [...new Set(items.map((i) => i.fileId))];
    let repaired = 0;
    const unresolved = [];
    for (let start = 0; start < ids.length; start += 100) {
      const result = await client.action("driveOrganization:repairPointers", {
        accessKey,
        ids: ids.slice(start, start + 100),
      });
      repaired += result.repaired;
      unresolved.push(...result.unresolved);
    }
    await writeFile(
      new URL("pointer-audit.json", directory),
      JSON.stringify({ checked: ids.length, repaired, unresolved }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        catalogRowsPointingAtRoot: items.length,
        repaired,
        unresolved: unresolved.length,
      }),
    );
  } else if (command === "run") {
    const limit = Number(process.argv[3] ?? 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Use 1–1000 batches");
    let moved = 0;
    let failureStreak = 0;
    let completed = false;
    for (let i = 0; i < limit; i++) {
      let result;
      for(let attempt=0;attempt<3;attempt++) {
        try { result=await client.action("driveOrganization:batch",{accessKey}); break; }
        catch(error) {
          if(attempt===2 || !/timed out|signal has been aborted|Drive HTTP (429|50[0234])/i.test(String(error?.message))) throw error;
          await appendFile(new URL('retries.jsonl',directory),JSON.stringify({at:new Date().toISOString(),attempt:attempt+1,reason:'Transient timeout or service error; re-list root before retry'})+'\n',{mode:0o600});
          await new Promise(resolve=>setTimeout(resolve,10000));
        }
      }
      moved += result.moved;
      await appendFile(
        new URL("moves.jsonl", directory),
        JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n",
        { mode: 0o600 },
      );
      await writeFile(
        new URL("status.json", directory),
        JSON.stringify({
          at: new Date().toISOString(),
          batches: i + 1,
          moved,
          done: result.done,
          pendingFailures: result.failures?.length ?? 0,
        }),
        { mode: 0o600 },
      );
      if (result.done) {
        completed = true;
        console.log(JSON.stringify({ moved, done: true }));
        break;
      }
      if (result.failures?.length) {
        failureStreak++;
        console.log(
          JSON.stringify({
            retry: failureStreak,
            pending: result.failures.length,
            statuses: result.statuses,
          }),
        );
        if (failureStreak >= 3)
          throw new Error(
            "Three partial batches; pending file IDs and HTTP outcomes are saved in moves.jsonl.",
          );
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else failureStreak = 0;
      if ((i + 1) % 10 === 0)
        console.log(JSON.stringify({ batches: i + 1, moved }));
    }
    if (!completed) console.log(JSON.stringify({moved,done:false,status:"Batch limit reached; run again to continue"}));
  } else throw new Error("Use setup or run [batches]");
} catch (error) {
  const message = String(error?.message ?? "Unknown failure").replaceAll(
    accessKey,
    "[redacted]",
  );
  await writeFile(new URL("error.txt", directory), message, { mode: 0o600 });
  await appendFile(new URL("errors.jsonl", directory), JSON.stringify({at:new Date().toISOString(),message})+"\n", {mode:0o600});
  console.error(
    "Drive organization stopped. Completed moves are preserved; check the local receipt before resuming.",
  );
  process.exitCode = 1;
} finally {
  await lock.close();
  await unlink(lockPath);
}
