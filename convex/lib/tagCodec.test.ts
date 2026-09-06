import { expect, test } from "vitest";
import { decodeTags, encodeTags } from "./tagCodec";
import fixtures from "../../workers/visual/tests/fixtures/tag-codec.json";

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (n) => n.toString(16).padStart(2, "0")).join(
    "",
  );
const bytes = (s: string) =>
  Uint8Array.from(s.match(/../g)!, (n) => parseInt(n, 16)).buffer;

test("Python and TypeScript share exact wire fixtures and retain legacy decoding", () => {
  for (const f of fixtures)
    for (const version of [1, 2] as const) {
      const entries = f.entries as Array<[number, number]>;
      expect(hex(encodeTags(entries, version))).toBe(f[`v${version}`]);
      expect(decodeTags(bytes(f[`v${version}`]))).toEqual(entries);
    }
});

test("adaptive encoding never grows, preserves scores and sparse uint32 identities", () => {
  for (const stride of [1, 127, 128, 16383, 16384, 1 << 20, 1 << 28]) {
    const entries: Array<[number, number]> = Array.from(
      { length: Math.min(100, Math.floor(0xffffffff / stride)) },
      (_, i) => [(i + 1) * stride, i % 2 ? 0.35000000000000003 : -0],
    );
    const packed = encodeTags(entries);
    expect(packed.byteLength).toBeLessThanOrEqual(
      encodeTags(entries, 1).byteLength,
    );
    expect(decodeTags(packed)).toEqual(entries);
    expect(Object.is(decodeTags(packed)[0][1], -0)).toBe(true);
  }
  expect(new Uint8Array(encodeTags([[0xffffffff, 0.5]]))[3]).toBe(1);
});

test("v2 rejects nonminimal, zero, oversized, overflowing and truncated deltas", () => {
  const header = "4f54470200000001",
    score = "3fe0000000000000";
  for (const delta of ["00", "8100", "808080808000", "ffffffff10", "80"]) {
    expect(() => decodeTags(bytes(header + delta + score))).toThrow();
  }
  const valid = hex(encodeTags([[1, 0.5]], 2));
  for (let i = 0; i < valid.length; i += 2)
    expect(() => decodeTags(bytes(valid.slice(0, i) || "00"))).toThrow();
  expect(() => decodeTags(bytes(valid + "00"))).toThrow();
  expect(() =>
    decodeTags(bytes("4f54470200000002ffffffff0f" + score + "01" + score)),
  ).toThrow();
});
