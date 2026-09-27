#!/usr/bin/env node
/**
 * Generates the application icon with nothing but Node (zlib + a hand-written
 * PNG encoder). Output, all deterministic so re-running never dirties git:
 *
 *   build/icon.png      512×512  (Linux window icon, README)
 *   build/icon-256.png  256×256
 *   build/icon.ico      256/128/64/48/32/16, PNG-compressed entries (Windows)
 *
 * The emblem: a dark roundel with a brass rim, two teal rivers (Tigris from
 * the upper left, Euphrates from the upper right) flowing together at the
 * bottom into one stream, and a small brass crosshair between them.
 *
 * Everything is drawn from signed-distance functions in a [-1, 1]² space with
 * analytic anti-aliasing plus light supersampling, so every size is rendered
 * crisply rather than downscaled from the largest one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const BUILD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
export const ICO_SIZES = [256, 128, 64, 48, 32, 16];

// ---------------------------------------------------------------------------
// Palette (sRGB 0..1)
// ---------------------------------------------------------------------------

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const PALETTE = {
  fieldTop: rgb(0x1a2431),
  fieldBottom: rgb(0x0b0f14),
  brassLight: rgb(0xe9cc8a),
  brassMid: rgb(0xb9924f),
  brassDark: rgb(0x5f4520),
  riverEdge: rgb(0x0e6b64),
  river: rgb(0x14b8a6),
  riverCore: rgb(0x7ff3e3),
  reticle: rgb(0xefd9a0),
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const RIM_OUTER = 0.96;
const RIM_INNER = 0.86;
const CONFLUENCE = [0, 0.4];

/** Sample a cubic Bézier into a polyline of `n` segments, remembering `t` for width tapering. */
function cubic(p0, p1, p2, p3, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    pts.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], t]);
  }
  return pts;
}

/** A ribbon is a polyline plus a half-width function of the curve parameter. */
const RIBBONS = [
  // Tigris: enters from the upper left, bows outward, then bends in to the confluence.
  { pts: cubic([-0.62, -0.7], [-0.05, -0.45], [-0.56, 0.05], CONFLUENCE), width: (t) => 0.055 + 0.02 * t },
  // Euphrates: the mirror image from the upper right.
  { pts: cubic([0.62, -0.7], [0.05, -0.45], [0.56, 0.05], CONFLUENCE), width: (t) => 0.055 + 0.02 * t },
  // The joined stream (Shatt al-Arab) running to the bottom of the rim.
  { pts: cubic([0, 0.36], [0, 0.55], [0, 0.75], [0, 0.98]), width: () => 0.085 },
];

/** Distance from (x, y) to a polyline and the curve parameter at the closest point. */
function distanceToPolyline(pts, x, y) {
  let best = Infinity;
  let bestT = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, at] = pts[i];
    const [bx, by, bt] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let u = ((x - ax) * dx + (y - ay) * dy) / len2;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const ex = x - (ax + dx * u);
    const ey = y - (ay + dy * u);
    const d2 = ex * ex + ey * ey;
    if (d2 < best) {
      best = d2;
      bestT = at + (bt - at) * u;
    }
  }
  return [Math.sqrt(best), bestT];
}

/**
 * Signed distance to the union of the ribbons (negative inside) and, for
 * shading, how deep inside the closest ribbon the point is (0 at the edge,
 * 1 on the centre line).
 */
function riverField(x, y) {
  let sd = Infinity;
  let depth = 0;
  for (const ribbon of RIBBONS) {
    const [d, t] = distanceToPolyline(ribbon.pts, x, y);
    const w = ribbon.width(t);
    const s = d - w;
    if (s < sd) {
      sd = s;
      depth = Math.max(0, 1 - d / w);
    }
  }
  return [sd, depth];
}

/** Signed distance to an axis-aligned box centred at (cx, cy) with half extents (hx, hy). */
function boxSdf(x, y, cx, cy, hx, hy) {
  const qx = Math.abs(x - cx) - hx;
  const qy = Math.abs(y - cy) - hy;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0);
}

const RETICLE = { cx: 0, cy: -0.17, ring: 0.1, stroke: 0.026, tickFrom: 0.14, tickTo: 0.2, dot: 0.028 };

/** Signed distance to the crosshair (ring, four ticks, centre dot). */
function reticleSdf(x, y) {
  const { cx, cy, ring, stroke, tickFrom, tickTo, dot } = RETICLE;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  let sd = Math.abs(r - ring) - stroke / 2;
  const mid = (tickFrom + tickTo) / 2;
  const half = (tickTo - tickFrom) / 2;
  sd = Math.min(sd, boxSdf(dx, dy, 0, -mid, stroke / 2, half));
  sd = Math.min(sd, boxSdf(dx, dy, 0, mid, stroke / 2, half));
  sd = Math.min(sd, boxSdf(dx, dy, -mid, 0, half, stroke / 2));
  sd = Math.min(sd, boxSdf(dx, dy, mid, 0, half, stroke / 2));
  return Math.min(sd, r - dot);
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
/** Coverage of a shape given its signed distance, softened over one sub-pixel `aa`. */
const coverage = (sd, aa) => clamp01(0.5 - sd / aa);

/** Premultiplied source-over compositing into `out` ([r, g, b, a]). */
function over(out, color, alpha) {
  if (alpha <= 0) return;
  const k = 1 - alpha;
  out[0] = color[0] * alpha + out[0] * k;
  out[1] = color[1] * alpha + out[1] * k;
  out[2] = color[2] * alpha + out[2] * k;
  out[3] = alpha + out[3] * k;
}

/** Colour of the emblem at unit-space point (x, y); `aa` is the anti-aliasing width. */
function shade(x, y, aa, out) {
  out[0] = out[1] = out[2] = out[3] = 0;
  const r = Math.hypot(x, y);
  const discA = coverage(r - RIM_OUTER, aa);
  if (discA <= 0) return out;

  // Field: vertical gradient with a soft radial vignette.
  const vignette = 1 - 0.35 * smooth((r - 0.3) / 0.6);
  const field = mix(PALETTE.fieldBottom, PALETTE.fieldTop, clamp01((0.5 - y * 0.5) * vignette));
  over(out, field, discA);

  // Rivers, clipped to the inner field so they run "under" the rim.
  const [riverSd, depth] = riverField(x, y);
  const riverA = Math.min(coverage(riverSd, aa), coverage(r - (RIM_INNER + 0.01), aa));
  if (riverA > 0) {
    // Lit from the upper left: sample the depth a little towards the light to bias the bright core.
    const [, litDepth] = riverField(x + 0.02, y + 0.025);
    const body = mix(PALETTE.riverEdge, PALETTE.river, smooth(depth * 2.2));
    const color = mix(body, PALETTE.riverCore, 0.85 * Math.pow(litDepth, 2.2));
    over(out, color, riverA);
  }

  // Crosshair.
  const reticleA = coverage(reticleSdf(x, y), aa);
  if (reticleA > 0) over(out, PALETTE.reticle, reticleA);

  // Brass rim with a light-from-upper-left gradient and a dark bevel on both edges.
  const rimA = Math.min(coverage(r - RIM_OUTER, aa), coverage(RIM_INNER - r, aa));
  if (rimA > 0) {
    const light = clamp01(0.55 - (x + y) * 0.38);
    let brass = mix(PALETTE.brassDark, PALETTE.brassLight, smooth(light));
    // A brighter band a third of the way in reads as a polished edge.
    const band = Math.exp(-Math.pow((r - (RIM_INNER + 0.035)) / 0.018, 2));
    brass = mix(brass, PALETTE.brassLight, 0.35 * band * light);
    const bevel = Math.max(coverage(r - (RIM_INNER + 0.012), aa), coverage(RIM_OUTER - 0.012 - r, aa));
    brass = mix(brass, PALETTE.brassDark, 0.7 * bevel);
    over(out, brass, rimA);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

/** Render the emblem into straight-alpha RGBA8 at `size`×`size`. */
export function render(size) {
  const ss = size >= 256 ? 2 : size >= 96 ? 3 : 4; // supersamples per axis
  const pixel = 2 / size;
  const aa = pixel / ss;
  const out = new Uint8Array(size * size * 4);
  const acc = [0, 0, 0, 0];
  const sample = [0, 0, 0, 0];
  const inv = 1 / (ss * ss);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let sy = 0; sy < ss; sy++) {
        const y = -1 + (py + (sy + 0.5) / ss) * pixel;
        for (let sx = 0; sx < ss; sx++) {
          const x = -1 + (px + (sx + 0.5) / ss) * pixel;
          shade(x, y, aa, sample);
          acc[0] += sample[0];
          acc[1] += sample[1];
          acc[2] += sample[2];
          acc[3] += sample[3];
        }
      }
      const a = acc[3] * inv;
      const o = (py * size + px) * 4;
      if (a > 0) {
        // Un-premultiply for the PNG (which stores straight alpha).
        out[o] = Math.round(clamp01(acc[0] * inv / a) * 255);
        out[o + 1] = Math.round(clamp01(acc[1] * inv / a) * 255);
        out[o + 2] = Math.round(clamp01(acc[2] * inv / a) * 255);
        out[o + 3] = Math.round(a * 255);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Filter one scanline with each of the five PNG filters and keep the one with
 * the smallest sum of absolute values (the standard heuristic); it roughly
 * halves the deflated size of the smooth gradients in the emblem.
 */
function filterRow(cur, prev, bpp, out) {
  const n = cur.length;
  const candidates = new Array(5);
  const sums = new Array(5);
  for (let f = 0; f < 5; f++) {
    const buf = Buffer.alloc(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = cur[i]; break;
        case 1: v = cur[i] - a; break;
        case 2: v = cur[i] - b; break;
        case 3: v = cur[i] - ((a + b) >> 1); break;
        default: v = cur[i] - paeth(a, b, c);
      }
      v &= 0xff;
      buf[i] = v;
      sum += v < 128 ? v : 256 - v;
    }
    candidates[f] = buf;
    sums[f] = sum;
  }
  let best = 0;
  for (let f = 1; f < 5; f++) if (sums[f] < sums[best]) best = f;
  out.push(Buffer.from([best]), candidates[best]);
}

/** Encode straight-alpha RGBA8 pixels as an 8-bit RGBA PNG. */
export function encodePng(width, height, rgba) {
  const bpp = 4;
  const stride = width * bpp;
  const rows = [];
  let prev = null;
  for (let y = 0; y < height; y++) {
    const cur = Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride);
    filterRow(cur, prev, bpp, rows);
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO container (PNG-compressed entries, supported since Windows Vista)
// ---------------------------------------------------------------------------

export function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; // 0 means 256
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0; // palette colours
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateIcons(dir = BUILD_DIR) {
  mkdirSync(dir, { recursive: true });
  const pngAt = (size) => encodePng(size, size, render(size));
  const cache = new Map();
  const png = (size) => {
    if (!cache.has(size)) cache.set(size, pngAt(size));
    return cache.get(size);
  };
  const written = [];
  const write = (name, buf) => {
    writeFileSync(path.join(dir, name), buf);
    written.push({ name, bytes: buf.length });
  };
  write('icon.png', png(512));
  write('icon-256.png', png(256));
  write('icon.ico', encodeIco(ICO_SIZES.map((size) => ({ size, png: png(size) }))));
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  for (const { name, bytes } of generateIcons()) console.log(`icon: wrote build/${name} (${bytes} bytes)`);
  console.log(`icon: done in ${Date.now() - started} ms`);
}
