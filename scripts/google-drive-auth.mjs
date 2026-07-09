#!/usr/bin/env node

import http from "node:http";
import { URL } from "node:url";
import { execFile } from "node:child_process";
import readline from "node:readline/promises";
import process from "node:process";

const port = Number(process.env.OURCHIVAL_GOOGLE_AUTH_PORT ?? 53682);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scope = "https://www.googleapis.com/auth/drive.file";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  const clientId = await ask("Google OAuth client ID: ");
  const clientSecret = await ask("Google OAuth client secret: ");

  const code = await listenForCode(clientId);
  const tokenResponse = await exchangeCode({ clientId, clientSecret, code });

  console.log("\nSuccess. Add these to Convex env:\n");
  console.log(`npx convex env set GOOGLE_CLIENT_ID '${clientId}'`);
  console.log(`npx convex env set GOOGLE_CLIENT_SECRET '${clientSecret}'`);
  console.log(`npx convex env set GOOGLE_REFRESH_TOKEN '${tokenResponse.refresh_token}'`);
  console.log("\nOptional, after you create an Ourchival folder in Drive:");
  console.log("npx convex env set GOOGLE_DRIVE_PARENT_FOLDER_ID 'your-folder-id'\n");
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
    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", redirectUri);

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
        if (!code) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Missing code");
          return;
        }

        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<h1>Ourchival Google Drive connected.</h1><p>You can close this tab.</p>");
        resolve(code);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scope);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      console.log(`\nOpening Google OAuth in your browser…\n${authUrl.toString()}\n`);
      openBrowser(authUrl.toString());
    });
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
    console.error(body);
    throw new Error("Google token exchange failed or did not return a refresh token.");
  }

  return body;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  execFile(command, args, (error) => {
    if (error) {
      console.log("Could not open your browser automatically. Paste the URL above into your browser.");
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
