import { expect, it } from "vitest";
import { importReceipt } from "./importReceipt";
it("keeps unknown coverage distinct from zero and refuses legacy original claims", () => {
  expect(importReceipt('{"version":1,"originalsStored":100}')).toBeNull();
  expect(importReceipt("broken")).toBeNull();
  expect(importReceipt('{"version":2,"originalsStored":799,"imagePagesExpected":800,"unknownPageCountArtworks":320,"unresolved":3350}')).toMatchObject({ originals:799, expected:800, unknown:320, remaining:3350, degraded:null });
  expect(importReceipt('{"version":2,"originalsStored":-1}')).toMatchObject({ originals:null });
});
