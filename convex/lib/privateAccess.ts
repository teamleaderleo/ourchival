import { getDriveConfig, getDriveOwnerIdentity } from "./drive";

const textEncoder = new TextEncoder();
const googleTokenInfoEndpoint = "https://oauth2.googleapis.com/tokeninfo";
const googleCredentialCache = new Map<string, number>();
const ownerSessionPrefix = "ourc_owner_session";
const ownerSessionLifetimeMs = 365 * 24 * 60 * 60 * 1000;

export type AccessPrincipal =
  { kind: "owner" } | { kind: "clipper"; deviceId: string; deviceName: string };

export class AccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 401, code = "unauthorized") {
    super(message);
    this.name = "AccessError";
    this.status = status;
    this.code = code;
  }
}

export function bearerToken(request: Request) {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

export async function isOwnerAccessKey(candidate: string | undefined) {
  if (!candidate) return false;

  const configured = process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim();
  if (configured && (await secretsEqual(candidate, configured))) return true;

  if (configured && (await isOwnerSessionCredential(candidate, configured)))
    return true;

  if (!configured && !getDriveConfig()) {
    throw new AccessError(
      "Ourchival owner authentication is not configured.",
      503,
      "owner_access_unconfigured",
    );
  }
  return false;
}

export async function exchangeOwnerCredential(candidate: string | undefined) {
  if (!candidate) {
    throw new AccessError(
      "The owner credential is invalid or expired.",
      401,
      "invalid_owner_access",
    );
  }

  const configured = process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim();
  if (
    configured &&
    ((await secretsEqual(candidate, configured)) ||
      (await isOwnerSessionCredential(candidate, configured)))
  ) {
    return await createOwnerSessionCredential();
  }

  if (!(await isGoogleOwnerCredential(candidate))) {
    throw new AccessError(
      "The owner credential is invalid or expired.",
      401,
      "invalid_owner_access",
    );
  }

  return await createOwnerSessionCredential();
}

export async function requireOwnerAccess(candidate: string | undefined) {
  if (!(await isOwnerAccessKey(candidate))) {
    throw new AccessError(
      "The owner credential is invalid or expired.",
      401,
      "invalid_owner_access",
    );
  }
  return { kind: "owner" } as const;
}

export async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createOwnerSessionCredential(now = Date.now()) {
  const signingSecret = process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim();
  if (!signingSecret) {
    throw new AccessError(
      "Ourchival owner sessions require the recovery key configuration.",
      503,
      "owner_session_unconfigured",
    );
  }

  const expiresAt = now + ownerSessionLifetimeMs;
  const payload = `${ownerSessionPrefix}_${expiresAt}_${randomToken(24)}`;
  const signature = await signOwnerSession(payload, signingSecret);
  return { credential: `${payload}_${signature}`, expiresAt };
}

export async function isOwnerSessionCredential(
  candidate: string,
  signingSecret = process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim(),
  now = Date.now(),
) {
  if (!signingSecret) return false;
  const match = new RegExp(
    `^(${ownerSessionPrefix}_(\\d{13})_[a-f0-9]{48})_([a-f0-9]{64})$`,
  ).exec(candidate);
  if (!match) return false;

  const expiresAt = Number(match[2]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = await signOwnerSession(match[1], signingSecret);
  return await secretsEqual(match[3], expected);
}

export function createDeviceToken() {
  return `ourc_dev_${randomToken(32)}`;
}

export function createPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}

export function normalizePairingCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .trim()
    .toLocaleUpperCase()
    .replace(/[^A-Z2-9]/g, "");
  return cleaned.length === 10
    ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`
    : undefined;
}

export function cleanDeviceName(value: unknown) {
  if (typeof value !== "string") return "Ourchival Clipper";
  return value.trim().replace(/\s+/g, " ").slice(0, 80) || "Ourchival Clipper";
}

export function requestCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = allowedCorsOrigin(origin);
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function isGoogleOwnerCredential(candidate: string) {
  if (candidate.split(".").length !== 3) return false;

  const cachedUntil = googleCredentialCache.get(candidate);
  if (cachedUntil && cachedUntil > Date.now()) return true;

  const config = getDriveConfig();
  if (!config) return false;

  const response = await fetch(
    `${googleTokenInfoEndpoint}?id_token=${encodeURIComponent(candidate)}`,
  );
  const info = (await response.json().catch(() => undefined)) as
    | {
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        exp?: string;
        iss?: string;
      }
    | undefined;
  if (!response.ok || !info) return false;

  const issuerOk =
    info.iss === "accounts.google.com" ||
    info.iss === "https://accounts.google.com";
  const verified =
    info.email_verified === true || info.email_verified === "true";
  const expiresAt = Number(info.exp ?? 0) * 1000;
  if (
    !issuerOk ||
    !verified ||
    info.aud !== config.clientId ||
    !info.email ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  const configuredOwnerEmail = process.env.OURCHIVAL_OWNER_EMAIL?.trim();
  if (
    !configuredOwnerEmail ||
    !googleOwnerEmailMatches(info.email, configuredOwnerEmail)
  ) {
    return false;
  }

  const driveOwner = await getDriveOwnerIdentity();
  if (!driveOwner?.emailAddress) return false;
  if (!googleOwnerEmailMatches(info.email, driveOwner.emailAddress))
    return false;

  googleCredentialCache.set(
    candidate,
    Math.min(expiresAt, Date.now() + 5 * 60 * 1000),
  );
  if (googleCredentialCache.size > 32) {
    for (const [token, expiry] of googleCredentialCache) {
      if (expiry <= Date.now()) googleCredentialCache.delete(token);
    }
  }
  return true;
}

export function googleOwnerEmailMatches(
  tokenEmail: string,
  driveOwnerEmail: string,
) {
  return (
    tokenEmail.trim().toLowerCase() === driveOwnerEmail.trim().toLowerCase()
  );
}

function allowedCorsOrigin(origin: string | null) {
  if (!origin) return undefined;
  const configured = (process.env.OURCHIVAL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return origin;
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
    return origin;
  return undefined;
}

function randomToken(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function secretsEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    hashSecret(left),
    hashSecret(right),
  ]);
  let difference = leftHash.length ^ rightHash.length;
  const length = Math.max(leftHash.length, rightHash.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function signOwnerSession(payload: string, signingSecret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
