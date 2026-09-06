import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../apps/web/public/archive-cat.png", import.meta.url));
const output = fileURLToPath(new URL("../apps/extension/public/icons/", import.meta.url));
await mkdir(output, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(source).trim().resize(size, size, {
    fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toFile(`${output}/cat-${size}.png`);
}
