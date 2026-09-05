import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadStreamToDrive } from "./drive";

const environmentKeys = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_PARENT_FOLDER_ID",
] as const;

const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("uploadStreamToDrive", () => {
  it("uploads large streams in bounded resumable chunks", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    const size = 8 * 1024 * 1024 + 3;
    const ranges: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) {
        return Response.json({ access_token: "access" });
      }
      if (url.includes("uploadType=resumable")) {
        return new Response(null, {
          status: 200,
          headers: { Location: "https://upload.example/session" },
        });
      }
      ranges.push(new Headers(init?.headers).get("Content-Range") ?? "");
      if (ranges.length === 1) {
        return new Response(null, {
          status: 308,
          headers: { Range: "bytes=0-8388607" },
        });
      }
      return Response.json({
        id: "drive-file",
        mimeType: "image/png",
        size: String(size),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadStreamToDrive({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      }),
      size,
      sourceUrl: "https://images.example/reference.png",
      title: "Reference",
      mimeType: "image/png",
    });

    expect(result).toMatchObject({
      ok: true,
      file: { id: "drive-file" },
    });
    expect(ranges).toEqual([
      `bytes 0-8388607/${size}`,
      `bytes 8388608-${size - 1}/${size}`,
    ]);
  });
});
