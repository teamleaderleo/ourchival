const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ownerSessionPrefix = "ourc_owner_";
const ownerSessionLifetimeMs = 15 * 60 * 1000;
const ownerSessionClockSkewMs = 60 * 1000;

export type AccessPrincipal =
  | { kind: "owner" }
  | { kind: "clipper"; deviceId: string; deviceName: string };

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
  if (candidate.startsWith(ownerSessionPrefix)) {
    return await isOwnerSessionToken(candidate);
  }

  const configured = process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim();
  if (!configured) return false;
  return await secretsEqual(candidate, configured);
}

export async function requireOwnerAccess(candidate: string | undefined) {
  if (await isOwnerAccessKey(candidate)) {
    return { kind: "owner" } as const;
  }

  if (!ownerAccessConfigured()) {
    throw new AccessError(
      "Configure WorkOS vault sessions or OURCHIVAL_OWNER_ACCESS_KEY in this Convex deployment.",
      503,
      "owner_access_unconfigured",
    );
  }

  throw new AccessError("This vault session is invalid or expired.", 401, "invalid_owner_access");
}

export function requireAllowedWorkosUser(subject: string) {
  const allowed = (process.env.OURCHIVAL_ALLOWED_WORKOS_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    throw new AccessError(
      "OURCHIVAL_ALLOWED_WORKOS_USER_IDS is missing from the Convex deployment.",
      503,
      "workos_owner_allowlist_unconfigured",
    );
  }

  if (!allowed.includes(subject)) {
    throw new AccessError(
      `WorkOS user ${subject} is not allowed to open this vault.`,
      403,
      "workos_owner_not_allowed",
    );
  }
}

export async function createOwnerSessionToken(subject: string) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ownerSessionLifetimeMs;
  const payload = textToHex(
    JSON.stringify({
      version: 1,
      subject,
      issuedAt,
      expiresAt,
    }),
  );
  const signature = await hmacHex(payload, ownerSessionSecret());
  return {
    token: `${ownerSessionPrefix}${payload}.${signature}`,
    expiresAt,
  };
}

export async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
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
  const cleaned = value.trim().toLocaleUpperCase().replace(/[^A-Z2-9]/g, "");
  return cleaned.length === 10 ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}` : undefined;
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

async function isOwnerSessionToken(candidate: string) {
  const value = candidate.slice(ownerSessionPrefix.length);
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const payloadHex = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^[a-f0-9]+$/i.test(payloadHex) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = await hmacHex(payloadHex, ownerSessionSecret());
  if (!(await secretsEqual(signature, expectedSignature))) return false;

  const payloadText = hexToText(payloadHex);
  if (!payloadText) return false;

  try {
    const payload = JSON.parse(payloadText) as {
      version?: number;
      subject?: string;
      issuedAt?: number;
      expiresAt?: number;
    };
    const now = Date.now();
    return Boolean(
      payload.version === 1 &&
        typeof payload.subject === "string" &&
        payload.subject.length > 0 &&
        typeof payload.issuedAt === "number" &&
        payload.issuedAt <= now + ownerSessionClockSkewMs &&
        typeof payload.expiresAt === "number" &&
        payload.expiresAt >= now - ownerSessionClockSkewMs,
    );
  } catch {
    return false;
  }
}

function ownerAccessConfigured() {
  return Boolean(
    process.env.OURCHIVAL_SESSION_SIGNING_SECRET?.trim() ||
      process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim(),
  );
}

function ownerSessionSecret() {
  const secret =
    process.env.OURCHIVAL_SESSION_SIGNING_SECRET?.trim() ||
    process.env.OURCHIVAL_OWNER_ACCESS_KEY?.trim();
  if (!secret) {
    throw new AccessError(
      "OURCHIVAL_SESSION_SIGNING_SECRET is missing from the Convex deployment.",
      503,
      "owner_session_unconfigured",
    );
  }
  return secret;
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function textToHex(value: string) {
  return bytesToHex(textEncoder.encode(value));
}

function hexToText(value: string) {
  if (value.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return undefined;
    bytes[index] = byte;
  }
  return textDecoder.decode(bytes);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedCorsOrigin(origin: string | null) {
  if (!origin) return undefined;
  const configured = (process.env.OURCHIVAL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return origin;
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return undefined;
}

function randomToken(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function secretsEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([hashSecret(left), hashSecret(right)]);
  let difference = leftHash.length ^ rightHash.length;
  const length = Math.max(leftHash.length, rightHash.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}
