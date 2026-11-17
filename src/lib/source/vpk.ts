// Valve VPK (v1/v2) directory reader. Works on any random-access byte source,
// so the same code reads browser File objects and Node file handles.
// Format: https://developer.valvesoftware.com/wiki/VPK_File_Format

export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
}

export function blobSource(blob: Blob): ByteSource {
  return { size: blob.size, read: (s, e) => blob.slice(s, e).arrayBuffer() };
}

export interface VpkEntry {
  crc: number;
  preload: Uint8Array | null;
  archiveIndex: number;
  offset: number;
  length: number;
}

const SIGNATURE = 0x55aa1234;
const DIR_ARCHIVE = 0x7fff;
const MAX_TREE = 256 * 1024 * 1024;

export class VpkArchive {
  readonly entries = new Map<string, VpkEntry>();
  private dataStart = 0;
  private dir: ByteSource;
  private archives: (index: number) => ByteSource | undefined;

  private constructor(dir: ByteSource, archives: (index: number) => ByteSource | undefined) {
    this.dir = dir;
    this.archives = archives;
  }

  /** `archives(i)` returns the `<name>_NNN.vpk` source for archive index i. */
  static async open(dir: ByteSource, archives: (index: number) => ByteSource | undefined): Promise<VpkArchive> {
    const vpk = new VpkArchive(dir, archives);
    await vpk.parse();
    return vpk;
  }

  private async parse() {
    const head = new DataView(await this.dir.read(0, 28));
    if (head.getUint32(0, true) !== SIGNATURE) throw new Error('Not a VPK directory file');
    const version = head.getUint32(4, true);
    if (version !== 1 && version !== 2) throw new Error(`Unsupported VPK version ${version}`);
    const treeSize = head.getUint32(8, true);
    const headerSize = version === 1 ? 12 : 28;
    if (treeSize > MAX_TREE || headerSize + treeSize > this.dir.size) throw new Error('VPK tree size out of range');
    this.dataStart = headerSize + treeSize;

    const tree = new Uint8Array(await this.dir.read(headerSize, headerSize + treeSize));
    const view = new DataView(tree.buffer);
    let p = 0;
    const str = () => {
      const s = p;
      while (p < tree.length && tree[p] !== 0) p++;
      if (p >= tree.length) throw new Error('VPK tree truncated');
      const out = new TextDecoder().decode(tree.subarray(s, p));
      p++;
      return out;
    };
    for (;;) {
      const ext = str();
      if (!ext) break;
      for (;;) {
        const dir = str();
        if (!dir) break;
        for (;;) {
          const name = str();
          if (!name) break;
          if (p + 18 > tree.length) throw new Error('VPK entry truncated');
          const crc = view.getUint32(p, true);
          const preloadBytes = view.getUint16(p + 4, true);
          const archiveIndex = view.getUint16(p + 6, true);
          const offset = view.getUint32(p + 8, true);
          const length = view.getUint32(p + 12, true);
          p += 18; // includes 0xffff terminator
          const preload = preloadBytes ? tree.slice(p, p + preloadBytes) : null;
          p += preloadBytes;
          const path = `${dir === ' ' ? '' : dir + '/'}${name}${ext === ' ' ? '' : '.' + ext}`.toLowerCase();
          this.entries.set(path, { crc, preload, archiveIndex, offset, length });
        }
      }
    }
  }

  has(path: string) {
    return this.entries.has(normalizePath(path));
  }

  async read(path: string): Promise<ArrayBuffer | null> {
    const e = this.entries.get(normalizePath(path));
    if (!e) return null;
    const out = new Uint8Array((e.preload?.length ?? 0) + e.length);
    if (e.preload) out.set(e.preload, 0);
    if (e.length) {
      const src = e.archiveIndex === DIR_ARCHIVE ? this.dir : this.archives(e.archiveIndex);
      if (!src) throw new Error(`Missing VPK archive ${String(e.archiveIndex).padStart(3, '0')}`);
      const base = e.archiveIndex === DIR_ARCHIVE ? this.dataStart : 0;
      const chunk = await src.read(base + e.offset, base + e.offset + e.length);
      out.set(new Uint8Array(chunk), e.preload?.length ?? 0);
    }
    return out.buffer;
  }
}

/** Lowercase, forward slashes, no leading slash, no `..` segments. */
export function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').toLowerCase().split('/').filter((s) => s && s !== '.');
  if (parts.includes('..')) throw new Error('Path traversal rejected');
  return parts.join('/');
}
