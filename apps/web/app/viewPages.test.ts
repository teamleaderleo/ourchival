import { expect, it } from "vitest";
import { appendPage } from "./viewPages";

it("appends older pages without duplicating or reordering existing references", () => {
  const first = [{ _id: "a", title: "A" }, { _id: "b", title: "Old" }];
  const next = [{ _id: "b", title: "Updated" }, { _id: "c", title: "C" }];
  expect(appendPage(first, next)).toEqual([{ _id: "a", title: "A" }, { _id: "b", title: "Updated" }, { _id: "c", title: "C" }]);
  expect(first[1]?.title).toBe("Old");
});
