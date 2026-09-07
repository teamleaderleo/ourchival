import { describe, expect, it } from "vitest";
import { hashResponseBody } from "./artworkDriveRepresentationNode";

describe("hashResponseBody", () => {
  it("streams raw bytes into the same lowercase SHA-256 format used by captured assets", async () => {
    const response = new Response(new Blob(["hello"]), {
      headers: { "Content-Type": "image/png" },
    });

    await expect(hashResponseBody(response, 1024)).resolves.toEqual({
      contentHash:
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      fileSize: 5,
      mimeType: "image/png",
    });
  });

  it("fails before reading when a declared file exceeds the bounded hash limit", async () => {
    const response = new Response(new Blob(["small"]), {
      headers: { "Content-Length": "4096" },
    });

    await expect(hashResponseBody(response, 1024)).rejects.toThrow(
      "hashing limit",
    );
  });

  it("fails closed when a chunked response crosses the byte limit mid-stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const response = new Response(stream);

    await expect(hashResponseBody(response, 5)).rejects.toThrow(
      "hashing limit",
    );
  });
});
