// Draws the app icon (a ticked ballot box in the header's primary blue) as SVG and as the PNG sizes browsers and
// install prompts ask for, with no image libraries: shapes are signed-distance functions, supersampled for
// anti-aliasing, and the PNGs are encoded with node:zlib. Run `node apps/web/scripts/make-icons.mjs` after changing it;
// the output in apps/web/public/icons is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BLUE = [0x19, 0x76, 0xd2]; // Quasar's primary, as in the header
const WHITE = [0xff, 0xff, 0xff];

// Geometry on a 512 × 512 canvas. Everything white stays inside the maskable safe zone (a circle of radius 204.8).
const BOX = { x: 136, y: 136, size: 240, radius: 40, stroke: 32 };
const TICK = { points: [[190, 258], [240, 308], [326, 206]], stroke: 40 };
const CORNER = 96; // background corner radius for the "any" icon; maskable icons fill the square

function svg({ maskable }) {
  const bg = maskable
    ? `<rect width="512" height="512" fill="#1976d2"/>`
    : `<rect width="512" height="512" rx="${CORNER}" fill="#1976d2"/>`;
  const [a, b, c] = TICK.points;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${bg}
  <rect x="${BOX.x}" y="${BOX.y}" width="${BOX.size}" height="${BOX.size}" rx="${BOX.radius}" fill="none" stroke="#fff" stroke-width="${BOX.stroke}"/>
  <path d="M${a} L${b} L${c}" fill="none" stroke="#fff" stroke-width="${TICK.stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

/** Signed distance from (px, py) to a rounded rectangle centred at (cx, cy). */
function roundRect(px, py, cx, cy, half, r) {
  const qx = Math.abs(px - cx) - half + r;
  const qy = Math.abs(py - cy) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segment(px, py, [ax, ay], [bx, by]) {
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

/** Coverage of [background, white] at a point on the 512 canvas. */
function sample(x, y, maskable) {
  const background = maskable ? true : roundRect(x, y, 256, 256, 256, CORNER) <= 0;
  const half = BOX.size / 2;
  const inBox = Math.abs(roundRect(x, y, BOX.x + half, BOX.y + half, half, BOX.radius)) <= BOX.stroke / 2;
  const [a, b, c] = TICK.points;
  const inTick = Math.min(segment(x, y, a, b), segment(x, y, b, c)) <= TICK.stroke / 2;
  return [background, inBox || inTick];
}

function rasterize(size, maskable) {
  const SS = 4; // 4 × 4 samples per pixel
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [b, f] = sample(((px + (sx + 0.5) / SS) * 512) / size, ((py + (sy + 0.5) / SS) * 512) / size, maskable);
          if (f) fg++;
          else if (b) bg++;
        }
      }
      const alpha = (bg + fg) / (SS * SS);
      const i = (py * size + px) * 4;
      for (let k = 0; k < 3; k++) rgba[i + k] = alpha ? Math.round((BLUE[k] * bg + WHITE[k] * fg) / (bg + fg)) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg({ maskable: false }));
writeFileSync(join(OUT, 'icon-maskable.svg'), svg({ maskable: true }));
for (const [name, size, maskable] of [
  ['favicon-32.png', 32, false],
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  // iOS draws its own rounded corners and shows transparency as black, so it gets the full square.
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(OUT, name), png(size, rasterize(size, maskable)));
}
console.log(`icons written to ${OUT}`);
