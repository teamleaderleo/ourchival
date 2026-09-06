/** OTG scored tags: v1 uint32 IDs, v2 unsigned LEB128 ID deltas.
 * Float64 scores remain lossless. Choose v2 only when it is smaller. */
export function encodeTags(
  entries: Array<[number, number]>,
  version?: 1 | 2,
): ArrayBuffer {
  if (entries.length > 4096) throw new Error("Too many tags");
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  let previous = 0;
  const deltas: number[][] = [];
  for (const [code, score] of sorted) {
    if (
      !Number.isInteger(code) ||
      code <= previous ||
      code > 0xffffffff ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      throw new Error("Invalid tag payload");
    let delta = code - previous;
    const bytes: number[] = [];
    do {
      const byte = delta % 128;
      delta = Math.floor(delta / 128);
      bytes.push(byte + (delta ? 128 : 0));
    } while (delta);
    deltas.push(bytes);
    previous = code;
  }
  const fixedSize = 8 + sorted.length * 12;
  const deltaSize =
    8 + sorted.length * 8 + deltas.reduce((n, d) => n + d.length, 0);
  const selected = version ?? (deltaSize < fixedSize ? 2 : 1);
  const buffer = new ArrayBuffer(selected === 1 ? fixedSize : deltaSize);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4f544700 + selected);
  view.setUint32(4, sorted.length);
  let offset = 8;
  sorted.forEach(([code, score], i) => {
    if (selected === 1) {
      view.setUint32(offset, code);
      offset += 4;
    } else for (const byte of deltas[i]) view.setUint8(offset++, byte);
    view.setFloat64(offset, score);
    offset += 8;
  });
  return buffer;
}

export function decodeTags(buffer: ArrayBuffer): Array<[number, number]> {
  if (buffer.byteLength < 8) throw new Error("Truncated tag payload");
  const view = new DataView(buffer),
    count = view.getUint32(4);
  const version = view.getUint32(0) - 0x4f544700;
  if (
    (version !== 1 && version !== 2) ||
    count > 4096 ||
    (version === 1 && buffer.byteLength !== 8 + count * 12)
  )
    throw new Error("Unknown or invalid tag payload");
  const entries: Array<[number, number]> = [];
  let previous = 0,
    offset = 8;
  for (let i = 0; i < count; i++) {
    let code: number;
    if (version === 1) {
      code = view.getUint32(offset);
      offset += 4;
    } else {
      let delta = 0,
        place = 1;
      for (let n = 0; ; n++) {
        if (n === 5 || offset >= buffer.byteLength)
          throw new Error("Truncated or oversized tag delta");
        const byte = view.getUint8(offset++);
        delta += (byte & 127) * place;
        if (!(byte & 128)) {
          if ((n > 0 && byte === 0) || delta === 0 || delta > 0xffffffff)
            throw new Error("Noncanonical tag delta");
          break;
        }
        place *= 128;
      }
      code = previous + delta;
    }
    if (offset + 8 > buffer.byteLength) throw new Error("Truncated tag score");
    const score = view.getFloat64(offset);
    offset += 8;
    if (
      code <= previous ||
      code > 0xffffffff ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    )
      throw new Error("Invalid tag payload");
    entries.push([code, score]);
    previous = code;
  }
  if (offset !== buffer.byteLength)
    throw new Error("Trailing tag payload bytes");
  return entries;
}
