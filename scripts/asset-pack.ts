// Builds the operator-hosted asset pack from the operator's OWN TF2 installation.
// Output is served by nginx from a volume (never committed to git, never in the Docker image).
//
// Usage:
//   node scripts/asset-pack.ts --tf "<Team Fortress 2/tf>" --out ./asset-pack [--measure] [--max-texture 1024]
//
// Contents: the 9 class player models, every catalog cosmetic model (all classes and styles),
// the materials/textures they reference, and 128 px PNG item icons.
// Files keep their game-relative paths; index.json lists them with size and VPK CRC32.
import { existsSync, openSync, readSync, fstatSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { VpkArchive, normalizePath, type ByteSource } from '../src/lib/source/vpk.ts';
import { decodeVtf } from '../src/lib/source/vtf.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TF = arg('--tf', process.env.TF2_DIR)!;
const OUT = arg('--out', 'asset-pack')!;
const MEASURE = process.argv.includes('--measure');
const MAX_TEX = Number(arg('--max-texture', '1024'));
if (!TF || !existsSync(join(TF, 'tf2_misc_dir.vpk'))) { console.error('Pass --tf pointing at your TF2 "tf" folder.'); process.exit(1); }

const fdCache = new Map<string, ByteSource>();
const fsrc = (p: string): ByteSource => { if (fdCache.has(p)) return fdCache.get(p)!; const src = mk(p); fdCache.set(p, src); return src; };
const mk = (p: string): ByteSource => { const fd = openSync(p, 'r'); return { size: fstatSync(fd).size, async read(s, e) { const b = Buffer.alloc(e - s); readSync(fd, b, 0, e - s, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
const open = (name: string) => VpkArchive.open(fsrc(join(TF, `${name}_dir.vpk`)), (i) => { const p = join(TF, `${name}_${String(i).padStart(3, '0')}.vpk`); return existsSync(p) ? fsrc(p) : undefined; });
const vpks = [await open('tf2_misc'), await open('tf2_textures')];
const find = (p: string) => vpks.find((v) => v.has(p));
const read = async (p: string) => (await find(p)?.read(p)) ?? null;

const safe = (p: string) => { try { return normalizePath(p); } catch { return null; } };
const CLASS_FILE: Record<string, string> = { scout: 'scout', soldier: 'soldier', pyro: 'pyro', demoman: 'demo', heavy: 'heavy', engineer: 'engineer', medic: 'medic', sniper: 'sniper', spy: 'spy' };
const items = JSON.parse(readFileSync('public/catalog/cosmetics.json', 'utf8'));
const models = new Set<string>(Object.values(CLASS_FILE).map((f) => `models/player/${f}.mdl`));
const refPaths = (ref: any, classes: string[]) => {
  if (!ref) return [];
  if (ref.all) return [ref.all];
  const out: string[] = [];
  for (const c of classes) {
    const per = ref.perClass ?? {};
    const p = per[c] ?? (c === 'demoman' ? per.demo : undefined) ?? per.basename?.replace(/%s/g, CLASS_FILE[c]);
    if (p) out.push(p);
  }
  return out;
};
for (const it of items) {
  const classes = it.classes[0] === 'all' ? Object.keys(CLASS_FILE) : it.classes;
  for (const p of [...refPaths(it.model, classes), ...(it.styles ?? []).flatMap((s: any) => refPaths(s.model, classes))]) { const n = safe(p); if (n) models.add(n); }
}

// Minimal MDL header read: texture names + texture directories (studiohdr_t offsets, v44-49).
function mdlMaterials(buf: ArrayBuffer) {
  const v = new DataView(buf);
  const str = (o: number) => { let s = ''; for (let i = o; i < buf.byteLength && v.getUint8(i); i++) s += String.fromCharCode(v.getUint8(i)); return s; };
  const numTex = v.getInt32(204, true), texIdx = v.getInt32(208, true);
  const numDir = v.getInt32(212, true), dirIdx = v.getInt32(216, true);
  const tex: string[] = [], dirs: string[] = [];
  for (let i = 0; i < numTex && i < 512; i++) { const o = texIdx + i * 64; tex.push(str(o + v.getInt32(o, true))); }
  for (let i = 0; i < numDir && i < 64; i++) dirs.push(str(v.getInt32(dirIdx + i * 4, true)));
  return { tex, dirs };
}
const kvGet = (text: string, key: string) => new RegExp(`"?\\${key}"?\\s+"?([^"\\r\\n]+)"?`, 'i').exec(text)?.[1]?.trim();

const files = new Map<string, number>(); // path -> size
const add = (p: string) => { const n = safe(p); if (!n) return false; const e = find(n)?.entries.get(n); if (e) files.set(n, (e.preload?.length ?? 0) + e.length); return !!e; };
let missingModels = 0;
for (const m of models) {
  const base = m.replace(/\.mdl$/, '');
  if (!add(`${base}.mdl`)) { missingModels++; continue; }
  add(`${base}.vvd`); add(`${base}.dx90.vtx`);
  const buf = await read(`${base}.mdl`);
  if (!buf) continue;
  const { tex, dirs } = mdlMaterials(buf);
  for (const t of tex) for (const d of dirs) {
    const vmt = safe(`materials/${d}/${t}.vmt`);
    if (!vmt) continue;
    if (!add(vmt)) continue;
    let text = new TextDecoder().decode((await read(vmt))!);
    const inc = kvGet(text, 'include');
    if (inc && add(inc)) text += new TextDecoder().decode((await read(safe(inc)!))!);
    for (const k of ['$basetexture', '$bumpmap', '$iris']) { const tp = kvGet(text, k); if (tp) add(`materials/${tp.replace(/\.vtf$/i, '')}.vtf`); }
    break;
  }
}
const icons = new Set<string>(items.map((i: any) => i.icon).filter(Boolean));
let total = 0;
for (const s of files.values()) total += s;
console.log(`models: ${models.size} (missing ${missingModels}), files: ${files.size}, raw size: ${(total / 1e9).toFixed(2)} GB, icons: ${icons.size}`);
if (MEASURE) process.exit(0);

// --- Write -------------------------------------------------------------------
function png(w: number, h: number, rgba: Uint8Array) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Re-pack a VTF keeping only mips <= MAX_TEX. Mips are stored smallest first and the high-res
// image block is normally the last block in the file, so dropping the largest mips is a truncation.
function shrinkVtf(buf: ArrayBuffer): ArrayBuffer {
  const v = new DataView(buf);
  const minor = v.getUint32(8, true), w = v.getUint16(16, true), h = v.getUint16(18, true), mips = v.getUint8(56);
  if (Math.max(w, h) <= MAX_TEX || mips < 2 || (v.getUint32(20, true) & 0x4000)) return buf;
  const fmt = v.getInt32(52, true), frames = Math.max(1, v.getUint16(24, true)), depth = minor >= 2 ? Math.max(1, v.getUint16(63, true)) : 1;
  const bpp: Record<number, number> = { 0: 4, 1: 4, 2: 3, 3: 3, 4: 2, 5: 1, 6: 2, 8: 1, 11: 4, 12: 4, 16: 4, 17: 2, 21: 2, 22: 2 };
  const size = (mw: number, mh: number) => fmt === 13 || fmt === 20 ? Math.max(1, (mw + 3) >> 2) * Math.max(1, (mh + 3) >> 2) * 8
    : fmt === 14 || fmt === 15 ? Math.max(1, (mw + 3) >> 2) * Math.max(1, (mh + 3) >> 2) * 16 : bpp[fmt] ? mw * mh * bpp[fmt] : -1;
  if (size(w, h) < 0) return buf;
  let imageStart = -1;
  if (minor >= 3) {
    const n = v.getUint32(68, true);
    for (let r = 0; r < Math.min(n, 32); r++) { const o = 80 + r * 8; if ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16)) === 0x30) imageStart = v.getUint32(o + 4, true); }
  } else {
    const lowFmt = v.getInt32(57, true), lw = v.getUint8(61), lh = v.getUint8(62);
    imageStart = v.getUint32(12, true) + (lowFmt >= 0 && lw ? Math.max(1, (lw + 3) >> 2) * Math.max(1, (lh + 3) >> 2) * 8 : 0);
  }
  if (imageStart < 0) return buf;
  let full = 0;
  for (let m = 0; m < mips; m++) full += size(Math.max(1, w >> m), Math.max(1, h >> m)) * frames * depth;
  if (imageStart + full !== buf.byteLength) return buf; // image block is not last: copy unchanged
  let drop = 0;
  while (Math.max(w >> drop, h >> drop) > MAX_TEX && drop < mips - 1) drop++;
  let removed = 0;
  for (let m = 0; m < drop; m++) removed += size(Math.max(1, w >> m), Math.max(1, h >> m)) * frames * depth;
  const out = new Uint8Array(buf.slice(0, buf.byteLength - removed));
  const ov = new DataView(out.buffer);
  ov.setUint16(16, Math.max(1, w >> drop), true); ov.setUint16(18, Math.max(1, h >> drop), true); ov.setUint8(56, mips - drop);
  return out.buffer;
}

mkdirSync(OUT, { recursive: true });
const index: Record<string, number> = {};
let written = 0, i = 0;
for (const p of files.keys()) {
  let buf = await read(p);
  if (!buf) continue;
  if (p.endsWith('.vtf')) buf = shrinkVtf(buf);
  const dest = join(OUT, p);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(buf));
  index[p] = buf.byteLength;
  written += buf.byteLength;
  if (++i % 2000 === 0) console.log(`${i}/${files.size} (${(written / 1e9).toFixed(2)} GB)`);
}
let iconCount = 0;
for (const icon of icons) {
  const buf = await read(normalizePath(`materials/${icon}.vtf`));
  if (!buf) continue;
  try {
    const d = decodeVtf(buf, 128);
    const dest = join(OUT, 'icons', `${normalizePath(icon)}.png`);
    mkdirSync(dirname(dest), { recursive: true });
    const b = png(d.width, d.height, d.data);
    writeFileSync(dest, b);
    index[`icons/${normalizePath(icon)}.png`] = b.length;
    iconCount++;
  } catch { /* unsupported icon format: skipped */ }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ format: 'sfmc.asset-pack', version: 1, generatedAt: new Date().toISOString(), maxTexture: MAX_TEX, files: index }));
console.log(`written ${Object.keys(index).length} files, ${(written / 1e9).toFixed(2)} GB, ${iconCount} icons -> ${OUT}`);
