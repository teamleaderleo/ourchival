import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./api/local-session/route";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockResolvedValue("fixture-key") }));
afterEach(() => vi.unstubAllEnvs());

function request(host = "127.0.0.1:3000", site = "same-origin", origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/local-session", {
    headers: { host, "sec-fetch-site": site, origin },
  });
}

it("is unavailable unless explicitly configured on the desktop server", async () => {
  vi.stubEnv("OURCHIVAL_LOCAL_ORIGIN", "");
  vi.stubEnv("OURCHIVAL_LOCAL_OWNER_KEY_FILE", "");
  expect((await GET(request())).status).toBe(404);
});

it("opens the local vault only for same-origin loopback requests without caching", async () => {
  vi.stubEnv("OURCHIVAL_LOCAL_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("OURCHIVAL_LOCAL_OWNER_KEY_FILE", "/fixture/local-key");
  const response = await GET(request());
  expect(await response.json()).toEqual({ credential: "fixture-key" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await GET(request("example.com"))).status).toBe(403);
  expect((await GET(request("127.0.0.1:3000", "cross-site"))).status).toBe(403);
  expect((await GET(request("127.0.0.1:3000", "same-origin", "https://example.com"))).status).toBe(403);
  vi.stubEnv("OURCHIVAL_LOCAL_ORIGIN", "https://example.com");
  expect((await GET(request())).status).toBe(404);
});
