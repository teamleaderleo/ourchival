export function moveBatchBody(
  moves: Array<{ id: string; parent: string }>,
  root: string,
  boundary: string,
) {
  if (moves.length > 100) throw new Error("Drive batch exceeds 100 files");
  return (
    moves
      .map((move, index) =>
        [
          `--${boundary}`,
          "Content-Type: application/http",
          `Content-ID: <move-${index}>`,
          "",
          `PATCH /drive/v3/files/${encodeURIComponent(move.id)}?${new URLSearchParams({ addParents: move.parent, removeParents: root, fields: "id,parents" })} HTTP/1.1`,
          "Content-Type: application/json",
          "",
          "{}",
        ].join("\r\n"),
      )
      .join("\r\n") + `\r\n--${boundary}--\r\n`
  );
}
export function verifiedBatchMoves(
  text: string,
  contentType: string,
  moves: Array<{ id: string; parent: string }>,
  root: string,
) {
  const boundary = contentType.match(/boundary="?([^";\s]+)/i)?.[1];
  if (!boundary) throw new Error("Missing Drive response boundary");
  const verified = new Set<string>();
  for (const part of text.split(`--${boundary}`)) {
    if (!/HTTP\/1\.[01] 200\b/.test(part)) continue;
    const start = part.indexOf("{");
    if (start < 0) continue;
    try {
      const body = JSON.parse(part.slice(start).trim());
      const move = moves.find((m) => m.id === body.id);
      if (
        move &&
        Array.isArray(body.parents) &&
        body.parents.includes(move.parent) &&
        !body.parents.includes(root)
      )
        verified.add(move.id);
    } catch {
      /* A malformed part is not a verified move. */
    }
  }
  return moves.filter((m) => verified.has(m.id));
}

export function batchHttpStatuses(text: string) {
  const counts: Record<string, number> = {};
  for (const match of text.matchAll(/HTTP\/1\.[01] (\d{3})\b/g))
    counts[match[1]!] = (counts[match[1]!] ?? 0) + 1;
  return counts;
}

export function readBatchBody(ids: string[], boundary: string) {
  if (ids.length > 100) throw new Error("Drive batch exceeds 100 files");
  return (
    ids
      .map(
        (id, index) =>
          `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <read-${index}>\r\n\r\nGET /drive/v3/files/${encodeURIComponent(id)}?fields=id%2Cparents%2Ctrashed HTTP/1.1\r\n\r\n`,
      )
      .join("") + `--${boundary}--\r\n`
  );
}

export function batchFileParents(
  text: string,
  contentType: string,
  ids: string[],
) {
  const boundary = contentType.match(/boundary="?([^";\s]+)/i)?.[1];
  if (!boundary) throw new Error("Missing Drive response boundary");
  const files: Array<{ id: string; parent: string }> = [];
  for (const part of text.split(`--${boundary}`)) {
    if (!/HTTP\/1\.[01] 200\b/.test(part)) continue;
    const start = part.indexOf("{");
    if (start < 0) continue;
    try {
      const body = JSON.parse(part.slice(start).trim());
      if (
        ids.includes(body.id) &&
        body.trashed !== true &&
        Array.isArray(body.parents) &&
        body.parents.length === 1 &&
        typeof body.parents[0] === "string"
      )
        files.push({ id: body.id, parent: body.parents[0] });
    } catch {
      /* Missing metadata remains unresolved. */
    }
  }
  return files;
}
