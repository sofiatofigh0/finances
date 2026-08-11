/**
 * Generates the PWA / Add-to-Home-Screen icon set as real PNG files.
 *
 * Written by hand (zlib + CRC32) so the repo has no image-toolchain
 * dependency. Run with: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// Spendable ink + surface, matched to the app's light-mode tokens.
const BG = [26, 27, 32, 255];
const FG = [250, 250, 251, 255];

/**
 * A chunky "S" on a 12x16 grid. 1 = glyph pixel.
 * Drawn deliberately wide-stroked so it stays legible at 96px.
 */
const GLYPH = [
  "001111111100",
  "011111111110",
  "111100000111",
  "111000000011",
  "111000000000",
  "011100000000",
  "001111100000",
  "000111111000",
  "000001111100",
  "000000011110",
  "000000000111",
  "110000000111",
  "111000000111",
  "011110001110",
  "011111111100",
  "001111111000",
];

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = buildTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (crc ^ buf[i]) & 0xff;
    crc = (crc >>> 8) ^ table[c];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);

  // Background.
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = BG[3];
  }

  // A maskable icon needs its content inside the safe zone (80% centre), so
  // the launcher can crop to a circle without clipping the glyph.
  const scale = maskable ? 0.44 : 0.58;
  const glyphH = Math.round(size * scale);
  const cell = Math.max(1, Math.round(glyphH / GLYPH.length));
  const glyphHeight = cell * GLYPH.length;
  const glyphWidth = cell * GLYPH[0].length;
  const offsetX = Math.round((size - glyphWidth) / 2);
  const offsetY = Math.round((size - glyphHeight) / 2);

  for (let gy = 0; gy < GLYPH.length; gy += 1) {
    for (let gx = 0; gx < GLYPH[gy].length; gx += 1) {
      if (GLYPH[gy][gx] !== "1") continue;
      for (let dy = 0; dy < cell; dy += 1) {
        for (let dx = 0; dx < cell; dx += 1) {
          const x = offsetX + gx * cell + dx;
          const y = offsetY + gy * cell + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const i = (y * size + x) * 4;
          rgba[i] = FG[0];
          rgba[i + 1] = FG[1];
          rgba[i + 2] = FG[2];
          rgba[i + 3] = FG[3];
        }
      }
    }
  }

  return encodePng(size, size, rgba);
}

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-192.png", size: 192, maskable: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "favicon-32.png", size: 32 },
];

for (const target of targets) {
  const png = renderIcon(target.size, { maskable: target.maskable });
  writeFileSync(join(outDir, target.file), png);
  console.log(`wrote public/icons/${target.file} (${png.length} bytes)`);
}
