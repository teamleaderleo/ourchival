const tokenEndpoint = "https://oauth2.googleapis.com/token";
const driveFilesEndpoint = "https://www.googleapis.com/drive/v3/files";
const driveAboutEndpoint = "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)";
const driveUploadEndpoint = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents";
const driveResumableUploadEndpoint = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents";
const driveUploadChunkBytes = 8 * 1024 * 1024;
const preferenceFileName = "ourchival-preferences.json";

type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  parentFolderId?: string;
};

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  parents?: string[];
};

export type DriveUploadResult = {
  ok: boolean;
  status: string;
  file?: DriveFile;
};

export type DriveOwnerIdentity = {
  displayName?: string;
  emailAddress?: string;
  permissionId?: string;
};

let cachedOwnerIdentity: { value: DriveOwnerIdentity; expiresAt: number } | undefined;

export function getDriveConfig(): DriveConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return undefined;

  return {
    clientId,
    clientSecret,
    refreshToken,
    parentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID,
  };
}

export async function getDriveOwnerIdentity(): Promise<DriveOwnerIdentity | undefined> {
  if (cachedOwnerIdentity && cachedOwnerIdentity.expiresAt > Date.now()) {
    return cachedOwnerIdentity.value;
  }

  const config = getDriveConfig();
  if (!config) return undefined;
  const accessToken = await getAccessToken(config);
  const response = await fetch(driveAboutEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => undefined)) as
    | { user?: DriveOwnerIdentity; error?: unknown }
    | undefined;
  if (!response.ok || !body?.user) return undefined;

  cachedOwnerIdentity = {
    value: body.user,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  return body.user;
}

export async function uploadBlobToDrive(args: {
  blob: Blob;
  sourceUrl: string;
  title?: string;
  mimeType?: string;
}): Promise<DriveUploadResult> {
  const config = getDriveConfig();

  if (!config) {
    return { ok: false, status: "Google Drive env vars are missing" };
  }

  const accessToken = await getAccessToken(config);
  const fileName = buildFileName(args.title, args.sourceUrl, args.mimeType);
  const metadata = {
    name: fileName,
    ...(config.parentFolderId ? { parents: [config.parentFolderId] } : {}),
    appProperties: {
      ourchival: "true",
      sourceUrl: args.sourceUrl,
    },
  };

  const boundary = `ourchival_${crypto.randomUUID()}`;
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  const mimeType = (args.mimeType ?? args.blob.type) || "application/octet-stream";

  const body = new Blob(
    [
      `${delimiter}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      "\r\n",
      `${delimiter}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      args.blob,
      "\r\n",
      `${closeDelimiter}\r\n`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  const response = await fetch(driveUploadEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const file = (await response.json().catch(() => undefined)) as DriveFile | undefined;

  if (!response.ok || !file?.id) {
    return {
      ok: false,
      status: `Drive upload failed: ${response.status}`,
    };
  }

  return {
    ok: true,
    status: "stored original asset in Google Drive",
    file,
  };
}

export async function uploadStreamToDrive(args: {
  stream: ReadableStream<Uint8Array>;
  size: number;
  sourceUrl: string;
  title?: string;
  mimeType?: string;
}): Promise<DriveUploadResult> {
  const config = getDriveConfig();
  if (!config) {
    return { ok: false, status: "Google Drive env vars are missing" };
  }
  if (!Number.isSafeInteger(args.size) || args.size <= 0) {
    return { ok: false, status: "remote asset size is unavailable" };
  }

  try {
    const accessToken = await getAccessToken(config);
    const mimeType = args.mimeType || "application/octet-stream";
    const metadata = {
      name: buildFileName(args.title, args.sourceUrl, mimeType),
      mimeType,
      ...(config.parentFolderId ? { parents: [config.parentFolderId] } : {}),
      appProperties: {
        ourchival: "true",
        sourceUrl: args.sourceUrl,
      },
    };
    const session = await fetch(driveResumableUploadEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(args.size),
      },
      body: JSON.stringify(metadata),
    });
    const sessionUrl = session.headers.get("Location");
    if (!session.ok || !sessionUrl) {
      return {
        ok: false,
        status: `Drive resumable upload setup failed: ${session.status}`,
      };
    }

    const chunks = streamChunks(args.stream, driveUploadChunkBytes);
    let offset = 0;
    for await (const chunk of chunks) {
      const chunkEnd = offset + chunk.size;
      if (chunkEnd > args.size) {
        return { ok: false, status: "remote asset exceeded its declared size" };
      }
      let acknowledged = offset;
      while (acknowledged < chunkEnd) {
        const body = chunk.slice(acknowledged - offset);
        const response = await fetch(sessionUrl, {
          method: "PUT",
          headers: {
            "Content-Length": String(body.size),
            "Content-Range": `bytes ${acknowledged}-${chunkEnd - 1}/${args.size}`,
          },
          body,
        });
        if (response.ok) {
          const file = (await response.json().catch(() => undefined)) as
            | DriveFile
            | undefined;
          if (!file?.id || chunkEnd !== args.size) {
            return {
              ok: false,
              status: "Drive completed before the full asset was uploaded",
            };
          }
          return {
            ok: true,
            status: "stored original asset in Google Drive",
            file,
          };
        }
        if (response.status !== 308) {
          return {
            ok: false,
            status: `Drive resumable upload failed: ${response.status}`,
          };
        }
        const nextOffset = acknowledgedOffset(response.headers.get("Range"));
        if (nextOffset <= acknowledged || nextOffset > chunkEnd) {
          return {
            ok: false,
            status: "Drive returned an invalid resumable upload receipt",
          };
        }
        acknowledged = nextOffset;
      }
      offset = chunkEnd;
    }

    return {
      ok: false,
      status:
        offset === args.size
          ? "Drive did not finalize the resumable upload"
          : "remote asset ended before its declared size",
    };
  } catch (error) {
    return {
      ok: false,
      status:
        error instanceof Error
          ? `Drive resumable upload failed: ${error.message}`
          : "Drive resumable upload failed",
    };
  }
}

async function* streamChunks(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
) {
  const reader = stream.getReader();
  let pending: Uint8Array | undefined;
  let ended = false;
  try {
    while (!ended || pending?.byteLength) {
      const parts: BlobPart[] = [];
      let size = 0;
      while (size < maximumBytes) {
        let value = pending;
        pending = undefined;
        if (!value) {
          const result = await reader.read();
          ended = result.done;
          value = result.value;
        }
        if (!value?.byteLength) {
          if (ended) break;
          continue;
        }
        const remaining = maximumBytes - size;
        if (value.byteLength > remaining) {
          parts.push(new Uint8Array(value.subarray(0, remaining)));
          pending = value.subarray(remaining);
          size += remaining;
        } else {
          parts.push(new Uint8Array(value));
          size += value.byteLength;
        }
      }
      if (size > 0) yield new Blob(parts);
    }
  } finally {
    reader.releaseLock();
  }
}

function acknowledgedOffset(range: string | null) {
  const match = /bytes=0-(\d+)/i.exec(range ?? "");
  return match ? Number(match[1]) + 1 : 0;
}

export async function upsertPreferenceSnapshotToDrive(args: {
  json: string;
  driveFileId?: string;
}) {
  const config = getDriveConfig();
  if (!config) throw new Error("Google Drive env vars are missing");

  const accessToken = await getAccessToken(config);
  if (args.driveFileId) {
    const updated = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(args.driveFileId)}?uploadType=media&fields=id,name,mimeType,size,webViewLink,parents`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: args.json,
      },
    );
    const file = (await updated.json().catch(() => undefined)) as DriveFile | undefined;
    if (updated.ok && file?.id) return file;
    if (updated.status !== 404) {
      throw new Error(`Drive preference snapshot update failed: ${updated.status}`);
    }
  }

  const metadata = {
    name: preferenceFileName,
    mimeType: "application/json",
    ...(config.parentFolderId ? { parents: [config.parentFolderId] } : {}),
    appProperties: {
      ourchival: "true",
      purpose: "preference_snapshot",
      schemaVersion: "1",
    },
  };
  const boundary = `ourchival_preferences_${crypto.randomUUID()}`;
  const body = new Blob(
    [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      "\r\n",
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      args.json,
      "\r\n",
      `--${boundary}--\r\n`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  const response = await fetch(driveUploadEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const file = (await response.json().catch(() => undefined)) as DriveFile | undefined;
  if (!response.ok || !file?.id) {
    throw new Error(`Drive preference snapshot creation failed: ${response.status}`);
  }
  return file;
}

export async function fetchDriveFile(fileId: string) {
  const config = getDriveConfig();
  if (!config) throw new Error("Google Drive env vars are missing");

  const accessToken = await getAccessToken(config);

  return await fetch(`${driveFilesEndpoint}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function createDriveFolder(name: string, parentFolderId?: string) {
  const config = getDriveConfig();
  if (!config) throw new Error("Google Drive env vars are missing");

  const accessToken = await getAccessToken(config);
  const response = await fetch(driveFilesEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    }),
  });

  const body = (await response.json().catch(() => undefined)) as DriveFile | undefined;

  if (!response.ok || !body?.id) {
    throw new Error(`Drive folder creation failed: ${response.status}`);
  }

  return body;
}

async function getAccessToken(config: DriveConfig) {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = (await response.json()) as { access_token?: string; error?: string };

  if (!response.ok || !body.access_token) {
    throw new Error(body.error ?? `Google OAuth token refresh failed: ${response.status}`);
  }

  return body.access_token;
}

function buildFileName(title: string | undefined, sourceUrl: string, mimeType: string | undefined) {
  const sourceHost = safeHost(sourceUrl) || "reference";
  const base = slugify(title || sourceHost || "reference").slice(0, 80) || "reference";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = extensionForMimeType(mimeType);

  return `${stamp}-${base}${extension}`;
}

function extensionForMimeType(mimeType: string | undefined) {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();

  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/avif") return ".avif";
  if (normalized === "image/svg+xml") return ".svg";

  return "";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
