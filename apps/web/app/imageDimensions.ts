type Dimensions = { width: number; height: number };
const key = "ourchival.image-dimensions.v1";
let cache: Record<string, Dimensions> | undefined;
function dimensions() {
  if (!cache) {
    try { cache = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { cache = {}; }
  }
  return cache ?? {};
}
export function rememberedDimensions(id: string): Dimensions | undefined {
  const value = dimensions()[id];
  return value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0 ? value : undefined;
}
export function rememberDimensions(id: string, width: number, height: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return;
  const values = dimensions();
  values[id] = { width, height };
  cache = Object.fromEntries(Object.entries(values).slice(-2048));
  try { localStorage.setItem(key, JSON.stringify(cache)); } catch { /* A private browser may disable storage. */ }
}
