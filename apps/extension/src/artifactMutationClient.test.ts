import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callArtifactMutation,
  commitArtifactMutation,
  discardRejectedArtifact,
} from "./artifactMutationClient";

const endpoint = "https://example.convex.cloud/api/mutation";
const args = { storageId: "storage-1", referenceId: "reference-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artifact mutation client", () => {
  it("returns explicit Convex rejections without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: "error", errorMessage: "Invalid artifact." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitArtifactMutation(
      endpoint,
      "pageText:commitBrowserReadableText",
      args,
    );

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      error: "Invalid artifact.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an ambiguous commit with identical arguments", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Connection lost after commit"))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          value: { artifactId: "artifact-1", duplicate: true },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await commitArtifactMutation(
      endpoint,
      "pageSnapshots:commitBrowserScreenshot",
      args,
    );

    expect(result).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toEqual(
      requestBody(fetchMock.mock.calls[1]?.[1]),
    );
  });

  it("marks missing successful results as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: "success" })),
    );

    const result = await callArtifactMutation(
      endpoint,
      "pageStructuredSnapshots:commitBrowserSnapshot",
      args,
    );

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("requests indexed cleanup for an unclaimed rejected upload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "success",
        value: { discarded: true, retained: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await discardRejectedArtifact(
      endpoint,
      "device-token",
      "storage-1",
    );

    expect(result).toMatchObject({
      ok: true,
      value: { discarded: true, retained: false },
    });
    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      path: "artifactUploads:discardUnclaimed",
      args: {
        deviceToken: "device-token",
        storageId: "storage-1",
      },
      format: "json",
    });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body));
}
