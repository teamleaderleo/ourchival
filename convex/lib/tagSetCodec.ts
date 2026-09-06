/** OTS v1: unscored, sorted uint32 IDs. Community membership has no confidence. */
export function encodeTagSet(codes: number[]): ArrayBuffer {
  if (codes.length > 512) throw new Error("Too many community tags");
  const sorted = [...codes].sort((a, b) => a - b);
  const buffer = new ArrayBuffer(8 + sorted.length * 4),
    view = new DataView(buffer);
  view.setUint32(0, 0x4f545301);
  view.setUint32(4, sorted.length);
  let previous = 0;
  sorted.forEach((code, i) => {
    if (!Number.isInteger(code) || code <= previous || code > 0xffffffff)
      throw new Error("Invalid term code");
    view.setUint32(8 + i * 4, code);
    previous = code;
  });
  return buffer;
}
export function decodeTagSet(buffer: ArrayBuffer): number[] {
  if (buffer.byteLength < 8) throw new Error("Truncated tag set");
  const view = new DataView(buffer),
    count = view.getUint32(4);
  if (
    view.getUint32(0) !== 0x4f545301 ||
    count > 512 ||
    buffer.byteLength !== 8 + count * 4
  )
    throw new Error("Invalid tag set");
  const codes = Array.from({ length: count }, (_, i) =>
    view.getUint32(8 + 4 * i),
  );
  if (codes.some((c, i) => !c || (i > 0 && c <= codes[i - 1])))
    throw new Error("Invalid term order");
  return codes;
}
