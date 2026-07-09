const tokenEndpoint = "https://oauth2.googleapis.com/token";
const driveFilesEndpoint = "https://www.googleapis.com/drive/v3/files";
const driveUploadEndpoint = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink,parents";

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
  const mimeType = args.mimeType ?? args.blob.type || "application/octet-stream";

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
