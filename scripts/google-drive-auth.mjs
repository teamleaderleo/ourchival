#!/usr/bin/env node

import http from "node:http";
import { URL } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";
import process from "node:process";

const port = Number(process.env.OURCHIVAL_GOOGLE_AUTH_PORT ?? 53682);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const startUri = `http://127.0.0.1:${port}/start`;
const scope = "https://www.googleapis.com/auth/drive.file";
const useConvexCredentials =
  process.env.OURCHIVAL_GOOGLE_AUTH_USE_CONVEX === "1" || Boolean(process.env.OURCHIVAL_GOOGLE_AUTH_ENV_FILE);
const envFile = process.env.OURCHIVAL_GOOGLE_AUTH_ENV_FILE;
const execFileAsync = promisify(execFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  const clientId = useConvexCredentials
    ? await readConvexEnv("GOOGLE_CLIENT_ID")
    : await ask("Google OAuth client ID: ");
  const clientSecret = useConvexCredentials
    ? await readConvexEnv("GOOGLE_CLIENT_SECRET")
    : await ask("Google OAuth client secret: ");

  const code = await listenForCode(clientId);
  const tokenResponse = await exchangeCode({ clientId, clientSecret, code });

  if (useConvexCredentials) {
    await setConvexEnv(
      "GOOGLE_REFRESH_TOKEN",
      tokenResponse.refresh_token,
      false,
    );
    if (envFile) {
      console.log("\nSuccess. Updated Google Drive authorization for the selected local vault only.\n");
      return;
    }
    await setConvexEnv(
      "GOOGLE_REFRESH_TOKEN",
      tokenResponse.refresh_token,
      true,
    );
    console.log(
      "\nSuccess. Updated the Google Drive credential in Convex development and production.\n",
    );
    return;
  }

  console.log(
    "\nSuccess. The refresh token was generated but was not printed.",
  );
  console.log(
    "To update Convex without exposing credentials, rerun with OURCHIVAL_GOOGLE_AUTH_USE_CONVEX=1.\n",
  );
}

async function ask(question) {
  const answer = await rl.question(question);
  const trimmed = answer.trim();

  if (!trimmed) {
    console.error("Missing value.");
    process.exit(1);
  }

  return trimmed;
}

function listenForCode(clientId) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomUUID();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", redirectUri);

        if (requestUrl.pathname === "/start") {
          response.writeHead(302, { Location: authUrl.toString() });
          response.end();
          return;
        }

        if (requestUrl.pathname !== "/oauth2callback") {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end(`Google OAuth failed: ${error}`);
          reject(new Error(error));
          server.close();
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code || requestUrl.searchParams.get("state") !== state) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Missing code or invalid OAuth state");
          return;
        }

        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(
          "<h1>Google approval received.</h1><p>Return to Ourchival while the connection is verified and saved. You can close this tab.</p>",
        );
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`\nOpening Google OAuth in your browser…\n${startUri}\n`);
      openBrowser(startUri);
    });
  });
}

async function readConvexEnv(name) {
  const { stdout } = await execFileAsync(
    "corepack",
    ["pnpm", "exec", "convex", "env", "get", name, ...(envFile ? ["--env-file", envFile] : [])],
    { cwd: process.cwd() },
  );
  const value = stdout.trim();
  if (!value) throw new Error(`Convex ${name} is not configured.`);
  return value;
}

function setConvexEnv(name, value, production) {
  return new Promise((resolve, reject) => {
    const args = [
      "pnpm",
      "exec",
      "convex",
      "env",
      "set",
      ...(production ? ["--prod"] : []),
      ...(envFile ? ["--env-file", envFile] : []),
      name,
    ];
    const child = spawn("corepack", args, {
      cwd: process.cwd(),
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not update Convex ${name}.`));
    });
    child.stdin.end(`${value}\n`);
  });
}

async function exchangeCode({ clientId, clientSecret, code }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const body = await response.json();

  if (!response.ok || !body.refresh_token) {
    const errorCode =
      typeof body.error === "string" ? body.error : "missing_refresh_token";
    const errorDescription =
      typeof body.error_description === "string"
        ? body.error_description
        : undefined;
    console.error(
      `Google token exchange failed (${response.status}, ${errorCode})${
        errorDescription ? `: ${errorDescription}` : "."
      }`,
    );
    throw new Error(
      "Google token exchange failed or did not return a refresh token.",
    );
  }

  return body;
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : process.platform === "darwin" ? ["-a", "Microsoft Edge", url] : [url];

  execFile(command, args, (error) => {
    if (error) {
      console.log(
        "Could not open your browser automatically. Paste the URL above into your browser.",
      );
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    rl.close();
  });
