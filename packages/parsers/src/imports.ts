export type ImportSourceKind = "onetab" | "bookmarks" | "url_list";

export type ImportRecord = {
  ordinal: number;
  submittedUrl: string;
  submittedTitle?: string;
  sourceGroup?: string;
};

export const IMPORT_PARSER_VERSIONS: Record<ImportSourceKind, string> = {
  onetab: "onetab-1",
  bookmarks: "bookmarks-html-1",
  url_list: "url-list-1",
};

export async function* parseImport(
  source: ImportSourceKind,
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<ImportRecord> {
  if (source === "bookmarks") {
    yield* parseBookmarks(chunks);
    return;
  }

  let ordinal = 0;
  for await (const line of decodedLines(chunks)) {
    const parsed =
      source === "onetab" ? parseOneTabLine(line) : parseUrlLine(line);
    if (!parsed) continue;
    yield { ordinal, ...parsed };
    ordinal += 1;
  }
}

export async function digestImport(
  source: ImportSourceKind,
  records: AsyncIterable<ImportRecord>,
) {
  const hasher = new Sha256();
  const encoder = new TextEncoder();
  const parserVersion = IMPORT_PARSER_VERSIONS[source];
  hasher.update(
    encoder.encode(`ourchival-import\0${source}\0${parserVersion}\0`),
  );
  let count = 0;
  for await (const record of records) {
    const fields = [
      String(record.ordinal),
      record.submittedUrl,
      record.submittedTitle ?? "",
      record.sourceGroup ?? "",
    ];
    for (const field of fields) {
      const bytes = encoder.encode(field);
      hasher.update(encoder.encode(`${bytes.length}:`));
      hasher.update(bytes);
      hasher.update(new Uint8Array([0]));
    }
    count += 1;
  }
  return { digest: hasher.hex(), count, parserVersion };
}

function parseOneTabLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(" | ");
  const url = (separator >= 0 ? trimmed.slice(0, separator) : trimmed).trim();
  const title = separator >= 0 ? trimmed.slice(separator + 3).trim() : "";
  return {
    submittedUrl: url,
    ...(title ? { submittedTitle: title } : {}),
  };
}

function parseUrlLine(line: string) {
  const url = line.trim();
  return url ? { submittedUrl: url } : null;
}

async function* parseBookmarks(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<ImportRecord> {
  const decoder = new TextDecoder();
  let buffer = "";
  let ordinal = 0;
  let text = "";
  let anchorUrl: string | undefined;
  let anchorText = "";
  let folderText = "";
  let pendingFolder: string | undefined;
  const folders: string[] = [];

  const processToken = (token: string) => {
    if (!token.startsWith("<")) {
      const decoded = decodeHtml(token);
      if (anchorUrl !== undefined) anchorText += decoded;
      if (folderText !== "") folderText += decoded;
      return undefined;
    }
    const name = token.match(/^<\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
    const closing = /^<\//.test(token);
    if (name === "h3" && !closing) folderText = " ";
    if (name === "h3" && closing) {
      pendingFolder = folderText.trim() || undefined;
      folderText = "";
    }
    if (name === "dl" && !closing && pendingFolder) {
      folders.push(pendingFolder);
      pendingFolder = undefined;
    }
    if (name === "dl" && closing) folders.pop();
    if (name === "a" && !closing) {
      const href = token.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
      anchorUrl = href === undefined ? undefined : decodeHtml(href).trim();
      anchorText = "";
    }
    if (name === "a" && closing && anchorUrl !== undefined) {
      const url = anchorUrl;
      const title = anchorText.replace(/\s+/g, " ").trim();
      anchorUrl = undefined;
      anchorText = "";
      if (!url) return undefined;
      const record: ImportRecord = {
        ordinal,
        submittedUrl: url,
        ...(title ? { submittedTitle: title } : {}),
        ...(folders.length ? { sourceGroup: folders.join(" / ") } : {}),
      };
      ordinal += 1;
      return record;
    }
    return undefined;
  };

  for await (const chunk of chunks) {
    buffer +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    while (buffer.length > 0) {
      const tagStart = buffer.indexOf("<");
      if (tagStart < 0) {
        text = buffer;
        buffer = "";
        processToken(text);
        break;
      }
      if (tagStart > 0) {
        processToken(buffer.slice(0, tagStart));
        buffer = buffer.slice(tagStart);
      }
      const tagEnd = buffer.indexOf(">");
      if (tagEnd < 0) break;
      const record = processToken(buffer.slice(0, tagEnd + 1));
      buffer = buffer.slice(tagEnd + 1);
      if (record) yield record;
    }
  }
  buffer += decoder.decode();
  if (buffer) processToken(buffer);
}

async function* decodedLines(chunks: AsyncIterable<Uint8Array | string>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of chunks) {
    buffer +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer.replace(/\r$/, "");
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (_match, code: string) => {
      if (/^#x/i.test(code))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return named[code.toLowerCase()] ?? `&${code};`;
    },
  );
}

class Sha256 {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;

  update(data: Uint8Array) {
    this.bytesHashed += data.length;
    let position = 0;
    while (position < data.length) {
      const take = Math.min(64 - this.bufferLength, data.length - position);
      this.buffer.set(
        data.subarray(position, position + take),
        this.bufferLength,
      );
      this.bufferLength += take;
      position += take;
      if (this.bufferLength === 64) {
        this.compress(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  hex() {
    const bitLength = this.bytesHashed * 8;
    this.buffer[this.bufferLength++] = 0x80;
    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength);
      this.compress(this.buffer);
      this.bufferLength = 0;
    }
    this.buffer.fill(0, this.bufferLength, 56);
    const view = new DataView(this.buffer.buffer);
    view.setUint32(56, Math.floor(bitLength / 0x100000000));
    view.setUint32(60, bitLength >>> 0);
    this.compress(this.buffer);
    return Array.from(this.state)
      .map((word) => word.toString(16).padStart(8, "0"))
      .join("");
  }

  private compress(chunk: Uint8Array) {
    const k = SHA256_K;
    const w = new Uint32Array(64);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + s1 + ch + k[i]! + w[i]!) >>> 0;
      const s0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const values = [a!, b!, c!, d!, e!, f!, g!, h!];
    for (let i = 0; i < 8; i += 1)
      this.state[i] = (this.state[i]! + values[i]!) >>> 0;
  }
}

function rotate(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
