export function averageHashFromGrayscale(data: Uint8Array) {
  if (data.length !== 64) {
    throw new Error("Average hash requires an 8×8 grayscale sample.");
  }

  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  let bits = "";
  for (const value of data) bits += value >= average ? "1" : "0";

  let hex = "";
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}

export function dominantColorsFromRgba(data: Uint8Array, limit = 5) {
  if (data.length % 4 !== 0) {
    throw new Error("Dominant color analysis requires RGBA pixels.");
  }

  const bins = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 0;
    if (alpha < 128) continue;

    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    const key = `${red >> 4}:${green >> 4}:${blue >> 4}`;
    const current = bins.get(key) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    current.count += 1;
    current.red += red;
    current.green += green;
    current.blue += blue;
    bins.set(key, current);
  }

  return Array.from(bins.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.max(1, Math.min(8, Math.floor(limit))))
    .map((entry) =>
      rgbToHex(
        Math.round(entry.red / entry.count),
        Math.round(entry.green / entry.count),
        Math.round(entry.blue / entry.count),
      ),
    );
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}
