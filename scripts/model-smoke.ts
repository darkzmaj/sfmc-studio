// Dev smoke test against a local TF2 install: node scripts/model-smoke.ts "<tf dir>" models/player/scout.mdl
import { existsSync } from 'node:fs';
import { fileSource } from './vpk-list.ts';
import { VpkArchive } from '../src/lib/source/vpk.ts';
import { assets, VpkProvider } from '../src/lib/source/assets.ts';
import { loadSourceModel, setBodygroups } from '../src/lib/source/model.ts';
const [tf, path] = process.argv.slice(2);
async function open(name: string) {
  const dir = `${tf}/${name}_dir.vpk`;
  return new VpkProvider(name, name, await VpkArchive.open(fileSource(dir), (i) => { const p = `${tf}/${name}_${String(i).padStart(3, '0')}.vpk`; return existsSync(p) ? fileSource(p) : undefined; }));
}
assets.set([await open('tf2_misc'), await open('tf2_textures')]);
const t = performance.now();
const m = await loadSourceModel(path);
console.log('ms', Math.round(performance.now() - t), 'bones', m.bones.length, 'meshes', m.meshes.length, 'skins', m.skinCount);
console.log('bodygroups', JSON.stringify(m.bodygroups));
console.log('textures', m.textures.join(','));
console.log('mats', m.materials.map((x) => `${x.userData.info.name}:${x.userData.info.vmtPath ? 'ok' : 'MISSING'}:${x.map ? x.map.image.width : '-'}${x.userData.info.paintable ? ':paint' : ''}`).join(' '));
console.log('warn', m.warnings);
console.log('bones', m.boneNames.slice(0, 60).join(' '));
