// Generates build/icon.png — a 256x256 clock face on a rounded indigo square.
// Written by hand rather than pulled in as a dependency: one PNG does not
// justify adding an image library to a project that is trying to stay small.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 256;
const px = new Uint8Array(S * S * 4);

const ACCENT = [79, 70, 229];
const FACE = [255, 255, 255];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Signed distance to a rounded square centred on the canvas. */
function roundedSquare(x, y, half, radius) {
  const dx = Math.abs(x - S / 2) - (half - radius);
  const dy = Math.abs(y - S / 2) - (half - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function blend(i, colour, alpha) {
  for (let c = 0; c < 3; c++) {
    px[i + c] = Math.round(px[i + c] * (1 - alpha) + colour[c] * alpha);
  }
  px[i + 3] = Math.round(px[i + 3] * (1 - alpha) + 255 * alpha);
}

// Distance from a point to a line segment, for the clock hands.
function distToSegment(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const t = clamp01(((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy));
}

const cx = S / 2;
const cy = S / 2;
const faceR = 78;

// 10:10 reads as a clock at a glance, which 12:00 does not.
const hourAngle = (-60 * Math.PI) / 180;
const minuteAngle = (60 * Math.PI) / 180;
const hand = (angle, length) => [
  cx + Math.sin(angle) * length,
  cy - Math.cos(angle) * length,
];
const [hx, hy] = hand(hourAngle, 40);
const [mx, my] = hand(minuteAngle, 56);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const sx = x + 0.5;
    const sy = y + 0.5;

    // Body, antialiased over one pixel.
    blend(i, ACCENT, clamp01(0.5 - roundedSquare(sx, sy, 120, 46)));

    // Clock face ring.
    const ring = Math.abs(Math.hypot(sx - cx, sy - cy) - faceR);
    blend(i, FACE, clamp01(0.5 - (ring - 8)));

    // Hands and hub.
    const handDist = Math.min(
      distToSegment(sx, sy, cx, cy, hx, hy),
      distToSegment(sx, sy, cx, cy, mx, my),
    );
    blend(i, FACE, clamp01(0.5 - (handDist - 7)));
    blend(i, FACE, clamp01(0.5 - (Math.hypot(sx - cx, sy - cy) - 12)));
  }
}

// ── PNG container ──────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

// Each scanline is prefixed with its filter type; 0 means none.
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

writeFileSync(
  process.argv[2],
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

console.log(`wrote ${process.argv[2]} (${S}x${S})`);
