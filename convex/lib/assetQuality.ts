export type AssetQuality = "original" | "degraded" | "unknown";

/** Storage is not evidence of rendition. Old rows without a fetched URL stay unknown. */
export function assetQuality(asset: {
  fetchedUrl?: string;
  quality?: string;
}): AssetQuality {
  if (!asset.fetchedUrl) return "unknown";
  try {
    const url = new URL(asset.fetchedUrl);
    if (/(^|\.)pinimg\.com$/.test(url.hostname)) {
      return url.pathname.startsWith("/originals/") ? "original" : "degraded";
    }
    if (/(^|\.)pximg\.net$/.test(url.hostname)) {
      return url.pathname.startsWith("/img-original/")
        ? "original"
        : "degraded";
    }
    if (url.hostname === "pbs.twimg.com") {
      return url.searchParams.get("name") === "orig" ||
        url.pathname.endsWith(":orig")
        ? "original"
        : "degraded";
    }
  } catch {
    /* Invalid evidence never proves an original. */
  }
  return "unknown";
}

export function completeImageResponse(response: Response) {
  if (!response.ok) return false;
  if (response.status !== 206) return true;
  const range = response.headers
    .get("content-range")
    ?.match(/^bytes 0-(\d+)\/(\d+)$/);
  return Boolean(range && Number(range[1]) + 1 === Number(range[2]));
}

/** Decodes intrinsic dimensions without platform-specific image libraries. */
export function imageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (
    bytes.length >= 24 &&
    v.getUint32(0) === 0x89504e47 &&
    text(12, 4) === "IHDR"
  ) {
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length >= 10 && /GIF8[79]a/.test(text(0, 6))) {
    return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const uint24 = (p: number) =>
      bytes[p]! + (bytes[p + 1]! << 8) + (bytes[p + 2]! << 16);
    if (text(12, 4) === "VP8X")
      return { width: uint24(24) + 1, height: uint24(27) + 1 };
    if (
      text(12, 4) === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      return {
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
      };
    }
    if (text(12, 4) === "VP8L" && bytes[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }
  if (bytes.length > 4 && v.getUint16(0) === 0xffd8) {
    for (let p = 2; p + 8 < bytes.length;) {
      if (bytes[p] !== 0xff) break;
      const marker = bytes[p + 1]!;
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const length = v.getUint16(p + 2);
      if (length < 2 || p + 2 + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        return { width: v.getUint16(p + 7), height: v.getUint16(p + 5) };
      }
      p += 2 + length;
    }
  }
  return undefined;
}
