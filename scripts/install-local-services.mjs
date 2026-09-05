#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") throw new Error("This installer is for Air Blue on macOS.");
if (root !== "/Users/leoli/Projects/ourchival") throw new Error("Use Air Blue's canonical checkout.");
if (!/^(20|22|24)\./.test(process.versions.node)) throw new Error("Run this installer with Node 22.");
const state = join(root, ".convex", "services");
const agents = join(homedir(), "Library", "LaunchAgents");
await mkdir(state, { recursive: true, mode: 0o700 });
await mkdir(agents, { recursive: true });
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
for (const job of [
  { label: "com.ourchival.local-vault", args: [process.execPath, join(root, "scripts/local-vault.mjs"), "dev"], extra: "<key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>" },
  { label: "com.ourchival.drive-backup", args: ["/usr/bin/python3", join(root, "scripts/vault_backup.py")], extra: "<key>StartInterval</key><integer>3600</integer><key>LowPriorityIO</key><true/><key>Nice</key><integer>10</integer>" },
]) {
  const path = join(agents, job.label + ".plist");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${job.label}</string>
<key>ProgramArguments</key><array>${job.args.map((arg) => `<string>${escape(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(dirname(process.execPath) + ":" + process.env.PATH)}</string><key>NEXT_TELEMETRY_DISABLED</key><string>1</string></dict>
<key>RunAtLoad</key><true/>${job.extra}
<key>StandardOutPath</key><string>${escape(join(state, job.label + ".log"))}</string>
<key>StandardErrorPath</key><string>${escape(join(state, job.label + ".log"))}</string>
</dict></plist>\n`;
  await writeFile(path, xml, { mode: 0o600 });
  const domain = `gui/${process.getuid()}`;
  const existing = spawnSync("launchctl", ["print", `${domain}/${job.label}`], { stdio: "ignore" });
  if (existing.status === 0) spawnSync("launchctl", ["bootout", `${domain}/${job.label}`], { stdio: "ignore" });
  const result = spawnSync("launchctl", ["bootstrap", domain, path], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not install ${job.label}`);
  console.log(`Installed ${job.label}`);
}
