export function masonryWindow(
  heights: number[],
  top: number,
  viewport: number,
  overscan = 800,
) {
  const offsets = [0];
  for (const height of heights)
    offsets.push(offsets[offsets.length - 1]! + Math.max(1, height));
  const lower = Math.max(0, top - overscan);
  const upper = Math.max(0, top + viewport + overscan);
  let start = 0;
  while (start < heights.length && offsets[start + 1]! < lower) start++;
  let end = start;
  while (end < heights.length && offsets[end]! <= upper) end++;
  return { start, end, offsets, total: offsets[offsets.length - 1]! };
}
