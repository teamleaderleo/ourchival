/** OTG v1, shared with workers/visual/tag_codec.py. Float64 scores are lossless. */
export function encodeTags(entries: Array<[number, number]>): ArrayBuffer {
  if (entries.length > 4096) throw new Error("Too many tags");
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const buffer = new ArrayBuffer(8 + sorted.length * 12);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4f544701);
  view.setUint32(4, sorted.length);
  let previous = 0;
  sorted.forEach(([code, score], i) => {
    if (
      !Number.isInteger(code) ||
      code <= previous ||
      code > 0xffffffff ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      throw new Error("Invalid tag payload");
    view.setUint32(8 + i * 12, code);
    view.setFloat64(12 + i * 12, score);
    previous = code;
  });
  return buffer;
}

export function decodeTags(buffer: ArrayBuffer): Array<[number, number]> {
  if (buffer.byteLength < 8) throw new Error("Truncated tag payload");
  const view = new DataView(buffer),
    count = view.getUint32(4);
  if (
    view.getUint32(0) !== 0x4f544701 ||
    count > 4096 ||
    buffer.byteLength !== 8 + count * 12
  )
    throw new Error("Unknown or invalid tag payload");
  const entries: Array<[number, number]> = [];
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const code = view.getUint32(8 + i * 12),
      score = view.getFloat64(12 + i * 12);
    if (code <= previous || !Number.isFinite(score) || score < 0 || score > 1)
      throw new Error("Invalid tag payload");
    entries.push([code, score]);
    previous = code;
  }
  return entries;
}
