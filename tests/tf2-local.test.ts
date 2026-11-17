// Integration test against a local TF2 install. Skipped when TF2_DIR is not set/found.
import { existsSync, openSync, readSync, fstatSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { VpkArchive, type ByteSource } from '../src/lib/source/vpk';
import { assets, VpkProvider } from '../src/lib/source/assets';
import { loadSourceModel, bonemerge } from '../src/lib/source/model';

const TF = process.env.TF2_DIR ?? 'D:/SteamLibrary/steamapps/common/Team Fortress 2/tf';
const has = existsSync(`${TF}/tf2_misc_dir.vpk`);

function fileSource(path: string): ByteSource {
  const fd = openSync(path, 'r');
  return { size: fstatSync(fd).size, async read(s, e) { const b = Buffer.alloc(e - s); readSync(fd, b, 0, e - s, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
}
async function open(name: string) {
  return new VpkProvider(name, name, await VpkArchive.open(fileSource(`${TF}/${name}_dir.vpk`), (i) => {
    const p = `${TF}/${name}_${String(i).padStart(3, '0')}.vpk`;
    return existsSync(p) ? fileSource(p) : undefined;
  }));
}

describe.skipIf(!has)('local TF2 assets', () => {
  beforeAll(async () => { assets.set([await open('tf2_misc'), await open('tf2_textures')]); }, 60000);

  it('loads scout with skins, bodygroups and textures', async () => {
    const m = await loadSourceModel('models/player/scout.mdl');
    console.log('bodygroups', JSON.stringify(m.bodygroups), 'skins', m.skinCount);
    console.log('mats', m.materials.map((x) => `${x.userData.info.name}:${x.map ? x.map.image.width : '-'}`).join(' '));
    console.log('bones', m.boneNames.join(' '));
    console.log('warn', m.warnings);
    expect(m.bones.length).toBeGreaterThan(50);
    expect(m.skinCount).toBeGreaterThanOrEqual(2);
    expect(m.meshes.length).toBeGreaterThan(0);
  }, 60000);

  it('bonemerges a cosmetic onto scout', async () => {
    const scout = await loadSourceModel('models/player/scout.mdl');
    const hat = await loadSourceModel('models/workshop/player/items/all_class/brotherhood_2/brotherhood_2_scout.mdl');
    const unmatched = bonemerge(hat, scout);
    console.log('hat mats', hat.materials.map((x) => `${x.userData.info.name}:${x.userData.info.paintable}`), 'unmatched', unmatched);
    expect(hat.meshes.length).toBeGreaterThan(0);
  }, 60000);
});
