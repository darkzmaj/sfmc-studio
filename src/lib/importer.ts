// Import loose Source model files (folder or ZIP) into browser storage.
// Every file is validated: extension allow-list, size caps, path normalisation
// (no traversal), magic-number checks. Nothing is executed or uploaded.
import { unzip, type Unzipped } from 'fflate';
import { db, now, sha256, uid } from './db';
import { normalizePath } from './source/vpk';
import { parseRoot } from './source/kv';
import type { ImportPack } from './types';

export const ALLOWED_EXT = ['mdl', 'vvd', 'vtx', 'phy', 'ani', 'vtf', 'vmt', 'glb'] as const;
export const LIMITS = { fileBytes: 256 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024, files: 20000, zipBytes: 1024 * 1024 * 1024, vmtBytes: 512 * 1024 };

export interface ImportCandidate { path: string; size: number; data: () => Promise<Blob> }
export interface ImportReport { pack: ImportPack; accepted: string[]; rejected: { name: string; reason: string }[]; models: string[] }
export type Progress = (done: number, total: number, label: string) => void;

const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

/** Derive the game-relative path from a file's relative path (".../models/x/y.mdl" -> "models/x/y.mdl"). */
export function gamePath(relative: string): string | null {
  let p: string;
  try { p = normalizePath(relative); } catch { return null; }
  const e = ext(p);
  if (e === 'glb') return `glb/${p.split('/').pop()}`;
  const parts = p.split('/');
  const i = parts.lastIndexOf('models') >= 0 && ['mdl', 'vvd', 'vtx', 'phy', 'ani'].includes(e) ? parts.lastIndexOf('models') : parts.lastIndexOf('materials');
  if (i < 0) return null;
  return parts.slice(i).join('/');
}

export function fromFileList(files: FileList | File[]): ImportCandidate[] {
  return [...files].map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, size: f.size, data: async () => f }));
}

/** Collect files from a drag-and-drop (folders are walked recursively, keeping relative paths). */
export async function fromDrop(dt: DataTransfer): Promise<ImportCandidate[]> {
  const out: ImportCandidate[] = [];
  const zips: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (out.length > LIMITS.files) throw new Error(`Too many files (max ${LIMITS.files}).`);
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      if (file.name.toLowerCase().endsWith('.zip')) zips.push(file);
      else out.push({ path: prefix + file.name, size: file.size, data: async () => file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, '');
  else {
    for (const f of [...dt.files]) {
      if (f.name.toLowerCase().endsWith('.zip')) zips.push(f);
      else out.push({ path: f.name, size: f.size, data: async () => f });
    }
  }
  for (const z of zips) out.push(...(await fromZip(z)));
  return out;
}

/** A readable name from a model path ("models/player/fem_scout.mdl" -> "Fem Scout"). */
export function nameFromModelPath(path: string) {
  const base = path.split('/').pop()!.replace(/\.(mdl|glb)$/i, '').replace(/[_-]+/g, ' ').trim();
  return base.replace(/\w/g, (c) => c.toUpperCase()) || 'Imported model';
}

/** Expand a ZIP with bomb protection: declared sizes are checked before inflating. */
export async function fromZip(file: File): Promise<ImportCandidate[]> {
  if (file.size > LIMITS.zipBytes) throw new Error('ZIP is larger than 1 GB.');
  const buf = new Uint8Array(await file.arrayBuffer());
  let declared = 0;
  let count = 0;
  const out: Unzipped = await new Promise((res, rej) =>
    unzip(buf, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        declared += f.originalSize;
        if (count > LIMITS.files) throw new Error('ZIP contains too many files.');
        if (f.originalSize > LIMITS.fileBytes || declared > LIMITS.totalBytes) throw new Error('ZIP expands beyond the size limit.');
        return ALLOWED_EXT.includes(ext(f.name) as never);
      },
    }, (err, data) => (err ? rej(err) : res(data))),
  );
  return Object.entries(out).map(([name, bytes]) => ({ path: name, size: bytes.length, data: async () => new Blob([bytes as BlobPart]) }));
}

async function validate(path: string, blob: Blob): Promise<string | null> {
  const e = ext(path);
  const head = new DataView(await blob.slice(0, 8).arrayBuffer());
  if (head.byteLength < 4 && e !== 'vmt') return 'File too small';
  switch (e) {
    case 'mdl': return head.getUint32(0, true) === 0x54534449 ? null : 'Not an MDL file (missing IDST header)';
    case 'vvd': return head.getUint32(0, true) === 0x56534449 ? null : 'Not a VVD file (missing IDSV header)';
    case 'vtf': return head.getUint32(0, true) === 0x00465456 ? null : 'Not a VTF texture';
    case 'phy': case 'vtx': case 'ani': return null;
    case 'glb': return head.getUint32(0, true) === 0x46546c67 ? null : 'Not a binary glTF (GLB) file';
    case 'vmt': {
      if (blob.size > LIMITS.vmtBytes) return 'VMT larger than 512 KB';
      const text = await blob.text();
      if (/[\u0000-\u0008]/.test(text)) return 'VMT is not a text file';
      try { const [shader] = parseRoot(text); return shader ? null : 'VMT has no shader block'; } catch { return 'VMT could not be parsed'; }
    }
    default: return 'File type not allowed';
  }
}

export async function importFiles(candidates: ImportCandidate[], name: string, opts: { redistributable: boolean; sourceNote: string; workshopId?: string }, progress?: Progress): Promise<ImportReport> {
  const rejected: ImportReport['rejected'] = [];
  const accepted: string[] = [];
  if (candidates.length > LIMITS.files) throw new Error(`Too many files (max ${LIMITS.files}).`);
  const packId = uid();
  const d = await db();
  let total = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    progress?.(i, candidates.length, c.path);
    const e = ext(c.path);
    if (!ALLOWED_EXT.includes(e as never)) { rejected.push({ name: c.path, reason: `.${e} files are not accepted` }); continue; }
    if (c.size > LIMITS.fileBytes) { rejected.push({ name: c.path, reason: 'File larger than 256 MB' }); continue; }
    if (total + c.size > LIMITS.totalBytes) { rejected.push({ name: c.path, reason: 'Import exceeds 2 GB total' }); continue; }
    const gp = gamePath(c.path);
    if (!gp) { rejected.push({ name: c.path, reason: 'Not inside a models/ or materials/ folder' }); continue; }
    const blob = await c.data();
    const problem = await validate(gp, blob);
    if (problem) { rejected.push({ name: c.path, reason: problem }); continue; }
    const hash = await sha256(blob);
    const blobId = uid();
    const tx = d.transaction(['blobs', 'files'], 'readwrite');
    const old = await tx.objectStore('files').get(gp);
    if (old) await tx.objectStore('blobs').delete(old.blobId);
    await tx.objectStore('blobs').put({ id: blobId, kind: e === 'glb' ? 'glb' : 'import', name: gp.split('/').pop()!, type: 'application/octet-stream', size: blob.size, sha256: hash, blob, createdAt: now() });
    await tx.objectStore('files').put({ path: gp, blobId, packId, size: blob.size, sha256: hash });
    await tx.done;
    total += c.size;
    accepted.push(gp);
  }
  progress?.(candidates.length, candidates.length, 'Done');
  const pack: ImportPack = { id: packId, name, createdAt: now(), fileCount: accepted.length, totalBytes: total, redistributable: opts.redistributable, sourceNote: opts.sourceNote, workshopId: opts.workshopId };
  if (accepted.length) await d.put('packs', pack);
  return { pack, accepted, rejected, models: accepted.filter((p) => p.endsWith('.mdl') || p.endsWith('.glb')) };
}
