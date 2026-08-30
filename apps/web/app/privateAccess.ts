"use client";

const accessKeyStorageKey = "ourchivalOwnerAccessKey";
const accessChangedEvent = "ourchival-access-changed";
const interceptorMarker = "__ourchivalPrivateFetchInstalled";

export function getOwnerAccessKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(accessKeyStorageKey)?.trim() ?? "";
}

export function saveOwnerAccessKey(
  value: string,
  { broadcast = true }: { broadcast?: boolean } = {},
) {
  if (typeof window === "undefined") return;
  const key = value.trim();
  if (getOwnerAccessKey() === key) return;
  if (key) window.localStorage.setItem(accessKeyStorageKey, key);
  else window.localStorage.removeItem(accessKeyStorageKey);
  if (broadcast) window.dispatchEvent(new Event(accessChangedEvent));
}

export function clearOwnerAccessKey() {
  saveOwnerAccessKey("");
}

export function onOwnerAccessChange(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(accessChangedEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(accessChangedEvent, listener);
    window.removeEventListener("storage", listener);
  };
}

export function requireOwnerAccessKey() {
  const key = getOwnerAccessKey();
  if (!key) throw new Error("Unlock Ourchival before using the vault.");
  return key;
}

export function withOwnerAccess<T extends Record<string, unknown>>(args: T) {
  return { ...args, accessKey: requireOwnerAccessKey() };
}

export async function privateFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const headers = mergedHeaders(input, init.headers);
  headers.set("Authorization", `Bearer ${requireOwnerAccessKey()}`);
  return await fetch(input, { ...init, headers });
}

export function resolveConvexSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return undefined;
  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}

export function isOwnerCredentialRejection(status: number) {
  return status === 401 || status === 403;
}

function installPrivateFetchInterceptor() {
  if (typeof window === "undefined") return;
  const markedWindow = window as unknown as Window & Record<string, unknown>;
  if (markedWindow[interceptorMarker]) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const siteUrl = resolveConvexSiteUrl();
    const accessKey = getOwnerAccessKey();
    if (!siteUrl || !accessKey || !isTrustedSiteRequest(input, siteUrl)) {
      return await originalFetch(input, init);
    }

    const headers = mergedHeaders(input, init.headers);
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${accessKey}`);
    }
    return await originalFetch(input, { ...init, headers });
  };
  markedWindow[interceptorMarker] = true;
}

export function isTrustedSiteRequest(
  input: RequestInfo | URL,
  siteUrl: string,
) {
  try {
    const base = typeof window === "undefined" ? siteUrl : window.location.href;
    const request = new URL(requestUrl(input), base);
    const site = new URL(siteUrl);
    return request.origin === site.origin;
  } catch {
    return false;
  }
}

function mergedHeaders(input: RequestInfo | URL, initHeaders?: HeadersInit) {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(initHeaders).forEach((value, key) => headers.set(key, value));
  return headers;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

installPrivateFetchInterceptor();
