import { it, expect } from "vitest";
import {
  moveBatchBody,
  verifiedBatchMoves,
  readBatchBody,
  batchFileParents,
  batchHttpStatuses,
} from "./driveBatch";
it("batch requests preserve file IDs and only change the verified root parent", () => {
  const body = moveBatchBody([{ id: "file", parent: "target" }], "root", "b");
  expect(body).toContain(
    "PATCH /drive/v3/files/file?addParents=target&removeParents=root&fields=id%2Cparents HTTP/1.1",
  );
  expect(body).not.toContain("DELETE");
});

it("audits only requested file metadata and preserves per-file failures", () => {
  const text =
    '--b\r\nHTTP/1.1 200 OK\r\n\r\n{"id":"a","parents":["actual"]}\r\n--b\r\nHTTP/1.1 404 Not Found\r\n\r\n{}\r\n--b--';
  expect(
    batchFileParents(text, "multipart/mixed; boundary=b", ["a", "b"]),
  ).toEqual([{ id: "a", parent: "actual" }]);
  expect(
    batchFileParents(text, "multipart/mixed; boundary=b", ["other"]),
  ).toEqual([]);
  expect(batchHttpStatuses(text)).toEqual({ "200": 1, "404": 1 });
  expect(readBatchBody(["a"], "b")).toContain(
    "GET /drive/v3/files/a?fields=id%2Cparents%2Ctrashed HTTP/1.1",
  );
});
it("does not treat trashed files as usable catalog locations", () => {
  const text = '--b\r\nHTTP/1.1 200 OK\r\n\r\n{"id":"a","parents":["folder"],"trashed":true}\r\n--b--';
  expect(batchFileParents(text, "multipart/mixed; boundary=b", ["a"])).toEqual([]);
});
it("requires each response to verify the requested destination and removed root", () => {
  const moves = [
    { id: "a", parent: "dest" },
    { id: "b", parent: "dest" },
    { id: "c", parent: "dest" },
  ];
  const body =
    [
      'HTTP/1.1 200 OK\r\n\r\n{"id":"a","parents":["dest"]}',
      "HTTP/1.1 403 Forbidden\r\n\r\n{}",
      'HTTP/1.1 200 OK\r\n\r\n{"id":"c","parents":["dest","root"]}',
    ]
      .map((s) => "--b\r\n" + s + "\r\n")
      .join("") + "--b--";
  expect(
    verifiedBatchMoves(body, "multipart/mixed; boundary=b", moves, "root"),
  ).toEqual([moves[0]]);
});
