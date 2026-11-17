// Full-library backup and restore (ZIP), generated and parsed entirely in the browser.
import { strFromU8, strToU8, unzip, zipSync, type Unzipped, type Zippable } from 'fflate';
import { db, getSettings, kvGet, kvSet, now, setSettings, sha256, uid } from './db';
import type { Character, CharacterType, CharacterVersion, ImportedFile, ImportPack, StoredBlob } from './types';
import { APP } from './brand';

export const BACKUP_FORMAT = 'sfmc.backup';
export const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

interface BlobMeta { id: string; kind: StoredBlob['kind']; name: string; type: string; size: number; sha256: string; createdAt: string; file: string }
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_VERSION;
  app: { name: string; version: string; url: string };
  createdAt: string;
  counts: { characters: number; versions: number; blobs: number; customTypes: number; packs: number; files: number };
  includesImportedFiles: boolean;
  /** sha256 of every other file in the archive, for integrity validation. */
  checksums: Record<string, string>;
}

const extOf = (type: string, name: string) => (type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : name.split('.').pop()?.replace(/[^\w]/g, '') || 'bin');

export async function estimateBackup() {
  const d = await db();
  const blobs = await d.getAll('blobs');
  const imported = blobs.filter((b) => b.kind === 'import' || b.kind === 'glb');
  return {
    characters: await d.count('characters'),
    userBytes: blobs.filter((b) => b.kind === 'thumbnail' || b.kind === 'reference').reduce((a, b) => a + b.size, 0),
    importedBytes: imported.reduce((a, b) => a + b.size, 0),
    importedCount: imported.length,
  };
}

export async function createBackup(opts: { includeImportedFiles: boolean }, progress?: (msg: string) => void): Promise<Blob> {
  const d = await db();
  const [characters, versions, blobs, types, packs, files] = await Promise.all([
    d.getAll('characters'), d.getAll('versions'), d.getAll('blobs'), d.getAll('types'), d.getAll('packs'), d.getAll('files'),
  ]);
  const zip: Zippable = {};
  const checksums: Record<string, string> = {};
  const put = async (name: string, data: Uint8Array) => { zip[name] = data; checksums[name] = await sha256(data.buffer as ArrayBuffer); };

  progress?.('Characters');
  for (const c of characters) await put(`characters/${c.id}.json`, strToU8(JSON.stringify(c, null, 2)));
  const byChar = new Map<string, CharacterVersion[]>();
  for (const v of versions) byChar.set(v.characterId, [...(byChar.get(v.characterId) ?? []), v]);
  for (const [id, list] of byChar) await put(`versions/${id}.json`, strToU8(JSON.stringify(list)));

  progress?.('Images and files');
  const blobMeta: BlobMeta[] = [];
  for (const b of blobs) {
    const isImport = b.kind === 'import' || b.kind === 'glb';
    if (isImport && !opts.includeImportedFiles) continue;
    const file = `blobs/${b.id}.${extOf(b.type, b.name)}`;
    await put(file, new Uint8Array(await b.blob.arrayBuffer()));
    blobMeta.push({ id: b.id, kind: b.kind, name: b.name, type: b.type, size: b.size, sha256: b.sha256, createdAt: b.createdAt, file });
  }
  await put('blobs.json', strToU8(JSON.stringify(blobMeta, null, 2)));
  await put('custom-types.json', strToU8(JSON.stringify(types, null, 2)));
  await put('imports.json', strToU8(JSON.stringify({ packs, files: opts.includeImportedFiles ? files : [] }, null, 2)));
  await put('settings.json', strToU8(JSON.stringify({ settings: await getSettings(), typeLinks: (await kvGet('typeLinks')) ?? {} }, null, 2)));

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION,
    app: { name: APP.name, version: APP.version, url: APP.url },
    createdAt: now(),
    counts: { characters: characters.length, versions: versions.length, blobs: blobMeta.length, customTypes: types.length, packs: packs.length, files: opts.includeImportedFiles ? files.length : 0 },
    includesImportedFiles: opts.includeImportedFiles,
    checksums,
  };
  zip['backup-manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  progress?.('Compressing');
  const out = zipSync(zip, { level: 6 });
  await setSettings({ lastBackupAt: manifest.createdAt });
  return new Blob([out as BlobPart], { type: 'application/zip' });
}

// --- Restore ------------------------------------------------------------------
export type ConflictStrategy = 'skip' | 'overwrite' | 'keep-both';
export interface RestorePlan {
  manifest: BackupManifest;
  characters: { incoming: Character; existing?: Character }[];
  integrity: { ok: boolean; problems: string[] };
  entries: Unzipped;
}

export async function readBackup(file: File): Promise<RestorePlan> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup is larger than 2 GB.');
  const buf = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  const entries: Unzipped = await new Promise((res, rej) => unzip(buf, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_BACKUP_BYTES * 2) throw new Error('Backup expands beyond the size limit.');
      return /^(backup-manifest\.json|blobs\.json|custom-types\.json|imports\.json|settings\.json|characters\/[\w-]+\.json|versions\/[\w-]+\.json|blobs\/[\w-]+\.\w{1,8})$/.test(f.name);
    },
  }, (e, d) => (e ? rej(e) : res(d))));
  const mf = entries['backup-manifest.json'];
  if (!mf) throw new Error('Not an SFMC Studio backup (backup-manifest.json missing).');
  const manifest = JSON.parse(strFromU8(mf)) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) throw new Error('Unknown backup format.');
  if (manifest.formatVersion > BACKUP_VERSION) throw new Error(`Backup format v${manifest.formatVersion} is newer than this app supports (v${BACKUP_VERSION}). Update SFMC Studio first.`);

  const problems: string[] = [];
  for (const [name, expected] of Object.entries(manifest.checksums ?? {})) {
    const data = entries[name];
    if (!data) { problems.push(`Missing file: ${name}`); continue; }
    if ((await sha256(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)) !== expected) problems.push(`Checksum mismatch: ${name}`);
  }
  const d = await db();
  const characters: RestorePlan['characters'] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith('characters/')) continue;
    const c = JSON.parse(strFromU8(data)) as Character;
    if (c.format !== 'sfmc.character' || typeof c.id !== 'string' || !c.config || !c.profile) { problems.push(`Invalid character file: ${name}`); continue; }
    characters.push({ incoming: c, existing: await d.get('characters', c.id) });
  }
  return { manifest, characters, integrity: { ok: problems.length === 0, problems }, entries };
}

export async function applyRestore(plan: RestorePlan, strategy: ConflictStrategy, opts: { restoreSettings: boolean }): Promise<{ added: number; replaced: number; skipped: number }> {
  const d = await db();
  const e = plan.entries;
  const json = <T,>(name: string, fallback: T): T => (e[name] ? JSON.parse(strFromU8(e[name])) as T : fallback);
  const blobMeta = json<BlobMeta[]>('blobs.json', []);
  const types = json<CharacterType[]>('custom-types.json', []);
  const imports = json<{ packs: ImportPack[]; files: ImportedFile[] }>('imports.json', { packs: [], files: [] });
  const settings = json<{ settings?: Record<string, unknown>; typeLinks?: Record<string, string> }>('settings.json', {});
  let added = 0, replaced = 0, skipped = 0;
  const blobIdMap = new Map<string, string>();

  const writeBlob = async (id: string) => {
    if (blobIdMap.has(id)) return blobIdMap.get(id)!;
    const m = blobMeta.find((b) => b.id === id);
    const data = m && e[m.file];
    if (!m || !data) return null;
    const exists = await d.get('blobs', id);
    const newId = exists && exists.sha256 !== m.sha256 ? uid() : id;
    await d.put('blobs', { id: newId, kind: m.kind, name: m.name, type: m.type, size: m.size, sha256: m.sha256, createdAt: m.createdAt, blob: new Blob([data as BlobPart], { type: m.type }) });
    blobIdMap.set(id, newId);
    return newId;
  };

  for (const { incoming, existing } of plan.characters) {
    let c = structuredClone(incoming);
    if (existing && strategy === 'skip') { skipped++; continue; }
    if (existing && strategy === 'keep-both') c = { ...c, id: uid(), profile: { ...c.profile, name: `${c.profile.name} (restored)` } };
    if (c.thumbnailId) c.thumbnailId = (await writeBlob(c.thumbnailId)) ?? undefined;
    c.profile.referenceImageIds = (await Promise.all(c.profile.referenceImageIds.map(writeBlob))).filter((x): x is string => !!x);
    const versions = json<CharacterVersion[]>(`versions/${incoming.id}.json`, []);
    const tx = d.transaction(['characters', 'versions'], 'readwrite');
    if (existing && strategy === 'overwrite') {
      for (const k of await tx.objectStore('versions').index('characterId').getAllKeys(c.id)) await tx.objectStore('versions').delete(k);
    }
    await tx.objectStore('characters').put(c);
    for (const v of versions) await tx.objectStore('versions').put({ ...v, characterId: c.id });
    await tx.done;
    if (existing && strategy === 'overwrite') replaced++; else added++;
  }
  for (const t of types) if (!(await d.get('types', t.id)) || strategy === 'overwrite') await d.put('types', { ...t, builtin: false });
  if (plan.manifest.includesImportedFiles) {
    for (const p of imports.packs) await d.put('packs', p);
    for (const f of imports.files) {
      const id = await writeBlob(f.blobId);
      if (id) await d.put('files', { ...f, blobId: id });
    }
  }
  if (opts.restoreSettings && settings.settings) await setSettings(settings.settings);
  if (settings.typeLinks) await kvSet('typeLinks', { ...((await kvGet<Record<string, string>>('typeLinks')) ?? {}), ...settings.typeLinks });
  return { added, replaced, skipped };
}
