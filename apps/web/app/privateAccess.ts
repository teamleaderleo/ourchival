"use client";

const accessKeyStorageKey = "ourchivalOwnerAccessKey";
const accessChangedEvent = "ourchival-access-changed";

export function getOwnerAccessKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(accessKeyStorageKey)?.trim() ?? "";
}

export function saveOwnerAccessKey(value: string) {
  if (typeof window === "undefined") return;
  const key = value.trim();
  if (key) window.localStorage.setItem(accessKeyStorageKey, key);
  else window.localStorage.removeItem(accessKeyStorageKey);
  window.dispatchEvent(new Event(accessChangedEvent));
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

export async function privateFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
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
