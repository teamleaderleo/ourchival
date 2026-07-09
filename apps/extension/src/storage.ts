import type { CapturePayload } from "@ourchival/shared";

export type CaptureResult = {
  ok: boolean;
  status?: number;
  message?: string;
  storageStatus?: string;
  referenceId?: string;
  assetId?: string | null;
  savedAt: string;
};

export type ExtensionSettings = {
  captureEndpoint?: string;
};

export const SETTINGS_KEY = "ourchivalSettings";
export const LAST_CAPTURE_KEY = "lastCapture";
export const LAST_RESULT_KEY = "lastCaptureResult";

export async function getSettings(): Promise<ExtensionSettings> {
  const values = await chrome.storage.local.get(SETTINGS_KEY);
  return (values[SETTINGS_KEY] as ExtensionSettings | undefined) ?? {};
}

export async function saveSettings(settings: ExtensionSettings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function saveLastCapture(capture: CapturePayload) {
  await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: capture });
}

export async function saveLastResult(result: CaptureResult) {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
}

export async function getPopupState() {
  return await chrome.storage.local.get([
    SETTINGS_KEY,
    LAST_CAPTURE_KEY,
    LAST_RESULT_KEY,
  ]);
}

export function normalizeCaptureEndpoint(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  return trimmed.endsWith("/capture")
    ? trimmed
    : `${trimmed.replace(/\/$/, "")}/capture`;
}
