import { existsSync, openSync, readSync, fstatSync, readFileSync } from 'node:fs';
import { VpkArchive, type ByteSource } from '../../src/lib/source/vpk.ts';
const TF = 'D:/SteamLibrary/steamapps/common/Team Fortress 2/tf';
const fsrc = (p: string): ByteSource => { const fd = openSync(p, 'r'); return { size: fstatSync(fd).size, async read(s, e) { const b = Buffer.alloc(e - s); readSync(fd, b, 0, e - s, s); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; };
const vpk = await VpkArchive.open(fsrc(`${TF}/tf2_misc_dir.vpk`), (i) => { const p = `${TF}/tf2_misc_${String(i).padStart(3, '0')}.vpk`; return existsSync(p) ? fsrc(p) : undefined; });
const items = JSON.parse(readFileSync('public/catalog/cosmetics.json', 'utf8'));
const path = (it: any) => it.model?.all ?? (it.model?.perClass?.scout ?? it.model?.perClass?.basename?.replace(/%s/g, 'scout'));
for (const region of ['hat', 'glasses', 'shirt', 'feet', 'pants', 'back', 'face', 'medal']) {
  const hits = items.filter((i: any) => (i.classes.includes('scout')) && i.regions.length === 1 && i.regions[0] === region && path(i) && vpk.has(path(i)) && !i.year ? false : (i.classes.includes('scout') && i.regions.length === 1 && i.regions[0] === region && path(i) && vpk.has(path(i))));
  console.log(region, hits.slice(0, 6).map((i: any) => `${i.name}${i.paintable ? '*' : ''}${i.styles ? `(s${i.styles.length})` : ''}`).join(' | '));
}
