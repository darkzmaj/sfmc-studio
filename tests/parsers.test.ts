import { describe, expect, it } from 'vitest';
import { parseKeyValues, parseRoot, kvVector } from '../src/lib/source/kv';
import { VpkArchive, normalizePath, type ByteSource } from '../src/lib/source/vpk';
import { decodeVtf } from '../src/lib/source/vtf';
import { gamePath } from '../src/lib/importer';

const mem = (u8: Uint8Array): ByteSource => ({ size: u8.length, read: async (s, e) => u8.slice(s, e).buffer });

describe('KeyValues', () => {
  it('parses VMT with comments, conditionals and nesting', () => {
    const [shader, kv] = parseRoot(`"VertexLitGeneric"\n{\n  // comment\n  "$basetexture" "models/player/scout/scout_red"\n  $phong 1 [$X360]\n  "Proxies" { "ItemTintColor" { "resultVar" "$colortint_base" } }\n}`);
    expect(shader).toBe('vertexlitgeneric'); // keys are case-insensitive in Source; stored lowercased
    expect(kv.$basetexture).toBe('models/player/scout/scout_red');
    expect(kv.$phong).toBe('1');
    expect((kv.proxies as Record<string, unknown>).itemtintcolor).toBeTruthy();
  });
  it('keeps the first duplicate key and survives unbalanced input', () => {
    expect(parseKeyValues('a 1 a 2 b { c 3').a).toBe('1');
  });
  it('reads vectors in both notations', () => {
    expect(kvVector('{255 128 0}')).toEqual([1, 128 / 255, 0]);
    expect(kvVector('[1 0.5 0.25]')).toEqual([1, 0.5, 0.25]);
    expect(kvVector('nope')).toBeUndefined();
  });
});

describe('paths', () => {
  it('normalises and rejects traversal', () => {
    expect(normalizePath('Models\\Player//Scout.MDL')).toBe('models/player/scout.mdl');
    expect(() => normalizePath('models/../../etc/passwd')).toThrow();
  });
  it('derives game paths from import locations', () => {
    expect(gamePath('MyPack/models/player/fem/femscout.mdl')).toBe('models/player/fem/femscout.mdl');
    expect(gamePath('x/materials/models/fem/body.vtf')).toBe('materials/models/fem/body.vtf');
    expect(gamePath('random/file.mdl')).toBeNull();
    expect(gamePath('../../models/evil.mdl')).toBeNull();
  });
});

function buildVpk(files: Record<string, Uint8Array>): Uint8Array {
  // Minimal VPK v2 with all data stored in the directory file (archive index 0x7fff).
  const enc = new TextEncoder();
  const tree: number[] = [];
  const data: number[] = [];
  const byExt = new Map<string, [string, string, Uint8Array][]>();
  for (const [p, d] of Object.entries(files)) {
    const slash = p.lastIndexOf('/'), dot = p.lastIndexOf('.');
    const list = byExt.get(p.slice(dot + 1)) ?? [];
    list.push([p.slice(0, slash), p.slice(slash + 1, dot), d]);
    byExt.set(p.slice(dot + 1), list);
  }
  const str = (s: string) => { tree.push(...enc.encode(s), 0); };
  for (const [ext, list] of byExt) {
    str(ext);
    for (const [dir, name, d] of list) {
      str(dir); str(name);
      const e = new DataView(new ArrayBuffer(18));
      e.setUint32(0, 0x1234, true); e.setUint16(4, 0, true); e.setUint16(6, 0x7fff, true);
      e.setUint32(8, data.length, true); e.setUint32(12, d.length, true); e.setUint16(16, 0xffff, true);
      tree.push(...new Uint8Array(e.buffer));
      data.push(...d);
      str('');
    }
    str('');
  }
  str('');
  const head = new DataView(new ArrayBuffer(28));
  head.setUint32(0, 0x55aa1234, true); head.setUint32(4, 2, true); head.setUint32(8, tree.length, true);
  return new Uint8Array([...new Uint8Array(head.buffer), ...tree, ...data]);
}

describe('VPK', () => {
  it('lists and reads entries', async () => {
    const vpk = await VpkArchive.open(mem(buildVpk({ 'models/a.mdl': new Uint8Array([1, 2, 3]), 'materials/b.vmt': new TextEncoder().encode('"x"{}') })), () => undefined);
    expect(vpk.has('Models/A.mdl')).toBe(true);
    expect([...new Uint8Array((await vpk.read('models/a.mdl'))!)]).toEqual([1, 2, 3]);
    expect(await vpk.read('missing.mdl')).toBeNull();
  });
  it('rejects non-VPK data', async () => {
    await expect(VpkArchive.open(mem(new Uint8Array(64)), () => undefined)).rejects.toThrow();
  });
});

function vtf(format: number, w: number, h: number, pixels: number[]): ArrayBuffer {
  const headerSize = 80;
  const buf = new DataView(new ArrayBuffer(headerSize + pixels.length));
  buf.setUint32(0, 0x00465456, true); buf.setUint32(4, 7, true); buf.setUint32(8, 2, true); buf.setUint32(12, headerSize, true);
  buf.setUint16(16, w, true); buf.setUint16(18, h, true); buf.setUint16(24, 1, true);
  buf.setInt32(52, format, true); buf.setUint8(56, 1); buf.setInt32(57, -1, true); buf.setUint16(63, 1, true);
  pixels.forEach((p, i) => buf.setUint8(headerSize + i, p));
  return buf.buffer;
}

describe('VTF', () => {
  it('decodes BGRA8888', () => {
    const d = decodeVtf(vtf(12, 1, 1, [10, 20, 30, 40]));
    expect([...d.data]).toEqual([30, 20, 10, 40]);
  });
  it('decodes a DXT1 block (solid red)', () => {
    // color0 = color1 = pure red (565: 0xF800), all indices 0
    const d = decodeVtf(vtf(13, 4, 4, [0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0]));
    expect([...d.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(d.width).toBe(4);
  });
  it('rejects truncated data', () => {
    expect(() => decodeVtf(vtf(12, 64, 64, [1, 2, 3, 4]))).toThrow();
  });
});
