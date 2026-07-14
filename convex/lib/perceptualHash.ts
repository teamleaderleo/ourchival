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

export function sharedPaletteColors(left: string[], right: string[]) {
  const rightSet = new Set(right.map(normalizeColor));
  return Array.from(new Set(left.map(normalizeColor))).filter((color) =>
    rightSet.has(color),
  );
}

function normalizeColor(value: string) {
  return value.trim().toLocaleLowerCase();
}
