import { afterEach, expect, test, vi } from "vitest";
import { AUTOMATION_ALARM } from "./importAutomation";
import { SOURCE_INTAKES_KEY, SETTINGS_KEY } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function fixture(source: Record<string, unknown>) {
  let db: Record<string, any> = {
    [SETTINGS_KEY]: {
      captureEndpoint: "http://127.0.0.1:3211/capture",
      deviceToken: "fixture-only",
    },
    [SOURCE_INTAKES_KEY]: { job: source },
  };
  let alarm: (value: { name: string }) => void = () => {};
  let message: (...args: any[]) => void = () => {};
  const event = () => ({ addListener: vi.fn() });
  const create = vi.fn(async () => ({ id: 42, status: "loading" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
  );
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        setAccessLevel: vi.fn(),
        get: async () => structuredClone(db),
        set: async (value: Record<string, unknown>) => {
          db = structuredClone({ ...db, ...value });
        },
      },
    },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: {
        addListener: (fn: typeof message) => {
          message = fn;
        },
      },
    },
    contextMenus: { onClicked: event() },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      create,
      update: vi.fn(),
      remove: vi.fn(),
      get: vi.fn(async () => undefined),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: {
        addListener: (fn: typeof alarm) => {
          alarm = fn;
        },
      },
    },
  });
  await import("./background");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    db: () => db,
    create,
    tick: () => alarm({ name: AUTOMATION_ALARM }),
    send: (value: unknown) =>
      new Promise((resolve) => message(value, {}, resolve)),
  };
}
const stopped = {
  importId: "job",
  provider: "pixiv_bookmarks",
  sourceUrl:
    "https://www.pixiv.net/en/users/42/bookmarks/artworks?rest=show&mode=all",
  currentUrl:
    "https://www.pixiv.net/en/users/42/bookmarks/artworks?rest=show&mode=all&p=18",
  cursor: "page:18",
  running: false,
  exhausted: false,
  receiptVersion: 2,
  purpose: "history",
  stopReason: "error",
  updatedAt: new Date(0).toISOString(),
  startedAt: new Date(0).toISOString(),
  seenProviderIds: [],
  message: "Internal Server Error",
  retryAt: 1,
};
test("an alarm resumes the retained page in an unfocused owned tab", async () => {
  const f = await fixture(stopped);
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  expect(f.create).toHaveBeenCalledWith({
    url: stopped.currentUrl,
    active: false,
  });
  expect(f.db()[SOURCE_INTAKES_KEY].job).toMatchObject({
    running: true,
    workerTabId: 42,
    automationAttempts: 1,
  });
});
test("alarms respect Stop; an explicit new-save check preserves the stopped historical checkpoint", async () => {
  const f = await fixture({ ...stopped, stopReason: "paused" });
  expect(f.create).not.toHaveBeenCalled();
  await f.send({ type: "OURCHIVAL_AUTOMATION", syncUrl: stopped.sourceUrl });
  await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
  expect(f.db()[SOURCE_INTAKES_KEY].job.stopReason).toBe("paused");
  expect(f.create).toHaveBeenCalledWith({
    url: stopped.sourceUrl,
    active: false,
  });
});
test("authentication failures require attention without opening repeated tabs", async () => {
  const f = await fixture({
    ...stopped,
    retryAt: undefined,
    message: "invalid_grant",
  });
  await vi.waitFor(() =>
    expect(f.db()[SOURCE_INTAKES_KEY].job.needsAttention).toBe(true),
  );
  f.tick();
  expect(f.create).not.toHaveBeenCalled();
});
