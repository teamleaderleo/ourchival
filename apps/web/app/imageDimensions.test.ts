import { expect, it, vi } from "vitest";
import { rememberedDimensions, rememberDimensions } from "./imageDimensions";

it("remembers natural proportions without replacing them with a square or a clamp", () => {
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem });
  try {
    rememberDimensions("portrait", 400, 2400);
    expect(rememberedDimensions("portrait")).toEqual({ width: 400, height: 2400 });
    expect(setItem).toHaveBeenCalled();
    rememberDimensions("broken", 0, NaN);
    expect(rememberedDimensions("broken")).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});
