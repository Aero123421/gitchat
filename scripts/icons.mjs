// Draws the toolbar/store icons (the gitchat creature: an ink-dark glass bead with two eyes and a
// blue "unpushed" dot) and writes them as PNGs into src/icons/. No image libraries needed.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in a 0..1 unit square, painted back to front. Each returns coverage for a point.
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const pill = (cx, cy, w, h) => (x, y) => {
  const r = w / 2;
  const dy = Math.max(0, Math.abs(y - cy) - (h / 2 - r));
  return (x - cx) ** 2 + dy ** 2 <= r * r;
};
const layers = (size) => {
  // Eyes need at least ~1.3px width to read at 16px.
  const eyeW = Math.max(0.085, 1.3 / size);
  return [
    { test: circle(0.5, 0.5, 0.47), color: [24, 24, 27, 255] },
    { test: circle(0.5, 0.5, 0.47), ring: 0.035, color: [255, 255, 255, 60] },
    { test: pill(0.38, 0.45, eyeW, 0.24), color: [245, 245, 247, 255] },
    { test: pill(0.62, 0.45, eyeW, 0.24), color: [245, 245, 247, 255] },
    { test: circle(0.7, 0.73, Math.max(0.065, 1.1 / size)), color: [10, 132, 255, 255] },
  ];
};

function render(size) {
  const ss = 8;
  const buf = Buffer.alloc(size * size * 4);
  const ls = layers(size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          let cr = 0,
            cg = 0,
            cb = 0,
            ca = 0;
          for (const l of ls) {
            let hit = l.test(x, y);
            if (hit && l.ring) hit = !circle(0.5, 0.5, 0.47 - l.ring)(x, y);
            if (!hit) continue;
            const la = l.color[3] / 255;
            cr = l.color[0] * la + cr * (1 - la);
            cg = l.color[1] * la + cg * (1 - la);
            cb = l.color[2] * la + cb * (1 - la);
            ca = la + ca * (1 - la);
          }
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      buf[i] = alpha ? Math.round(r / n / alpha) : 0;
      buf[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      buf[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(outDir, `${size}.png`), png(size, render(size)));
}
console.log('icons written to src/icons/');
