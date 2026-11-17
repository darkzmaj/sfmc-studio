// VTF texture decoder: header parse + CPU decode of the common formats to RGBA8.
// CPU decode keeps alpha readable (paint masks) and works without S3TC support.
// Format: https://developer.valvesoftware.com/wiki/Valve_Texture_Format

export interface DecodedTexture {
  width: number;
  height: number;
  data: Uint8Array; // RGBA8
  format: number;
  flags: number;
}

const FMT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4, I8: 5, IA88: 6, A8: 8,
  ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15, BGRX8888: 16, BGR565: 17,
  DXT1A: 20, BGRA4444: 21, BGRA5551: 22,
} as const;

const FLAG_ENVMAP = 0x4000;

function mipBytes(format: number, w: number, h: number): number {
  switch (format) {
    case FMT.DXT1: case FMT.DXT1A: return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 8;
    case FMT.DXT3: case FMT.DXT5: return Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 16;
    case FMT.RGBA8888: case FMT.ABGR8888: case FMT.ARGB8888: case FMT.BGRA8888: case FMT.BGRX8888: return w * h * 4;
    case FMT.RGB888: case FMT.BGR888: return w * h * 3;
    case FMT.RGB565: case FMT.BGR565: case FMT.IA88: case FMT.BGRA4444: case FMT.BGRA5551: return w * h * 2;
    case FMT.I8: case FMT.A8: return w * h;
    default: return -1;
  }
}

export function vtfInfo(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  if (v.getUint32(0, true) !== 0x00465456) throw new Error('Not a VTF file');
  const minor = v.getUint32(8, true);
  return {
    minor,
    headerSize: v.getUint32(12, true),
    width: v.getUint16(16, true),
    height: v.getUint16(18, true),
    flags: v.getUint32(20, true),
    frames: v.getUint16(24, true),
    firstFrame: v.getUint16(26, true),
    format: v.getInt32(52, true),
    mipCount: v.getUint8(56),
    lowFormat: v.getInt32(57, true),
    lowW: v.getUint8(61),
    lowH: v.getUint8(62),
    depth: minor >= 2 ? v.getUint16(63, true) : 1,
    numResources: minor >= 3 ? v.getUint32(68, true) : 0,
  };
}

/** Decode the largest mip whose longest side is <= maxSize (frame 0, face 0). */
export function decodeVtf(buffer: ArrayBuffer, maxSize = 2048): DecodedTexture {
  const h = vtfInfo(buffer);
  if (h.width > 8192 || h.height > 8192 || h.mipCount > 16) throw new Error('VTF dimensions out of range');
  if (h.flags & FLAG_ENVMAP) throw new Error('Cubemap VTFs are not supported');
  const v = new DataView(buffer);

  let imageStart = -1;
  if (h.minor >= 3) {
    for (let r = 0; r < Math.min(h.numResources, 32); r++) {
      const o = 80 + r * 8;
      const tag = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
      if (tag === 0x30) imageStart = v.getUint32(o + 4, true);
    }
  }
  if (imageStart < 0) {
    const low = h.lowFormat >= 0 && h.lowW ? mipBytes(h.lowFormat, h.lowW, h.lowH) : 0;
    imageStart = h.headerSize + Math.max(0, low);
  }

  const frames = Math.max(1, h.frames);
  const depth = Math.max(1, h.depth);
  let mip = 0;
  while (mip < h.mipCount - 1 && Math.max(h.width >> mip, h.height >> mip) > maxSize) mip++;

  // Data is stored smallest mip first.
  let offset = imageStart;
  for (let m = h.mipCount - 1; m > mip; m--) {
    const size = mipBytes(h.format, Math.max(1, h.width >> m), Math.max(1, h.height >> m));
    if (size < 0) throw new Error(`Unsupported VTF format ${h.format}`);
    offset += size * frames * depth;
  }
  const w = Math.max(1, h.width >> mip);
  const ht = Math.max(1, h.height >> mip);
  const size = mipBytes(h.format, w, ht);
  if (size < 0) throw new Error(`Unsupported VTF format ${h.format}`);
  if (offset + size > buffer.byteLength) throw new Error('VTF data truncated');
  const src = new Uint8Array(buffer, offset, size);
  return { width: w, height: ht, data: decodePixels(h.format, src, w, ht), format: h.format, flags: h.flags };
}

function decodePixels(format: number, s: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const n = w * h;
  switch (format) {
    case FMT.DXT1: case FMT.DXT1A: decodeDxt(s, out, w, h, 1); break;
    case FMT.DXT3: decodeDxt(s, out, w, h, 3); break;
    case FMT.DXT5: decodeDxt(s, out, w, h, 5); break;
    case FMT.RGBA8888: out.set(s); break;
    case FMT.ABGR8888: for (let i = 0; i < n; i++) { out[i*4] = s[i*4+3]; out[i*4+1] = s[i*4+2]; out[i*4+2] = s[i*4+1]; out[i*4+3] = s[i*4]; } break;
    case FMT.ARGB8888: for (let i = 0; i < n; i++) { out[i*4] = s[i*4+1]; out[i*4+1] = s[i*4+2]; out[i*4+2] = s[i*4+3]; out[i*4+3] = s[i*4]; } break;
    case FMT.BGRA8888: for (let i = 0; i < n; i++) { out[i*4] = s[i*4+2]; out[i*4+1] = s[i*4+1]; out[i*4+2] = s[i*4]; out[i*4+3] = s[i*4+3]; } break;
    case FMT.BGRX8888: for (let i = 0; i < n; i++) { out[i*4] = s[i*4+2]; out[i*4+1] = s[i*4+1]; out[i*4+2] = s[i*4]; out[i*4+3] = 255; } break;
    case FMT.RGB888: for (let i = 0; i < n; i++) { out[i*4] = s[i*3]; out[i*4+1] = s[i*3+1]; out[i*4+2] = s[i*3+2]; out[i*4+3] = 255; } break;
    case FMT.BGR888: for (let i = 0; i < n; i++) { out[i*4] = s[i*3+2]; out[i*4+1] = s[i*3+1]; out[i*4+2] = s[i*3]; out[i*4+3] = 255; } break;
    case FMT.I8: for (let i = 0; i < n; i++) { out[i*4] = out[i*4+1] = out[i*4+2] = s[i]; out[i*4+3] = 255; } break;
    case FMT.A8: for (let i = 0; i < n; i++) { out[i*4] = out[i*4+1] = out[i*4+2] = 255; out[i*4+3] = s[i]; } break;
    case FMT.IA88: for (let i = 0; i < n; i++) { out[i*4] = out[i*4+1] = out[i*4+2] = s[i*2]; out[i*4+3] = s[i*2+1]; } break;
    case FMT.RGB565: case FMT.BGR565: {
      for (let i = 0; i < n; i++) {
        const c = s[i*2] | (s[i*2+1] << 8);
        const a = ((c >> 11) & 31) * 255 / 31, b = ((c >> 5) & 63) * 255 / 63, d = (c & 31) * 255 / 31;
        // RGB565 in VTF is stored with blue in the low bits for both variants in practice.
        out[i*4] = format === FMT.RGB565 ? d : a; out[i*4+1] = b; out[i*4+2] = format === FMT.RGB565 ? a : d; out[i*4+3] = 255;
      }
      break;
    }
    case FMT.BGRA4444: for (let i = 0; i < n; i++) { const lo = s[i*2], hi = s[i*2+1]; out[i*4+2] = (lo & 15) * 17; out[i*4+1] = (lo >> 4) * 17; out[i*4] = (hi & 15) * 17; out[i*4+3] = (hi >> 4) * 17; } break;
    case FMT.BGRA5551: for (let i = 0; i < n; i++) { const c = s[i*2] | (s[i*2+1] << 8); out[i*4+2] = (c & 31) * 255 / 31; out[i*4+1] = ((c >> 5) & 31) * 255 / 31; out[i*4] = ((c >> 10) & 31) * 255 / 31; out[i*4+3] = c >> 15 ? 255 : 0; } break;
    default: throw new Error(`Unsupported VTF format ${format}`);
  }
  return out;
}

function decodeDxt(src: Uint8Array, out: Uint8Array, w: number, h: number, kind: 1 | 3 | 5) {
  const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
  const blockSize = kind === 1 ? 8 : 16;
  const col = new Uint8Array(16), alpha = new Uint8Array(16);
  const pal = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let o = (by * bw + bx) * blockSize;
      if (kind === 3) {
        for (let i = 0; i < 8; i++) { alpha[i*2] = (src[o+i] & 15) * 17; alpha[i*2+1] = (src[o+i] >> 4) * 17; }
        o += 8;
      } else if (kind === 5) {
        const a0 = src[o], a1 = src[o+1];
        const ap = [a0, a1, 0, 0, 0, 0, 0, 0];
        if (a0 > a1) for (let i = 1; i < 7; i++) ap[i+1] = ((7 - i) * a0 + i * a1) / 7 | 0;
        else { for (let i = 1; i < 5; i++) ap[i+1] = ((5 - i) * a0 + i * a1) / 5 | 0; ap[6] = 0; ap[7] = 255; }
        let bits = 0, nb = 0, p = o + 2;
        for (let i = 0; i < 16; i++) {
          if (nb < 3) { bits |= src[p++] << nb; nb += 8; }
          alpha[i] = ap[bits & 7]; bits >>= 3; nb -= 3;
        }
        o += 8;
      }
      const c0 = src[o] | (src[o+1] << 8), c1 = src[o+2] | (src[o+3] << 8);
      const r0 = (c0 >> 11) * 255 / 31, g0 = ((c0 >> 5) & 63) * 255 / 63, b0 = (c0 & 31) * 255 / 31;
      const r1 = (c1 >> 11) * 255 / 31, g1 = ((c1 >> 5) & 63) * 255 / 63, b1 = (c1 & 31) * 255 / 31;
      pal[0] = r0; pal[1] = g0; pal[2] = b0; pal[3] = 255;
      pal[4] = r1; pal[5] = g1; pal[6] = b1; pal[7] = 255;
      if (c0 > c1 || kind !== 1) {
        pal[8] = (2*r0 + r1) / 3; pal[9] = (2*g0 + g1) / 3; pal[10] = (2*b0 + b1) / 3; pal[11] = 255;
        pal[12] = (r0 + 2*r1) / 3; pal[13] = (g0 + 2*g1) / 3; pal[14] = (b0 + 2*b1) / 3; pal[15] = 255;
      } else {
        pal[8] = (r0 + r1) / 2; pal[9] = (g0 + g1) / 2; pal[10] = (b0 + b1) / 2; pal[11] = 255;
        pal[12] = pal[13] = pal[14] = 0; pal[15] = 0;
      }
      const idx = src[o+4] | (src[o+5] << 8) | (src[o+6] << 16) | (src[o+7] << 24);
      for (let i = 0; i < 16; i++) col[i] = (idx >>> (i * 2)) & 3;
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= h) break;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= w) continue;
          const i = py * 4 + px, d = (y * w + x) * 4, c = col[i] * 4;
          out[d] = pal[c]; out[d+1] = pal[c+1]; out[d+2] = pal[c+2];
          out[d+3] = kind === 1 ? pal[c+3] : alpha[i];
        }
      }
    }
  }
}
