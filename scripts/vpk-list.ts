// Dev helper: list paths in a local VPK. Usage: node scripts/vpk-list.ts <dir.vpk> [regex]
import { openSync, readSync, fstatSync, existsSync } from 'node:fs';
import { VpkArchive, type ByteSource } from '../src/lib/source/vpk.ts';

function fileSource(path: string): ByteSource {
  const fd = openSync(path, 'r');
  return {
    size: fstatSync(fd).size,
    async read(s, e) {
      const b = Buffer.alloc(e - s);
      readSync(fd, b, 0, e - s, s);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    },
  };
}

const [dirPath, pattern] = process.argv[1].endsWith("vpk-list.ts") ? process.argv.slice(2) : [];
if (dirPath) {
const vpk = await VpkArchive.open(fileSource(dirPath), (i) => {
  const p = dirPath.replace(/_dir\.vpk$/, `_${String(i).padStart(3, '0')}.vpk`);
  return existsSync(p) ? fileSource(p) : undefined;
});
const re = new RegExp(pattern ?? '.');
let n = 0;
for (const k of vpk.entries.keys()) if (re.test(k)) { console.log(k); n++; }
console.error(`${n} / ${vpk.entries.size} entries`);
}
export { fileSource };
