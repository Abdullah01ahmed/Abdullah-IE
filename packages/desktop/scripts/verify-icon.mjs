#!/usr/bin/env node
/**
 * Validates the generated icons without any image library:
 *   - every PNG has the right signature, a well-formed IHDR (8-bit RGBA, the
 *     expected size), correct chunk CRCs, and IDAT data that inflates and
 *     unfilters to exactly width*height*4 bytes;
 *   - the pixels look like the emblem (transparent corners, opaque centre);
 *   - the ICO has a valid header and one PNG-compressed 32-bit entry per size,
 *     each pointing at an in-bounds PNG whose dimensions match the directory.
 * Exits 1 with a message on the first problem.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { BUILD_DIR, ICO_SIZES, crc32 } from './make-icon.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) {
  console.error(`verify-icon: FAIL ${message}`);
  process.exit(1);
}

function assert(cond, message) {
  if (!cond) fail(message);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Parse and fully decode an 8-bit RGBA PNG; returns { width, height, rgba }. */
function decodePng(buf, label) {
  assert(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${label}: bad PNG signature`);
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let sawEnd = false;
  while (pos < buf.length) {
    assert(pos + 12 <= buf.length, `${label}: truncated chunk header at ${pos}`);
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    assert(data.length === len, `${label}: truncated ${type} chunk`);
    const crc = buf.readUInt32BE(pos + 8 + len);
    assert(crc === crc32(buf.subarray(pos + 4, pos + 8 + len)), `${label}: CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      assert(ihdr === null && len === 13, `${label}: bad IHDR`);
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawEnd = true;
      pos += 12 + len;
      break;
    }
    pos += 12 + len;
  }
  assert(ihdr, `${label}: missing IHDR`);
  assert(sawEnd, `${label}: missing IEND`);
  assert(pos === buf.length, `${label}: trailing bytes after IEND`);
  assert(ihdr.bitDepth === 8 && ihdr.colorType === 6, `${label}: expected 8-bit RGBA, got depth ${ihdr.bitDepth} type ${ihdr.colorType}`);
  assert(ihdr.compression === 0 && ihdr.filter === 0 && ihdr.interlace === 0, `${label}: unsupported IHDR flags`);

  const { width, height } = ihdr;
  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  assert(raw.length === (stride + 1) * height, `${label}: IDAT inflates to ${raw.length} bytes, expected ${(stride + 1) * height}`);

  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert(filter <= 4, `${label}: bad filter type ${filter} on row ${y}`);
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const dst = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      dst[i] = v & 0xff;
    }
  }
  return { width, height, rgba };
}

function checkEmblem({ width, height, rgba }, label) {
  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3];
  assert(alphaAt(0, 0) === 0 && alphaAt(width - 1, height - 1) === 0, `${label}: corners should be transparent`);
  assert(alphaAt(width >> 1, height >> 1) === 255, `${label}: centre should be opaque`);
  // Something teal must have been drawn (the rivers): G and B clearly above R somewhere.
  let teal = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 200 && rgba[i + 1] > rgba[i] + 60 && rgba[i + 2] > rgba[i] + 40) teal++;
  assert(teal > (width * height) / 100, `${label}: expected teal river pixels`);
}

function checkPngFile(name, expectedSize) {
  const file = path.join(BUILD_DIR, name);
  const img = decodePng(readFileSync(file), name);
  assert(img.width === expectedSize && img.height === expectedSize, `${name}: expected ${expectedSize}², got ${img.width}×${img.height}`);
  checkEmblem(img, name);
  console.log(`verify-icon: ok ${name} ${img.width}×${img.height}`);
}

function checkIco(name) {
  const buf = readFileSync(path.join(BUILD_DIR, name));
  assert(buf.length >= 6, `${name}: too short`);
  assert(buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1, `${name}: bad ICO header`);
  const count = buf.readUInt16LE(4);
  assert(count === ICO_SIZES.length, `${name}: expected ${ICO_SIZES.length} entries, found ${count}`);
  const seen = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const w = buf[o] || 256;
    const h = buf[o + 1] || 256;
    const planes = buf.readUInt16LE(o + 4);
    const bpp = buf.readUInt16LE(o + 6);
    const size = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    assert(planes === 1 && bpp === 32, `${name}[${i}]: expected 1 plane / 32 bpp, got ${planes} / ${bpp}`);
    assert(offset >= 6 + count * 16 && offset + size <= buf.length, `${name}[${i}]: entry points outside the file`);
    const img = decodePng(buf.subarray(offset, offset + size), `${name}[${i}]`);
    assert(img.width === w && img.height === h, `${name}[${i}]: directory says ${w}×${h}, PNG is ${img.width}×${img.height}`);
    checkEmblem(img, `${name}[${i}]`);
    seen.push(w);
  }
  assert(ICO_SIZES.every((s) => seen.includes(s)), `${name}: sizes ${seen.join(',')} do not cover ${ICO_SIZES.join(',')}`);
  console.log(`verify-icon: ok ${name} entries ${seen.join(', ')}`);
}

checkPngFile('icon.png', 512);
checkPngFile('icon-256.png', 256);
checkIco('icon.ico');
console.log('verify-icon: all icons valid');
