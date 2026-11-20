// The World Bulletin — Friday 20 November 2026.
// One-page newspaper front page drawn entirely from code.
// Pure Node stdlib only: no Python, no child processes, no network,
// no external files or font files. Deterministic: same bytes every run.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

export const W = 1024;
export const H = 1024;

// ---------- palette ----------
const PAPER: [number, number, number] = [242, 233, 214];
const INK: [number, number, number] = [20, 17, 14];
const RED: [number, number, number] = [198, 42, 26];
const TEAL: [number, number, number] = [16, 118, 108];
const FAINT: [number, number, number] = [90, 80, 66];

// ---------- seeded random (deterministic) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- pixel canvas ----------
const buf = new Uint8Array(W * H * 3);
function fillPaper(): void {
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = PAPER[0]; buf[i * 3 + 1] = PAPER[1]; buf[i * 3 + 2] = PAPER[2];
  }
}

function px(x: number, y: number, c: [number, number, number], a = 1): void {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const o = (yi * W + xi) * 3;
  if (a >= 1) { buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
  else {
    buf[o] = Math.round(buf[o] * (1 - a) + c[0] * a);
    buf[o + 1] = Math.round(buf[o + 1] * (1 - a) + c[1] * a);
    buf[o + 2] = Math.round(buf[o + 2] * (1 - a) + c[2] * a);
  }
}

function fillRect(x: number, y: number, w: number, h: number, c: [number, number, number], a = 1): void {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(xx, yy, c, a);
}

function hline(x: number, y: number, w: number, th: number, c: [number, number, number]): void {
  fillRect(x, y - th / 2, w, th, c);
}
function vline(x: number, y: number, h: number, th: number, c: [number, number, number]): void {
  fillRect(x - th / 2, y, th, h, c);
}

// filled circle
function disc(cx: number, cy: number, r: number, c: [number, number, number], a = 1): void {
  if (r <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= r2) px(x, y, c, a);
  }
}

// filled ellipse
function ellipse(cx: number, cy: number, rx: number, ry: number, c: [number, number, number], a = 1): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) px(x, y, c, a);
  }
}

// thick line with round caps (swept discs)
function line(x1: number, y1: number, x2: number, y2: number, w: number, c: [number, number, number], a = 1): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w * 0.35)));
  const r = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + dx * t, y1 + dy * t, r, c, a);
  }
}

// polyline through points, round joins
function polyline(pts: number[], w: number, c: [number, number, number], a = 1): void {
  for (let i = 0; i + 3 < pts.length; i += 2) line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w, c, a);
}

// filled polygon (scanline)
function polygon(pts: number[], c: [number, number, number], a = 1): void {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length / 2;
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x1 = pts[i * 2], y1p = pts[i * 2 + 1];
      const x2 = pts[((i + 1) % n) * 2], y2p = pts[((i + 1) % n) * 2 + 1];
      if ((y1p <= y && y2p > y) || (y2p <= y && y1p > y)) {
        xs.push(x1 + ((y - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) px(x, y, c, a);
    }
  }
}

// ellipse outline: sample perimeter, join with thick lines
function ellipseOutline(cx: number, cy: number, rx: number, ry: number, w: number, c: [number, number, number], a = 1): void {
  const steps = 48;
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    pts.push(cx + rx * Math.cos(t), cy - ry * Math.sin(t));
  }
  polyline(pts, w, c, a);
}

// arc outline: angles in degrees, 0 = east, counter-clockwise in y-up space
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, w: number, c: [number, number, number], a = 1): void {
  const span = Math.abs(a1 - a0);
  const steps = Math.max(4, Math.ceil(span / 6));
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push(cx + rx * Math.cos(t), cy - ry * Math.sin(t));
  }
  polyline(pts, w, c, a);
}

// points along an arc (y-up space), for building glyph paths
function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = 14): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  }
  return pts;
}

// ---------- PNG encoder (hand-written, zlib deflate) ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- vector glyphs ----------
// Glyph space: units, y up, baseline 0, cap top 700, x-height 480, descender -220.
// Ops: L line, E filled ellipse, O ellipse outline, A arc (y-up degrees),
// P filled polygon, S serif bar (skipped in sans mode), D filled disc, T polyline path.
type Op = unknown[];
const L = (x1: number, y1: number, x2: number, y2: number, w: number): Op => ["L", x1, y1, x2, y2, w];
const E = (cx: number, cy: number, rx: number, ry: number): Op => ["E", cx, cy, rx, ry];
const O = (cx: number, cy: number, rx: number, ry: number, w: number): Op => ["O", cx, cy, rx, ry, w];
const A = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, w: number): Op => ["A", cx, cy, rx, ry, a0, a1, w];
const P = (pts: number[]): Op => ["P", pts];
const S = (x: number, y: number, len: number, th: number): Op => ["S", x, y, len, th];
const D = (cx: number, cy: number, r: number): Op => ["D", cx, cy, r];
const T = (pts: number[], w: number): Op => ["T", pts, w];

// Smooth two-bowl S: the top bowl ends at the centre and the bottom bowl
// starts at the centre, so both bowls stay open toward the middle and the
// letter can never close into an 8 or an O.
function sCurve(cx: number, cyTop: number, cyBot: number, rx: number, ry: number, w: number): Op[] {
  return [
    A(cx, cyTop, rx, ry, 25, 270, w),
    A(cx, cyBot, rx, ry, 90, -155, w),
  ];
}

type Glyph = { adv: number; ops: Op[] };
const GLYPHS: Record<string, Glyph> = {};

GLYPHS["A"] = { adv: 640, ops: [L(80, 0, 330, 700, 120), L(580, 0, 330, 700, 120), L(200, 260, 460, 260, 95), S(80, 0, 160, 60), S(580, 0, 160, 60)] };
GLYPHS["B"] = { adv: 620, ops: [L(110, 0, 110, 700, 120), L(110, 700, 330, 700, 90), L(110, 340, 340, 340, 90), L(110, 0, 340, 0, 90), A(330, 520, 200, 180, 90, -90, 110), A(340, 170, 210, 170, 90, -90, 110)] };
GLYPHS["C"] = { adv: 620, ops: [A(340, 350, 230, 350, 55, 305, 120)] };
GLYPHS["D"] = { adv: 600, ops: [L(110, 0, 110, 700, 120), A(110, 350, 260, 350, 90, -90, 120), L(110, 700, 150, 700, 90), L(110, 0, 150, 0, 90)] };
GLYPHS["E"] = { adv: 580, ops: [L(110, 0, 110, 700, 120), L(110, 700, 540, 700, 95), L(110, 350, 460, 350, 90), L(110, 0, 540, 0, 95), S(110, 0, 140, 60)] };
GLYPHS["F"] = { adv: 560, ops: [L(110, 0, 110, 700, 120), L(110, 700, 540, 700, 95), L(110, 350, 460, 350, 90), S(110, 0, 140, 60)] };
GLYPHS["G"] = { adv: 640, ops: [A(340, 350, 230, 350, 55, 305, 120), L(380, 350, 560, 350, 95), L(560, 350, 560, 190, 100)] };
GLYPHS["H"] = { adv: 640, ops: [L(120, 0, 120, 700, 120), L(520, 0, 520, 700, 120), L(120, 350, 520, 350, 100), S(120, 0, 150, 60), S(520, 0, 150, 60), S(120, 700, 150, 60), S(520, 700, 150, 60)] };
GLYPHS["I"] = { adv: 420, ops: [L(210, 0, 210, 700, 115), L(90, 700, 330, 700, 85), L(90, 0, 330, 0, 85)] };
GLYPHS["J"] = { adv: 520, ops: [L(420, 700, 420, 150, 115), A(300, 150, 120, 150, 0, -180, 110), L(300, 700, 540, 700, 85)] };
GLYPHS["K"] = { adv: 620, ops: [L(110, 0, 110, 700, 120), L(330, 350, 540, 700, 110), L(300, 380, 540, 0, 110), S(110, 0, 150, 60)] };
GLYPHS["L"] = { adv: 560, ops: [L(110, 0, 110, 700, 120), L(110, 0, 540, 0, 95), S(110, 0, 150, 60), S(110, 700, 150, 60)] };
GLYPHS["M"] = { adv: 660, ops: [L(90, 0, 90, 700, 115), L(570, 0, 570, 700, 115), L(90, 700, 330, 120, 110), L(570, 700, 330, 120, 110), S(90, 0, 140, 60), S(570, 0, 140, 60)] };
GLYPHS["N"] = { adv: 640, ops: [L(110, 0, 110, 700, 120), L(530, 0, 530, 700, 120), L(110, 700, 530, 0, 110), S(110, 0, 150, 60), S(530, 0, 150, 60)] };
GLYPHS["O"] = { adv: 660, ops: [O(330, 350, 220, 350, 120)] };
GLYPHS["P"] = { adv: 600, ops: [L(110, 0, 110, 700, 120), L(110, 700, 330, 700, 90), L(110, 340, 330, 340, 90), A(330, 520, 200, 180, 90, -90, 110)] };
GLYPHS["Q"] = { adv: 660, ops: [O(320, 350, 220, 350, 120), L(420, 200, 570, -60, 100)] };
GLYPHS["R"] = { adv: 620, ops: [L(110, 0, 110, 700, 120), L(110, 700, 330, 700, 90), L(110, 340, 330, 340, 90), A(330, 520, 200, 180, 90, -90, 110), L(330, 340, 560, 0, 110)] };
GLYPHS["S"] = { adv: 620, ops: [...sCurve(320, 500, 200, 195, 160, 120)] };
GLYPHS["T"] = { adv: 600, ops: [L(80, 700, 560, 700, 95), L(320, 0, 320, 700, 120), S(320, 0, 150, 60)] };
GLYPHS["U"] = { adv: 640, ops: [L(110, 700, 110, 180, 120), L(530, 700, 530, 180, 120), A(320, 180, 210, 180, 180, 360, 120), S(110, 700, 150, 60), S(530, 700, 150, 60)] };
GLYPHS["V"] = { adv: 640, ops: [L(80, 700, 320, 0, 120), L(560, 700, 320, 0, 120), S(80, 700, 140, 60), S(560, 700, 140, 60)] };
GLYPHS["W"] = { adv: 680, ops: [T([60, 700, 185, 0, 310, 480, 435, 0, 560, 700], 115), S(60, 700, 130, 60), S(560, 700, 130, 60)] };
GLYPHS["X"] = { adv: 620, ops: [L(110, 700, 530, 0, 115), L(530, 700, 110, 0, 115)] };
GLYPHS["Y"] = { adv: 620, ops: [L(110, 700, 320, 340, 115), L(530, 700, 320, 340, 115), L(320, 340, 320, 0, 115), S(320, 0, 150, 60)] };
GLYPHS["Z"] = { adv: 600, ops: [L(110, 700, 530, 700, 95), L(530, 700, 110, 0, 110), L(110, 0, 530, 0, 95)] };

// ---------- lowercase ----------
GLYPHS["a"] = { adv: 540, ops: [O(300, 170, 145, 160, 100), L(450, 0, 450, 480, 105), A(300, 350, 150, 100, 15, 165, 95)] };
GLYPHS["b"] = { adv: 560, ops: [L(110, 0, 110, 700, 110), O(310, 180, 160, 170, 100)] };
GLYPHS["c"] = { adv: 520, ops: [A(320, 240, 170, 240, 50, 310, 105)] };
GLYPHS["d"] = { adv: 580, ops: [O(300, 180, 160, 170, 100), L(470, 0, 470, 700, 110)] };
GLYPHS["e"] = { adv: 540, ops: [A(310, 240, 165, 230, 40, 320, 100), L(150, 240, 470, 240, 90)] };
GLYPHS["f"] = { adv: 480, ops: [L(330, 0, 330, 600, 105), A(330, 600, 120, 120, 0, 180, 100), L(210, 480, 450, 480, 80)] };
GLYPHS["g"] = { adv: 560, ops: [O(300, 320, 140, 140, 100), O(300, 10, 150, 170, 100), L(440, 460, 440, -160, 100)] };
GLYPHS["h"] = { adv: 580, ops: [L(110, 0, 110, 700, 110), L(110, 480, 290, 480, 90), A(290, 330, 180, 150, 90, 0, 100), L(470, 0, 470, 480, 105)] };
GLYPHS["i"] = { adv: 320, ops: [L(160, 0, 160, 480, 105), D(160, 620, 55)] };
GLYPHS["j"] = { adv: 360, ops: [L(180, 0, 180, 480, 105), A(110, 60, 90, 100, 0, -180, 100), D(180, 620, 55)] };
GLYPHS["k"] = { adv: 540, ops: [L(110, 0, 110, 700, 110), L(320, 240, 480, 480, 100), L(290, 270, 480, 0, 100)] };
GLYPHS["l"] = { adv: 320, ops: [L(160, 0, 160, 700, 110)] };
GLYPHS["m"] = { adv: 820, ops: [L(100, 0, 100, 480, 105), L(100, 480, 250, 480, 85), A(250, 330, 150, 150, 90, 0, 95), L(400, 0, 400, 480, 100), L(400, 480, 550, 480, 85), A(550, 330, 150, 150, 90, 0, 95), L(700, 0, 700, 480, 100)] };
GLYPHS["n"] = { adv: 580, ops: [L(110, 0, 110, 480, 110), L(110, 480, 290, 480, 90), A(290, 330, 180, 150, 90, 0, 100), L(470, 0, 470, 480, 105)] };
GLYPHS["o"] = { adv: 560, ops: [O(300, 240, 170, 240, 100)] };
GLYPHS["p"] = { adv: 560, ops: [L(110, -220, 110, 480, 110), O(310, 180, 160, 170, 100)] };
GLYPHS["q"] = { adv: 580, ops: [O(300, 180, 160, 170, 100), L(470, -220, 470, 480, 110)] };
GLYPHS["r"] = { adv: 440, ops: [L(110, 0, 110, 480, 110), L(110, 480, 260, 480, 85), A(260, 380, 120, 100, 90, 0, 95)] };
GLYPHS["s"] = { adv: 500, ops: [...sCurve(305, 360, 140, 130, 105, 85)] };
GLYPHS["t"] = { adv: 420, ops: [L(210, 0, 210, 620, 105), L(100, 420, 320, 420, 80), L(210, 0, 320, 0, 80)] };
GLYPHS["u"] = { adv: 540, ops: [L(110, 480, 110, 120, 110), L(430, 480, 430, 120, 110), A(270, 120, 160, 120, 180, 360, 105)] };
GLYPHS["v"] = { adv: 540, ops: [L(90, 480, 270, 0, 105), L(450, 480, 270, 0, 105)] };
GLYPHS["w"] = { adv: 580, ops: [T([60, 480, 170, 0, 270, 340, 370, 0, 480, 480], 95)] };
GLYPHS["x"] = { adv: 520, ops: [L(110, 480, 430, 0, 100), L(430, 480, 110, 0, 100)] };
GLYPHS["y"] = { adv: 540, ops: [L(90, 480, 270, 60, 105), L(450, 480, 270, 60, 105), L(270, 60, 170, -200, 100)] };
GLYPHS["z"] = { adv: 520, ops: [L(110, 480, 430, 480, 85), L(430, 480, 110, 0, 100), L(110, 0, 430, 0, 85)] };

// ---------- digits: full closed bowls; 9 bowl on top, 6 bowl at bottom ----------
GLYPHS["0"] = { adv: 620, ops: [O(320, 350, 210, 350, 110)] };
GLYPHS["1"] = { adv: 560, ops: [L(240, 620, 380, 700, 100), L(380, 700, 380, 0, 110), L(220, 0, 520, 0, 90)] };
GLYPHS["2"] = { adv: 620, ops: [A(320, 520, 200, 180, 20, 200, 110), L(132, 458, 520, 0, 110), L(120, 0, 540, 0, 90)] };
GLYPHS["3"] = { adv: 620, ops: [A(320, 500, 185, 150, 300, 420, 110), A(320, 200, 195, 160, 300, 420, 110), L(413, 370, 418, 339, 100)] };
GLYPHS["4"] = { adv: 620, ops: [L(430, 700, 150, 140, 100), L(120, 180, 520, 180, 90), L(430, 700, 430, 0, 110)] };
GLYPHS["5"] = { adv: 620, ops: [L(140, 700, 500, 700, 100), L(140, 700, 140, 430, 100), L(140, 430, 160, 300, 95), A(320, 210, 185, 180, 150, 390, 110)] };
GLYPHS["6"] = { adv: 620, ops: [O(320, 180, 185, 180, 110), A(320, 430, 185, 200, 60, 195, 110)] };
GLYPHS["7"] = { adv: 600, ops: [L(120, 700, 520, 700, 100), L(520, 700, 250, 0, 110)] };
GLYPHS["8"] = { adv: 620, ops: [O(320, 510, 170, 165, 105), O(320, 185, 185, 175, 105)] };
GLYPHS["9"] = { adv: 620, ops: [O(320, 520, 185, 180, 110), L(505, 700, 505, 40, 110)] };

// ---------- punctuation ----------
GLYPHS["."] = { adv: 300, ops: [D(150, 35, 65)] };
GLYPHS[","] = { adv: 300, ops: [D(150, 60, 65), L(150, 40, 90, -180, 70)] };
GLYPHS[":"] = { adv: 300, ops: [D(150, 480, 65), D(150, 120, 65)] };
GLYPHS[";"] = { adv: 300, ops: [D(150, 480, 65), D(150, 60, 65), L(150, 40, 90, -180, 70)] };
GLYPHS["'"] = { adv: 300, ops: [L(190, 700, 120, 480, 90)] };
GLYPHS["’"] = { adv: 300, ops: [L(190, 700, 120, 480, 90)] };
GLYPHS['"'] = { adv: 420, ops: [L(140, 700, 80, 520, 80), L(320, 700, 260, 520, 80)] };
GLYPHS["!"] = { adv: 320, ops: [L(160, 700, 160, 180, 110), D(160, 60, 70)] };
GLYPHS["?"] = { adv: 520, ops: [A(320, 520, 170, 160, 20, 200, 105), L(132, 458, 330, 260, 100), D(300, 60, 70)] };
GLYPHS["&"] = { adv: 640, ops: [A(340, 480, 150, 140, 0, 200, 100), L(480, 480, 160, 0, 100), A(320, 180, 140, 130, 180, 360, 100)] };
GLYPHS["$"] = { adv: 620, ops: [...sCurve(320, 510, 210, 175, 145, 105), L(320, 700, 320, 0, 80)] };
GLYPHS["%"] = { adv: 700, ops: [O(200, 560, 110, 110, 90), O(440, 140, 110, 110, 90), L(520, 700, 120, 0, 90)] };
GLYPHS["°"] = { adv: 320, ops: [O(160, 600, 100, 100, 90)] };
GLYPHS["·"] = { adv: 300, ops: [D(150, 420, 55)] };
GLYPHS["-"] = { adv: 480, ops: [L(120, 300, 520, 300, 90)] };
GLYPHS["–"] = { adv: 480, ops: [L(120, 300, 520, 300, 90)] };
GLYPHS["—"] = { adv: 640, ops: [L(60, 300, 580, 300, 90)] };
GLYPHS["("] = { adv: 340, ops: [A(520, 350, 160, 350, 110, 250, 100)] };
GLYPHS[")"] = { adv: 340, ops: [A(120, 350, 160, 350, -70, 70, 100)] };
GLYPHS["/"] = { adv: 400, ops: [L(280, 700, 120, 0, 90)] };
GLYPHS["="] = { adv: 560, ops: [L(120, 420, 520, 420, 90), L(120, 240, 520, 240, 90)] };
GLYPHS["+"] = { adv: 560, ops: [L(120, 350, 520, 350, 90), L(320, 140, 320, 560, 90)] };
GLYPHS["*"] = { adv: 500, ops: [L(250, 280, 250, 680, 80), L(80, 380, 420, 580, 80), L(420, 380, 80, 580, 80)] };
GLYPHS[" "] = { adv: 300, ops: [] };
GLYPHS["\u00a0"] = { adv: 300, ops: [] };

// ---------- text engine ----------
type Style = {
  color: [number, number, number];
  weight: number; // stroke width multiplier
  italic?: boolean;
  sans?: boolean;
  tracking?: number; // extra px between letters
};

function drawGlyph(ch: string, x: number, baselineY: number, size: number, st: Style): number {
  const g = GLYPHS[ch];
  if (!g) return size * 0.4;
  const sc = size / 700;
  const shear = st.italic ? 0.18 : 0;
  const wmul = st.weight;
  for (const op of g.ops) {
    const k = op[0] as string;
    if (k === "S" && st.sans) continue; // sans has no serifs
    // transform one unit point (y up) to screen point (y down), with italic shear
    const P2 = (ux: number, uy: number): [number, number] => [
      x + ux * sc + uy * sc * shear,
      baselineY - uy * sc,
    ];
    if (k === "L") {
      const [, x1, y1, x2, y2, w] = op as [string, number, number, number, number, number];
      const [ax, ay] = P2(x1, y1), [bx, by] = P2(x2, y2);
      line(ax, ay, bx, by, Math.max(1, w * sc * wmul), st.color);
    } else if (k === "E") {
      const [, cx, cy, rx, ry] = op as [string, number, number, number, number];
      const [ax, ay] = P2(cx, cy);
      ellipse(ax, ay, rx * sc, ry * sc, st.color);
    } else if (k === "O") {
      const [, cx, cy, rx, ry, w] = op as [string, number, number, number, number, number];
      const [ax, ay] = P2(cx, cy);
      ellipseOutline(ax, ay, rx * sc, ry * sc, Math.max(1, w * sc * wmul), st.color);
    } else if (k === "A") {
      const [, cx, cy, rx, ry, a0, a1, w] = op as [string, number, number, number, number, number, number, number];
      const [ax, ay] = P2(cx, cy);
      arc(ax, ay, rx * sc, ry * sc, a0, a1, Math.max(1, w * sc * wmul), st.color);
    } else if (k === "P") {
      const [, pts] = op as [string, number[]];
      const sp: number[] = [];
      for (let i = 0; i < pts.length; i += 2) { const [ax, ay] = P2(pts[i], pts[i + 1]); sp.push(ax, ay); }
      polygon(sp, st.color);
    } else if (k === "S") {
      const [, sx, sy, len, th] = op as [string, number, number, number, number];
      const [ax, ay] = P2(sx, sy);
      hline(ax - (len * sc) / 2, ay, len * sc, Math.max(1, th * sc * wmul), st.color);
    } else if (k === "D") {
      const [, cx, cy, r] = op as [string, number, number, number];
      const [ax, ay] = P2(cx, cy);
      disc(ax, ay, r * sc, st.color);
    } else if (k === "T") {
      const [, pts, w] = op as [string, number[], number];
      const sp: number[] = [];
      for (let i = 0; i < pts.length; i += 2) { const [ax, ay] = P2(pts[i], pts[i + 1]); sp.push(ax, ay); }
      polyline(sp, Math.max(1, w * sc * wmul), st.color);
    }
  }
  return g.adv * sc + (st.tracking ?? 0);
}

function textWidth(s: string, size: number, st: Style): number {
  let w = 0;
  for (const ch of s) {
    const g = GLYPHS[ch];
    w += (g ? g.adv : size * 0.4) * (size / 700) + (st.tracking ?? 0);
  }
  return w;
}

function drawText(s: string, x: number, baselineY: number, size: number, st: Style): number {
  let cx = x;
  for (const ch of s) cx += drawGlyph(ch, cx, baselineY, size, st);
  return cx;
}

function drawTextCentered(s: string, cx: number, baselineY: number, size: number, st: Style): void {
  drawText(s, cx - textWidth(s, size, st) / 2, baselineY, size, st);
}

// wrap words to max width; returns lines
function wrapText(s: string, maxW: number, size: number, st: Style): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, size, st) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// draw a wrapped block; returns y just below the last baseline
function drawBlock(s: string, x: number, baselineY: number, maxW: number, size: number, lh: number, st: Style): number {
  const lines = wrapText(s, maxW, size, st);
  let y = baselineY;
  for (const ln of lines) { drawText(ln, x, y, size, st); y += lh; }
  return y;
}

// ---------- styles ----------
const SERIF_BODY: Style = { color: INK, weight: 0.72 };
const SERIF_DECK: Style = { color: INK, weight: 0.8, italic: true };
const SERIF_HEAD: Style = { color: INK, weight: 1.12 };
const SERIF_MAST: Style = { color: INK, weight: 1.05, tracking: 1 };
const SANS_BOLD: Style = { color: INK, weight: 0.95, sans: true };
const SANS_RED: Style = { color: RED, weight: 0.95, sans: true };
const SANS_TEAL: Style = { color: TEAL, weight: 0.95, sans: true };

// ---------- illustrations ----------
function drawPalm(x: number, groundY: number, h: number, c: [number, number, number]): void {
  const topX = x + 6, topY = groundY - h;
  line(x, groundY, topX, topY, 4, c);
  for (let i = 0; i < 5; i++) {
    const a0 = -160 + i * 38;
    const a1 = a0 + 55;
    const pts: number[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = ((a0 + ((a1 - a0) * k) / 6) * Math.PI) / 180;
      const r = 16 + k * 1.6;
      pts.push(topX + r * Math.cos(t), topY - r * Math.sin(t) * 0.55);
    }
    polyline(pts, 3, c);
  }
}

function drawLeadBand(x0: number, y0: number, x1: number, y1: number): void {
  // halftone red dots in the sky, denser and larger near the top
  const rnd = mulberry32(20261120);
  for (let yy = y0 + 4; yy < y0 + 44; yy += 11) {
    const t = (yy - y0) / 44;
    const r = 2.9 - t * 1.7;
    for (let xx = x0 + 6; xx < x1 - 4; xx += 13) {
      if (rnd() < 0.92) disc(xx + (rnd() - 0.5) * 3, yy, r, RED, 0.85);
    }
  }
  // striped red sun, right side
  const sx = x1 - 92, sy = y0 + 34, sr = 30;
  disc(sx, sy, sr, RED);
  for (let i = 0; i < 3; i++) {
    const by = sy - 14 + i * 12;
    fillRect(sx - sr, by, sr * 2, 5, PAPER);
  }
  // skyline silhouette with lit windows
  const buildings: Array<[number, number, number]> = [
    [0, 34, 46], [52, 52, 40], [98, 44, 34], [138, 62, 42], [186, 48, 36],
    [228, 70, 44], [278, 40, 38], [322, 56, 40], [368, 46, 34], [408, 66, 46],
    [460, 50, 38], [504, 74, 42], [552, 44, 36], [594, 60, 40], [640, 48, 38],
    [684, 68, 44], [734, 42, 36], [776, 58, 40], [822, 46, 38], [866, 64, 42],
    [910, 40, 34], [950, 54, 22],
  ];
  for (const [bx, bh, bw] of buildings) {
    fillRect(x0 + bx, y1 - bh, bw, bh, INK);
    for (let wy = y1 - bh + 8; wy < y1 - 6; wy += 11) {
      for (let wx = x0 + bx + 7; wx < x0 + bx + bw - 5; wx += 11) {
        if (rnd() < 0.45) fillRect(wx, wy, 3, 4, PAPER, 0.9);
      }
    }
  }
  // white car on the street
  const cx = x0 + 590, cy = y1 - 12;
  polygon([cx, cy, cx, cy - 9, cx + 12, cy - 9, cx + 20, cy - 16, cx + 46, cy - 16, cx + 54, cy - 9, cx + 66, cy - 9, cx + 66, cy], PAPER);
  disc(cx + 16, cy, 5, PAPER); disc(cx + 50, cy, 5, PAPER);
  disc(cx + 16, cy, 2, INK); disc(cx + 50, cy, 2, INK);
  // palms at both edges
  drawPalm(x0 + 14, y1, 52, INK);
  drawPalm(x1 - 22, y1, 46, INK);
  // birds
  polyline([x0 + 210, y0 + 22, x0 + 216, y0 + 27, x0 + 222, y0 + 22], 2, INK);
  polyline([x0 + 300, y0 + 14, x0 + 305, y0 + 18, x0 + 310, y0 + 14], 2, INK);
}

function drawGlobe(cx: number, cy: number, r: number): void {
  ellipseOutline(cx, cy, r, r, 3, INK);
  ellipseOutline(cx, cy, r * 0.45, r, 2, INK);
  ellipseOutline(cx, cy, r, r * 0.45, 2, INK);
  line(cx - r, cy, cx + r, cy, 2, INK);
  disc(cx + r * 0.4, cy - r * 0.35, 2.5, RED);
  disc(cx - r * 0.3, cy + r * 0.4, 2.5, RED);
}

function drawScales(cx: number, cy: number): void {
  // courthouse columns behind
  vline(cx - 34, cy - 14, 30, 3, INK);
  vline(cx + 34, cy - 14, 30, 3, INK);
  polygon([cx - 42, cy - 14, cx + 42, cy - 14, cx, cy - 24], INK);
  // scales
  vline(cx, cy - 12, 26, 3, INK);
  hline(cx - 20, cy - 10, 40, 3, INK);
  line(cx - 20, cy - 10, cx - 26, cy + 2, 2, INK);
  line(cx - 20, cy - 10, cx - 14, cy + 2, 2, INK);
  line(cx + 20, cy - 10, cx + 14, cy + 2, 2, INK);
  line(cx + 20, cy - 10, cx + 26, cy + 2, 2, INK);
  arc(cx - 20, cy + 2, 7, 5, 0, -180, 2, INK);
  arc(cx + 20, cy + 2, 7, 5, 0, -180, 2, INK);
  disc(cx, cy - 14, 3, RED);
}

function drawCyclone(cx: number, cy: number): void {
  for (let i = 0; i < 4; i++) {
    const r = 5 + i * 4;
    arc(cx, cy, r, r, 20 + i * 40, 300 + i * 40, 2.5, INK);
  }
  disc(cx, cy, 3, RED);
  line(cx - 22, cy + 18, cx - 26, cy + 26, 2, INK);
  line(cx, cy + 20, cx - 3, cy + 28, 2, INK);
  line(cx + 22, cy + 18, cx + 19, cy + 26, 2, INK);
}

function drawSpacecraft(x: number, y: number): void {
  fillRect(x + 28, y + 8, 26, 12, INK);
  fillRect(x + 4, y + 10, 20, 8, INK);
  fillRect(x + 58, y + 10, 20, 8, INK);
  line(x + 54, y + 8, x + 66, y - 2, 2, INK);
  disc(x + 67, y - 3, 2.5, RED);
  disc(x + 8, y - 4, 1.5, INK); disc(x + 74, y + 2, 1.5, INK); disc(x + 84, y + 16, 1.5, INK);
}

function drawEmbassy(x: number, y: number): void {
  fillRect(x + 8, y + 14, 62, 34, INK);
  for (let wy = y + 20; wy < y + 42; wy += 9) {
    for (let wx = x + 14; wx < x + 64; wx += 11) fillRect(wx, wy, 4, 5, PAPER, 0.9);
  }
  vline(x + 20, y - 6, 20, 2, INK);
  vline(x + 58, y - 6, 20, 2, INK);
  polygon([x + 20, y - 6, x + 34, y - 6, x + 20, y + 2], RED);
  polygon([x + 58, y - 6, x + 72, y - 6, x + 58, y + 2], TEAL);
}

// ---------- paper grain ----------
function grain(): void {
  const rnd = mulberry32(20261120);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * W, y = rnd() * H;
    px(x, y, INK, 0.05 + rnd() * 0.07);
  }
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * W, y = rnd() * H;
    px(x, y, RED, 0.03 + rnd() * 0.04);
  }
}

// ---------- layout ----------
function main(): void {
  fillPaper();
  // frame
  hline(10, 10, W - 20, 2, INK); hline(10, H - 12, W - 20, 2, INK);
  vline(10, 10, H - 20, 2, INK); vline(W - 12, 10, H - 20, 2, INK);
  hline(16, 16, W - 32, 1, INK); hline(16, H - 18, W - 32, 1, INK);
  vline(16, 16, H - 32, 1, INK); vline(W - 18, 16, H - 32, 1, INK);

  // masthead
  drawTextCentered("THE WORLD BULLETIN", 512, 98, 56, SERIF_MAST);
  hline(26, 110, 972, 2, INK);

  // date line: No. 001 left, date centred, no price anywhere
  drawText("No. 001", 26, 136, 18, SANS_BOLD);
  drawTextCentered("FRIDAY, 20 NOVEMBER 2026", 512, 136, 18, SANS_BOLD);
  hline(26, 146, 972, 2, INK);
  hline(26, 150, 972, 1, INK);

  // weather strip + opinion
  drawText("WEATHER: VICE CITY 28° · NEW YORK 12° · LONDON 9°", 26, 170, 14, SANS_TEAL);
  const op = "OPINION: RECORDS KEEP FALLING";
  drawText(op, 998 - textWidth(op, 14, SANS_BOLD), 170, 14, SANS_BOLD);

  // lead kicker + headline
  drawText("GAMES", 26, 192, 18, SANS_RED);
  drawText("GTA VI SALES TOP", 26, 252, 56, SERIF_HEAD);
  drawText("$1.8BN", 26, 320, 56, SERIF_HEAD);
  drawText("Rockstar's Vice City epic passes The Odyssey's global run in a day.", 26, 348, 16, SERIF_DECK);
  drawBlock("Grand Theft Auto VI has sold past $1.80 billion worldwide, passing The Odyssey's global run. Players queued around the block as Vice City opened its doors.", 26, 372, 972, 14, 17, SERIF_BODY);

  // lead illustration + caption
  drawLeadBand(26, 398, 998, 494);
  drawText("Vice City at dusk: the biggest game launch in history keeps breaking records.", 26, 516, 13, SERIF_DECK);
  hline(26, 528, 972, 2, INK);

  // three columns
  const cols = [
    { x: 26, label: "DIPLOMACY", head: "Trump Delays Iran Call To 2027", deck: "President says he will see what happens after Jan 1; no rush on war decision.", body: "President Donald Trump said he is in no rush on Iran and pushed any decision on war to 2027.", illo: "globe" },
    { x: 362, label: "JUSTICE", head: "Court: Myanmar Genocide", deck: "UN court rules army likely meant to destroy Rohingya in 2017 crackdown.", body: "The International Court of Justice ruled Myanmar's military likely intended to destroy a substantial part of the Rohingya minority.", illo: "scales" },
    { x: 698, label: "WEATHER", head: "Akvan Landfall: 300,000 Out", deck: "Three lakh evacuated as storm reaches Odisha; 423 rescue teams on standby.", body: "Cyclone Akvan made landfall on the Odisha coast as three lakh people were moved to safety.", illo: "cyclone" },
  ];
  vline(344, 536, 262, 1, INK);
  vline(680, 536, 262, 1, INK);
  for (const c of cols) {
    drawText(c.label, c.x, 556, 16, SANS_RED);
    const icx = c.x + 150;
    if (c.illo === "globe") drawGlobe(icx, 578, 16);
    else if (c.illo === "scales") drawScales(icx, 578);
    else drawCyclone(icx, 576);
    let y = drawBlock(c.head, c.x, 626, 300, 23, 28, SERIF_HEAD);
    y = drawBlock(c.deck, c.x, y + 6, 300, 13, 18, SERIF_DECK);
    drawBlock(c.body, c.x, y + 4, 300, 13, 17, SERIF_BODY);
  }
  hline(26, 805, 972, 2, INK);

  // bottom row: two stories, illustration left, text right
  const bottom = [
    { x: 26, label: "SPACE", head: "Hayabusa2 Landing Off", deck: "Engine trouble forces Japan's probe to scrap its asteroid touchdown.", body: "Japan's Hayabusa2 probe will skip its planned asteroid landing after engine trouble, space officials said.", illo: "craft" },
    { x: 533, label: "CONFLICT", head: "Kyiv Strikes Hit Embassies", deck: "Russian strikes damage Austrian and Dutch embassies in Kyiv.", body: "Russian strikes on Kyiv damaged the Austrian and Dutch embassies, officials said, as the war grinds on.", illo: "embassy" },
  ];
  vline(512, 813, 158, 1, INK);
  for (const b of bottom) {
    if (b.illo === "craft") drawSpacecraft(b.x, 830);
    else drawEmbassy(b.x, 828);
    const tx = b.x + 96;
    drawText(b.label, tx, 831, 15, SANS_RED);
    let y = drawBlock(b.head, tx, 861, 369, 23, 27, SERIF_HEAD);
    y = drawBlock(b.deck, tx, y + 4, 369, 13, 17, SERIF_DECK);
    drawBlock(b.body, tx, y + 4, 369, 13, 17, SERIF_BODY);
  }

  // footer
  drawTextCentered("All six stories first reported on 20 November 2026 · The World Bulletin · Page 1", 512, 1000, 13, SANS_BOLD);

  grain();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), encodePNG());
}

main();
