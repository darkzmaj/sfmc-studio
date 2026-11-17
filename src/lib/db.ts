// Browser-local persistence (IndexedDB). Nothing here is ever sent to a server.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Character, CharacterType, CharacterVersion, ImportedFile, ImportPack, Settings, StoredBlob } from './types';
import { DEFAULT_SETTINGS } from './types';

interface StudioDB extends DBSchema {
  characters: { key: string; value: Character; indexes: { updatedAt: string } };
  versions: { key: [string, number]; value: CharacterVersion; indexes: { characterId: string } };
  blobs: { key: string; value: StoredBlob };
  files: { key: string; value: ImportedFile; indexes: { packId: string } };
  packs: { key: string; value: ImportPack };
  types: { key: string; value: CharacterType };
  kv: { key: string; value: unknown };
  icons: { key: string; value: Blob };
}

export const DB_NAME = 'sfmc-studio';
const MAX_VERSIONS = 50;
let dbp: Promise<IDBPDatabase<StudioDB>> | null = null;

export function db() {
  dbp ??= openDB<StudioDB>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('characters', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('versions', { keyPath: ['characterId', 'version'] }).createIndex('characterId', 'characterId');
      d.createObjectStore('blobs', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'path' }).createIndex('packId', 'packId');
      d.createObjectStore('packs', { keyPath: 'id' });
      d.createObjectStore('types', { keyPath: 'id' });
      d.createObjectStore('kv');
      d.createObjectStore('icons');
    },
  });
  return dbp;
}

/** For tests: drop the cached connection. */
export function resetDbConnection() { dbp = null; }

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export async function sha256(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Characters -------------------------------------------------------------
export async function listCharacters() {
  return (await db()).getAll('characters');
}
export async function getCharacter(id: string) {
  return (await db()).get('characters', id);
}

/** Save and record a version snapshot. Returns the stored character. */
export async function saveCharacter(c: Character, note?: string): Promise<Character> {
  const d = await db();
  const prev = await d.get('characters', c.id);
  const next: Character = { ...c, version: (prev?.version ?? 0) + 1, updatedAt: now(), createdAt: prev?.createdAt ?? c.createdAt ?? now() };
  const tx = d.transaction(['characters', 'versions'], 'readwrite');
  await tx.objectStore('characters').put(next);
  await tx.objectStore('versions').put({ characterId: next.id, version: next.version, savedAt: next.updatedAt, note, snapshot: structuredClone({ profile: next.profile, config: next.config }) });
  const keys = await tx.objectStore('versions').index('characterId').getAllKeys(next.id);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS))) await tx.objectStore('versions').delete(k);
  await tx.done;
  return next;
}

/** Update metadata (favorite, name) without creating a version. */
export async function patchCharacter(id: string, patch: Partial<Character>) {
  const d = await db();
  const c = await d.get('characters', id);
  if (!c) return;
  await d.put('characters', { ...c, ...patch });
}

export async function deleteCharacter(id: string) {
  const d = await db();
  const c = await d.get('characters', id);
  const tx = d.transaction(['characters', 'versions', 'blobs'], 'readwrite');
  await tx.objectStore('characters').delete(id);
  for (const k of await tx.objectStore('versions').index('characterId').getAllKeys(id)) await tx.objectStore('versions').delete(k);
  if (c?.thumbnailId) await tx.objectStore('blobs').delete(c.thumbnailId);
  for (const r of c?.profile.referenceImageIds ?? []) await tx.objectStore('blobs').delete(r);
  await tx.done;
}

export async function listVersions(characterId: string) {
  return (await (await db()).getAllFromIndex('versions', 'characterId', characterId)).sort((a, b) => b.version - a.version);
}

// --- Blobs -------------------------------------------------------------------
export async function putBlob(blob: Blob, kind: StoredBlob['kind'], name: string, id: string = uid()): Promise<StoredBlob> {
  const rec: StoredBlob = { id, kind, name, type: blob.type, size: blob.size, sha256: await sha256(blob), blob, createdAt: now() };
  await (await db()).put('blobs', rec);
  return rec;
}
export async function getBlob(id: string) {
  return (await db()).get('blobs', id);
}
export async function deleteBlob(id: string) {
  await (await db()).delete('blobs', id);
}

// --- Settings / kv -------------------------------------------------------------
export async function getSettings(): Promise<Settings> {
  const s = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export async function setSettings(patch: Partial<Settings>) {
  const next = { ...(await getSettings()), ...patch };
  await (await db()).put('kv', next, 'settings');
  return next;
}
export async function kvGet<T>(key: string) { return (await (await db()).get('kv', key)) as T | undefined; }
export async function kvSet(key: string, value: unknown) { await (await db()).put('kv', value, key); }
export async function kvDel(key: string) { await (await db()).delete('kv', key); }

// --- Custom character types --------------------------------------------------
export async function listCustomTypes() { return (await db()).getAll('types'); }
export async function putCustomType(t: CharacterType) { await (await db()).put('types', { ...t, builtin: false }); }
export async function deleteCustomType(id: string) { await (await db()).delete('types', id); }

// --- Imported files ----------------------------------------------------------
export async function listPacks() { return (await db()).getAll('packs'); }
export async function listFiles() { return (await db()).getAll('files'); }
export async function deletePack(packId: string) {
  const d = await db();
  const files = await d.getAllFromIndex('files', 'packId', packId);
  const tx = d.transaction(['files', 'blobs', 'packs'], 'readwrite');
  for (const f of files) { await tx.objectStore('files').delete(f.path); await tx.objectStore('blobs').delete(f.blobId); }
  await tx.objectStore('packs').delete(packId);
  await tx.done;
}

export async function storageEstimate() {
  const est = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted: !!persisted };
}
export async function requestPersistence() {
  return (await navigator.storage?.persist?.()) ?? false;
}

export async function wipeAll() {
  const d = await db();
  d.close();
  dbp = null;
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    r.onblocked = () => res();
  });
}
