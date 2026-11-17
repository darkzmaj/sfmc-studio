// Link the visitor's own TF2 installation. Files are read in place by the browser;
// nothing is uploaded and nothing from the VPKs is copied into storage.
import { assets, MapProvider, VpkProvider } from './source/assets';
import { blobSource, VpkArchive, type ByteSource } from './source/vpk';
import { db, kvDel, kvGet, kvSet } from './db';

export const VPK_SETS = ['tf2_misc', 'tf2_textures', 'hl2_misc', 'hl2_textures'] as const;

type FileGetter = (name: string) => Promise<File | undefined>;

export interface LinkResult { linked: string[]; entries: number; missingArchives: string[] }

async function openSet(name: string, get: FileGetter): Promise<VpkProvider | null> {
  const dir = await get(`${name}_dir.vpk`);
  if (!dir) return null;
  const archives = new Map<number, ByteSource>();
  // Probe archives lazily-but-upfront: getFile() is cheap, data is only read on demand.
  for (let i = 0; i < 1000; i++) {
    const f = await get(`${name}_${String(i).padStart(3, '0')}.vpk`);
    if (!f) break;
    archives.set(i, blobSource(f));
  }
  const vpk = await VpkArchive.open(blobSource(dir), (i) => archives.get(i));
  return new VpkProvider(`vpk:${name}`, `${name}_dir.vpk (${archives.size} archives)`, vpk);
}

async function linkWith(getTf: FileGetter, getHl2: FileGetter): Promise<LinkResult> {
  const providers: VpkProvider[] = [];
  for (const s of VPK_SETS) {
    const p = await openSet(s, s.startsWith('hl2') ? getHl2 : getTf);
    if (p) providers.push(p);
  }
  if (!providers.some((p) => p.id === 'vpk:tf2_misc')) throw new Error('tf2_misc_dir.vpk was not found. Pick your "Team Fortress 2" folder or its "tf" subfolder.');
  for (const p of VPK_SETS) assets.remove(`vpk:${p}`);
  for (const p of providers) assets.add(p);
  let entries = 0;
  for (const p of providers) for (const _ of p.paths()) entries++;
  return { linked: providers.map((p) => p.label), entries, missingArchives: [] };
}

async function childDir(dir: FileSystemDirectoryHandle, name: string) {
  try { return await dir.getDirectoryHandle(name); } catch { return undefined; }
}
const fileGetter = (dir: FileSystemDirectoryHandle | undefined): FileGetter => async (name) => {
  if (!dir) return undefined;
  try { return await (await dir.getFileHandle(name)).getFile(); } catch { return undefined; }
};

export const supportsDirectoryPicker = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Chromium: link via a persisted directory handle. Accepts "Team Fortress 2" or "tf". */
export async function linkDirectory(handle: FileSystemDirectoryHandle): Promise<LinkResult> {
  let tf: FileSystemDirectoryHandle | undefined = handle;
  let hl2: FileSystemDirectoryHandle | undefined;
  if (!(await fileGetter(handle)('tf2_misc_dir.vpk'))) {
    tf = await childDir(handle, 'tf');
    hl2 = await childDir(handle, 'hl2');
  }
  const res = await linkWith(fileGetter(tf), fileGetter(hl2));
  await kvSet('tf2Handle', handle);
  return res;
}

/** Any browser: link from a multi-file selection of .vpk files (session only). */
export async function linkFileList(files: FileList | File[]): Promise<LinkResult> {
  const byName = new Map([...files].map((f) => [f.name.toLowerCase(), f]));
  const get: FileGetter = async (n) => byName.get(n);
  return linkWith(get, get);
}

export async function unlinkTf2() {
  for (const p of VPK_SETS) assets.remove(`vpk:${p}`);
  await kvDel('tf2Handle');
}

export type RestoreState = 'none' | 'linked' | 'needs-permission' | 'error';

/** On startup: re-open a remembered folder if the browser still grants access. */
export async function restoreTf2(requestIfNeeded = false): Promise<RestoreState> {
  const handle = await kvGet<FileSystemDirectoryHandle>('tf2Handle');
  if (!handle || typeof handle.queryPermission !== 'function') return 'none';
  let perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && requestIfNeeded) perm = await handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') return 'needs-permission';
  try { await linkDirectory(handle); return 'linked'; } catch (e) { console.warn(e); return 'error'; }
}

export function tf2Linked() {
  return assets.list().some((p) => p.id === 'vpk:tf2_misc');
}

/** Mount user-imported loose files (stored in IndexedDB) as the highest-priority provider. */
export async function mountImports() {
  const d = await db();
  const files = await d.getAll('files');
  const map = new Map<string, Blob>();
  for (const f of files) {
    const b = await d.get('blobs', f.blobId);
    if (b) map.set(f.path, b.blob);
  }
  if (map.size) assets.add(new MapProvider('imports', `Imported files (${map.size})`, map), true);
  else assets.remove('imports');
  return map.size;
}

/** Dev server only (see vite.config.ts): link VPKs served from a local TF2 install via HTTP ranges. */
export async function devLinkTf2(): Promise<LinkResult> {
  if (!import.meta.env.DEV) throw new Error('Dev only');
  const src = async (rel: string): Promise<File | undefined> => {
    const head = await fetch(`/__dev-tf2/${rel}`, { method: 'HEAD' });
    if (!head.ok) return undefined;
    const size = Number(head.headers.get('content-length'));
    // A Blob-like shim: blobSource() only calls size and slice().arrayBuffer().
    const shim = { size, slice: (s: number, e: number) => ({ arrayBuffer: async () => (await fetch(`/__dev-tf2/${rel}`, { headers: { Range: `bytes=${s}-${e - 1}` } })).arrayBuffer() }) };
    return shim as unknown as File;
  };
  return linkWith((n) => src(`tf/${n}`), (n) => src(`hl2/${n}`));
}
