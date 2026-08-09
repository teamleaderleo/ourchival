import { describe, expect, it, vi } from "vitest";
import { retryOnce } from "./retryOnce";

describe("retryOnce", () => {
  it("returns the first successful result without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("saved");

    await expect(retryOnce(operation)).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries once after an ambiguous failure", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce("recovered");

    await expect(retryOnce(operation)).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("preserves the first failure when both attempts fail", async () => {
    const first = new Error("Original failure");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(new Error("Retry failure"));

    await expect(retryOnce(operation)).rejects.toBe(first);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
