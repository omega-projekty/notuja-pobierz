// Generuje ikony aplikacji i zasobnika bez zależności (własny enkoder PNG + ICO).
// Znak „Fala” jak w src/components/common/brand.tsx: grafitowy kafelek (ciągła krzywizna rogów) i N z 5 pasków.
// Uruchom: npm run icons. render() i encodeIco() są eksportowane (z nich powstaje też public/favicon.ico).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TILE_TOP = [0x18, 0x18, 0x1d];
const TILE_BOTTOM = [0x0e, 0x0e, 0x11];
const WHITE = [255, 255, 255];
const RED = [0xe5, 0x2b, 0x2b];

/** Paski znaku [x, y, szerokość, wysokość] w jednostkach znaku 38,1 × 38 (brand.tsx). */
const GLYPH = [
  [0, 0, 5.4, 38],
  [8.4, 0, 5.1, 19],
  [16.5, 7.4, 5.1, 23.2],
  [24.6, 19, 5.1, 19],
  [32.7, 0, 5.4, 38],
];

/** Kafelek 64 × 64 z brand.tsx (TILE): punkt startu i 8 krzywych Béziera. */
const TILE_CURVES = [
  [[32, 0], [49.6, 0], [56, 0], [60, 4]],
  [[60, 4], [64, 8], [64, 14.4], [64, 32]],
  [[64, 32], [64, 49.6], [64, 56], [60, 60]],
  [[60, 60], [56, 64], [49.6, 64], [32, 64]],
  [[32, 64], [14.4, 64], [8, 64], [4, 60]],
  [[4, 60], [0, 56], [0, 49.6], [0, 32]],
  [[0, 32], [0, 14.4], [0, 8], [4, 4]],
  [[4, 4], [8, 0], [14.4, 0], [32, 0]],
];

const TILE_POLY = TILE_CURVES.flatMap(([a, b, c, d]) =>
  Array.from({ length: 64 }, (_, i) => {
    const t = i / 64;
    const u = 1 - t;
    return [
      u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0],
      u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1],
    ];
  }),
);

/** Połowa szerokości kafelka na wysokości y (jednostki 0..64); kształt wypukły i symetryczny względem x = 32. */
function tileHalfWidth(y) {
  let right = -1;
  for (let i = 0; i < TILE_POLY.length; i++) {
    const [x1, y1] = TILE_POLY[i];
    const [x2, y2] = TILE_POLY[(i + 1) % TILE_POLY.length];
    if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) right = Math.max(right, x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  return right < 0 ? -1 : right - 32;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * PNG size × size. pad: margines wokół kafelka (ułamek boku; macOS wymaga 100/1024),
 * glyph: wysokość znaku jako ułamek kafelka (małe rozmiary większy znak), rec: czerwona kropka nagrywania.
 */
function render(size, { pad = 0, glyph = 0.62, rec = false } = {}) {
  const ss = size >= 256 ? 3 : 8;
  const off = size * pad;
  const tile = size - 2 * off;
  const k = tile / 64;
  const g = (glyph * tile) / 38;
  const gx = off + (tile - 38.1 * g) / 2;
  const gy = off + (tile - 38 * g) / 2;
  const bars = GLYPH.map(([x, y, w, h]) => ({
    cx: gx + (x + w / 2) * g,
    r: (w / 2) * g,
    y0: gy + (y + w / 2) * g,
    y1: gy + (y + h - w / 2) * g,
  }));
  const dot = { cx: size * 0.73, cy: size * 0.73, r: size * 0.25, ring: size * 0.32 };

  // Połowa szerokości kafelka dla każdego podwiersza próbkowania.
  const spans = new Float64Array(size * ss);
  for (let j = 0; j < size * ss; j++) {
    const y = (j + 0.5) / ss;
    spans[j] = y < off || y > off + tile ? -1 : tileHalfWidth((y - off) / k) * k;
  }

  const sample = (x, y, j) => {
    if (rec) {
      const d = Math.hypot(x - dot.cx, y - dot.cy);
      if (d <= dot.r) return RED;
      if (d <= dot.ring) return WHITE;
    }
    if (Math.abs(x - size / 2) > spans[j]) return null;
    for (const b of bars) {
      const dy = y - Math.min(Math.max(y, b.y0), b.y1);
      if ((x - b.cx) ** 2 + dy * dy <= b.r * b.r) return WHITE;
    }
    const t = Math.min(1, Math.max(0, (y - off) / tile));
    return TILE_TOP.map((c, i) => c + (TILE_BOTTOM[i] - c) * t);
  };

  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let gr = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        const j = py * ss + sy;
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(px + (sx + 0.5) / ss, (j + 0.5) / ss, j);
          if (!c) continue;
          r += c[0];
          gr += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(gr / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((255 * a) / (ss * ss));
    }
  }
  return encodePng(size, out);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

/** Na małych rozmiarach znak zajmuje więcej kafelka, żeby paski nie zlały się w szarą plamę. */
const small = (size) => ({ glyph: size <= 64 ? 0.66 : 0.58 });

function main() {
  const root = path.join(__dirname, '..');
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets, { recursive: true });

  // macOS (z icon.png powstaje .icns): kafelek 824/1024 z marginesem jak inne ikony w Docku.
  fs.writeFileSync(path.join(__dirname, 'icon.png'), render(1024, { pad: 100 / 1024, glyph: 0.58 }));
  fs.writeFileSync(
    path.join(__dirname, 'icon.ico'),
    encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: render(size, small(size)) }))),
  );
  fs.writeFileSync(path.join(assets, 'icon.png'), render(256, small(256)));
  fs.writeFileSync(path.join(assets, 'tray.png'), render(16, small(16)));
  fs.writeFileSync(path.join(assets, 'tray@2x.png'), render(32, small(32)));
  fs.writeFileSync(path.join(assets, 'tray-rec.png'), render(16, { ...small(16), rec: true }));
  fs.writeFileSync(path.join(assets, 'tray-rec@2x.png'), render(32, { ...small(32), rec: true }));
  console.log('Ikony zapisane w build/ i assets/.');
}

module.exports = { render, encodeIco, small };
if (require.main === module) main();
