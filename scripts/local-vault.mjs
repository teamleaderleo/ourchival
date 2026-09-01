#!/usr/bin/env node

import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnvPath = join(projectRoot, ".env.local-vault.local");
const localKeyPath = join(projectRoot, ".convex", "local-owner-key");
const localWebUrl = "http://127.0.0.1:3000";
const defaultConvexUrl = "http://127.0.0.1:3210";
const defaultConvexSiteUrl = "http://127.0.0.1:3211";

export function isSupportedNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return major === 20 || major === 22 || major === 24;
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*?)(?:\s+#.*)?$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

export function parseProjectIdentity(text) {
  const match = /#\s*team:\s*([^,\s]+),\s*project:\s*([^\s]+)/.exec(text);
  return match ? { team: match[1], project: match[2] } : undefined;
}

async function main() {
  await reexecWithSupportedNodeIfNeeded();
  const command = process.argv[2] ?? "dev";
  if (command === "setup") return await setup();
  if (command === "drive") return await syncDriveConfiguration();
  if (command === "dev") return await dev();
  if (command === "status") return await status();
  throw new Error(`Unknown local vault command: ${command}`);
}

async function reexecWithSupportedNodeIfNeeded() {
  if (isSupportedNodeVersion()) return;
  const candidate = await findSupportedNode();
  if (!candidate) {
    throw new Error(
      `Node ${process.versions.node} cannot run Convex local actions. Install Node 22, then run pnpm local:vault again.`,
    );
  }
  const result = spawnSync(
    candidate,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: `${dirname(candidate)}:${process.env.PATH ?? ""}`,
        OURCHIVAL_LOCAL_NODE_REEXEC: "1",
      },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

async function findSupportedNode() {
  const versionsRoot = join(homedir(), ".nvm", "versions", "node");
  let entries = [];
  try {
    entries = await readdir(versionsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter(
      (entry) => entry.isDirectory() && /^v(?:20|22|24)\./.test(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      path: join(versionsRoot, entry.name, "bin", "node"),
    }))
    .sort((left, right) =>
      right.name.localeCompare(left.name, undefined, { numeric: true }),
    );
  return candidates[0]?.path;
}

async function setup() {
  await mkdir(join(projectRoot, ".convex"), { recursive: true });
  await ensureLocalOwnerKey();
  const existingLocalEnv = await readOptional(localEnvPath);
  if (!existingLocalEnv.includes("CONVEX_DEPLOYMENT=local:")) {
    const identity = await resolveProjectIdentity();
    if (!identity) {
      throw new Error(
        "Could not infer the Convex team/project. Set OURCHIVAL_CONVEX_TEAM and OURCHIVAL_CONVEX_PROJECT, then retry.",
      );
    }
    const cloudEnvPath = join(projectRoot, ".env.local");
    const cloudEnv = await snapshotFile(cloudEnvPath);
    try {
      await run("pnpm", [
        "exec",
        "convex",
        "dev",
        "--configure",
        "existing",
        "--team",
        identity.team,
        "--project",
        identity.project,
        "--dev-deployment",
        "local",
        "--once",
        "--tail-logs",
        "disable",
      ]);
      const generated = parseEnv(await readFile(cloudEnvPath, "utf8"));
      const deployment = generated.CONVEX_DEPLOYMENT;
      const clientUrl =
        generated.NEXT_PUBLIC_CONVEX_URL ?? generated.CONVEX_URL;
      const siteUrl =
        generated.NEXT_PUBLIC_CONVEX_SITE_URL ?? generated.CONVEX_SITE_URL;
      if (!deployment?.startsWith("local:") || !clientUrl || !siteUrl) {
        throw new Error(
          "Convex did not produce a complete local deployment configuration.",
        );
      }
      await writeFile(
        localEnvPath,
        `CONVEX_DEPLOYMENT=${deployment}\nCONVEX_URL=${clientUrl}\nCONVEX_SITE_URL=${siteUrl}\n`,
        { mode: 0o600 },
      );
      await chmod(localEnvPath, 0o600);
    } finally {
      await restoreFile(cloudEnvPath, cloudEnv);
    }
  }

  console.log(
    "Local vault configured. Credentials remain in .convex/ and are not printed.",
  );
}

async function dev() {
  await setup();
  const localEnv = parseEnv(await readFile(localEnvPath, "utf8"));
  const convexUrl = localEnv.CONVEX_URL ?? defaultConvexUrl;
  const convexSiteUrl = localEnv.CONVEX_SITE_URL ?? defaultConvexSiteUrl;
  const cloudEnvPath = join(projectRoot, ".env.local");
  const cloudEnv = await snapshotFile(cloudEnvPath);
  await assertPortAvailable(3000);

  const children = [];
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", stop);

  children.push(
    spawn("pnpm", ["exec", "convex", "dev", "--tail-logs", "disable"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CONVEX_DEPLOYMENT: localEnv.CONVEX_DEPLOYMENT,
      },
      stdio: "inherit",
    }),
  );
  try {
    await waitFor(`${convexSiteUrl}/auth-check`, [401, 503]);
  } finally {
    await restoreFile(cloudEnvPath, cloudEnv);
  }

  const key = await readFile(localKeyPath, "utf8");
  await run(
    "pnpm",
    [
      "exec",
      "convex",
      "env",
      "set",
      "--deployment",
      "local",
      "OURCHIVAL_OWNER_ACCESS_KEY",
    ],
    {
      input: key,
      env: {
        ...process.env,
        CONVEX_DEPLOYMENT: localEnv.CONVEX_DEPLOYMENT,
      },
    },
  );
  await restoreFile(cloudEnvPath, cloudEnv);

  children.push(
    spawn(
      "pnpm",
      [
        "--filter",
        "@ourchival/web",
        "exec",
        "next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3000",
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NEXT_PUBLIC_CONVEX_URL: convexUrl,
          NEXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
          NEXT_PUBLIC_OURCHIVAL_APP_URL: localWebUrl,
        },
        stdio: "inherit",
      },
    ),
  );
  await waitFor(localWebUrl, [200]);
  console.log(`Local Ourchival ready: ${localWebUrl}`);
  console.log(`Clipper address: ${convexSiteUrl}`);

  await new Promise((resolvePromise, rejectPromise) => {
    for (const child of children) {
      child.once("error", rejectPromise);
      child.once("exit", (code, signal) => {
        const expectedStop =
          stopping || code === 0 || signal === "SIGINT" || signal === "SIGTERM";
        stop();
        if (expectedStop) resolvePromise();
        else
          rejectPromise(
            new Error(`Local vault process exited with ${code ?? signal}.`),
          );
      });
    }
  });
}

async function status() {
  const localEnv = parseEnv(await readOptional(localEnvPath));
  const convexSiteUrl = localEnv.CONVEX_SITE_URL ?? defaultConvexSiteUrl;
  const results = await Promise.all([
    check("vault", localWebUrl, [200]),
    check("catalog", convexSiteUrl, [404]),
    check("auth", `${convexSiteUrl}/auth-check`, [401]),
  ]);
  for (const result of results) {
    console.log(
      `${result.ok ? "ready" : "down"}\t${result.name}\t${result.status ?? result.error}`,
    );
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

async function syncDriveConfiguration() {
  await setup();
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ];
  const optional = ["GOOGLE_DRIVE_PARENT_FOLDER_ID"];
  let copied = 0;

  for (const name of [...required, ...optional]) {
    const value = (
      await capture("pnpm", ["exec", "convex", "env", "get", name])
    ).trim();
    if (!value) {
      if (required.includes(name)) {
        throw new Error(
          `Cloud Convex is missing required Drive setting ${name}.`,
        );
      }
      continue;
    }
    await run(
      "pnpm",
      ["exec", "convex", "env", "set", "--deployment", "local", name],
      { input: `${value}\n`, quiet: true },
    );
    copied += 1;
  }

  console.log(
    `Copied ${copied} Google Drive settings into the local vault without printing credentials.`,
  );
}

async function resolveProjectIdentity() {
  const fromEnvironment =
    process.env.OURCHIVAL_CONVEX_TEAM && process.env.OURCHIVAL_CONVEX_PROJECT
      ? {
          team: process.env.OURCHIVAL_CONVEX_TEAM,
          project: process.env.OURCHIVAL_CONVEX_PROJECT,
        }
      : undefined;
  if (fromEnvironment) return fromEnvironment;
  return parseProjectIdentity(
    await readOptional(join(projectRoot, ".env.local")),
  );
}

async function ensureLocalOwnerKey() {
  try {
    const existing = (await readFile(localKeyPath, "utf8")).trim();
    if (existing) return;
  } catch {
    // Generate the local-only key below.
  }
  await writeFile(localKeyPath, `${randomBytes(32).toString("hex")}\n`, {
    mode: 0o600,
  });
  await chmod(localKeyPath, 0o600);
}

async function run(
  command,
  args,
  { input, env = process.env, quiet = false } = {},
) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: [
        input ? "pipe" : "inherit",
        quiet ? "ignore" : "inherit",
        "inherit",
      ],
    });
    if (input) child.stdin.end(input);
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function capture(command, args, { env = process.env } = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(stdout);
      else {
        rejectPromise(
          new Error(
            `${command} exited with code ${code}${
              stderr.trim() ? `: ${stderr.trim().slice(0, 240)}` : "."
            }`,
          ),
        );
      }
    });
  });
}

async function waitFor(url, acceptedStatuses, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check("service", url, acceptedStatuses);
    if (result.ok) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function check(name, url, acceptedStatuses) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return {
      name,
      status: response.status,
      ok: acceptedStatuses.includes(response.status),
    };
  } catch (error) {
    return {
      name,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", () =>
      rejectPromise(new Error(`Port ${port} is already in use.`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function snapshotFile(path) {
  try {
    const [contents, metadata] = await Promise.all([
      readFile(path),
      stat(path),
    ]);
    return { contents, mode: metadata.mode & 0o777 };
  } catch {
    return undefined;
  }
}

async function restoreFile(path, snapshot) {
  if (!snapshot) {
    await unlink(path).catch(() => undefined);
    return;
  }
  await writeFile(path, snapshot.contents, { mode: snapshot.mode });
  await chmod(path, snapshot.mode);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
