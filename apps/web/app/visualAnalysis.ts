export type VisualAnalysisResult = {
  perceptualHash: string;
  dominantColors: string[];
  width: number;
  height: number;
};

export async function analyzeImageUrl(imageUrl: string): Promise<VisualAnalysisResult> {
  const response = await fetch(imageUrl, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed with HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Expected an image but received ${blob.type || "an unknown type"}.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("The browser could not decode this image.");
  }

  try {
    const palettePixels = drawPixels(bitmap, 64, 64);
    const hashPixels = drawPixels(bitmap, 8, 8);
    return {
      perceptualHash: averageHashFromRgba(hashPixels.data),
      dominantColors: dominantColorsFromRgba(palettePixels.data, 5),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

export function averageHashFromRgba(data: Uint8ClampedArray) {
  if (data.length !== 8 * 8 * 4) {
    throw new Error("Average hash requires an 8×8 RGBA sample.");
  }

  const grayscale: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    grayscale.push(
      Math.round(data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114),
    );
  }
  const average = grayscale.reduce((sum, value) => sum + value, 0) / grayscale.length;
  let bits = "";
  for (const value of grayscale) bits += value >= average ? "1" : "0";

  let hex = "";
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}

export function dominantColorsFromRgba(
  data: Uint8ClampedArray,
  limit = 5,
) {
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
    .slice(0, Math.max(1, Math.min(8, limit)))
    .map((entry) =>
      rgbToHex(
        Math.round(entry.red / entry.count),
        Math.round(entry.green / entry.count),
        Math.round(entry.blue / entry.count),
      ),
    );
}

export function hammingDistanceHex(left: string, right: string) {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) {
    throw new Error("Perceptual hashes must be hexadecimal.");
  }
  if (left.length !== right.length) {
    throw new Error("Perceptual hashes must have equal length.");
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let value = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    while (value > 0) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function drawPixels(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas image analysis is unavailable.");
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}
