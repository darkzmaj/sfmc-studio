// Static catalog data (shipped JSON) + user extensions (custom types, model links).
import type { CatalogItem, CharacterConfig, CharacterType, EquippedCosmetic, Paint, Effect, Tf2Class, Team } from './types';
import { kvGet, kvSet, listCustomTypes } from './db';
import { assets } from './source/assets';
import { modelAvailable } from './source/paths';

const cache = new Map<string, Promise<unknown>>();
function getJson<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}catalog/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`Catalog ${name}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export interface CatalogMeta {
  generatedAt: string;
  source: string;
  englishNames: string;
  counts: Record<string, number>;
  regionConflicts: Record<string, string[]>;
  notice: string;
}

export const loadCosmetics = () => getJson<CatalogItem[]>('cosmetics');
export const loadPaints = () => getJson<Paint[]>('paints');
export const loadEffects = () => getJson<Effect[]>('effects');
export const loadMeta = () => getJson<CatalogMeta>('meta');
export const loadBuiltinTypes = () => getJson<CharacterType[]>('characters');

let itemIndex: Map<number, CatalogItem> | null = null;
export async function getItem(id: number) {
  if (!itemIndex) itemIndex = new Map((await loadCosmetics()).map((i) => [i.id, i]));
  return itemIndex.get(id);
}

/** typeId -> game-relative model path chosen by the user on the Imports page. */
export async function getTypeLinks() { return (await kvGet<Record<string, string>>('typeLinks')) ?? {}; }
export async function setTypeLink(typeId: string, modelPath: string | null) {
  const links = await getTypeLinks();
  if (modelPath) links[typeId] = modelPath; else delete links[typeId];
  await kvSet('typeLinks', links);
}

export async function loadAllTypes(): Promise<CharacterType[]> {
  const [builtin, custom, links] = await Promise.all([loadBuiltinTypes(), listCustomTypes(), getTypeLinks()]);
  return [...builtin, ...custom].map((t) => (links[t.id] ? { ...t, modelPath: links[t.id], linked: true } as CharacterType : t));
}

export type Availability = 'ready' | 'needs-tf2' | 'needs-import' | 'demo';
export function typeAvailability(t: CharacterType): Availability {
  if (t.source.kind === 'builtin-demo') return 'demo';
  if (t.glbBlobId) return 'ready';
  if (t.modelPath && modelAvailable(t.modelPath)) return 'ready';
  return t.source.kind === 'tf2-vpk' ? 'needs-tf2' : 'needs-import';
}

// --- Cosmetic model resolution -----------------------------------------------
const CLASS_FILE: Record<Tf2Class, string> = {
  scout: 'scout', soldier: 'soldier', pyro: 'pyro', demoman: 'demo', heavy: 'heavy',
  engineer: 'engineer', medic: 'medic', sniper: 'sniper', spy: 'spy',
};

export function resolveModelPath(ref: CatalogItem['model'], cls: Tf2Class | undefined): string | undefined {
  if (!ref) return undefined;
  if (ref.all) return ref.all;
  const per = ref.perClass ?? {};
  if (cls && per[cls]) return per[cls];
  if (cls && cls === 'demoman' && per.demo) return per.demo;
  if (per.basename && cls) return per.basename.replace(/%s/g, CLASS_FILE[cls]);
  return Object.values(per).find((v) => !v.includes('%s'));
}

export function cosmeticModelPath(item: CatalogItem, styleId: number | undefined, cls: Tf2Class | undefined) {
  const style = styleId !== undefined ? item.styles?.find((s) => s.id === styleId) : undefined;
  return resolveModelPath(style?.model, cls) ?? resolveModelPath(item.model, cls);
}

export function itemFitsClass(item: CatalogItem, cls: Tf2Class | undefined) {
  return !cls || item.classes.includes('all') || item.classes.includes(cls);
}

export function paintColor(p: Paint, team: Team): [number, number, number] {
  return team === 'blu' && p.blu ? p.blu : p.red;
}

// --- Compatibility report ------------------------------------------------------
export interface Issue { level: 'error' | 'warning' | 'info'; uid?: string; message: string }

export async function checkCompatibility(config: CharacterConfig, type: CharacterType | undefined): Promise<Issue[]> {
  const issues: Issue[] = [];
  const meta = await loadMeta();
  const seen = new Map<number, string>();
  const regionOwners = new Map<string, EquippedCosmetic>();
  for (const c of config.cosmetics) {
    if (c.defindex === undefined) {
      if (c.customModelPath && !assets.has(c.customModelPath)) issues.push({ level: 'warning', uid: c.uid, message: `${c.name}: model file not found in your linked or imported files.` });
      continue;
    }
    if (seen.has(c.defindex)) issues.push({ level: 'error', uid: c.uid, message: `${c.name} is equipped twice.` });
    seen.set(c.defindex, c.uid);
    const item = await getItem(c.defindex);
    if (!item) { issues.push({ level: 'warning', uid: c.uid, message: `${c.name}: item #${c.defindex} is not in the current catalog.` }); continue; }
    if (type?.cosmeticClass && !itemFitsClass(item, type.cosmeticClass)) issues.push({ level: 'warning', uid: c.uid, message: `${item.name} is not made for the ${type.cosmeticClass}; it may float or clip.` });
    if (type && !type.cosmeticClass && type.skeleton !== 'tf2-biped') issues.push({ level: 'warning', uid: c.uid, message: `${item.name}: this base model has a non-TF2 skeleton, so the item may not follow the body.` });
    const path = cosmeticModelPath(item, c.style, type?.cosmeticClass);
    if (!path) issues.push({ level: 'info', uid: c.uid, message: `${item.name} has no 3D model in the schema (metadata only).` });
    else if (!modelAvailable(path)) issues.push({ level: 'info', uid: c.uid, message: `${item.name}: 3D model not available until your TF2 files are linked.` });
    for (const r of item.regions) {
      const clash = [r, ...(meta.regionConflicts[r] ?? [])].map((x) => regionOwners.get(x)).find(Boolean);
      if (clash && clash.uid !== c.uid) issues.push({ level: 'warning', uid: c.uid, message: `${item.name} shares the "${r}" equip region with ${clash.name}; they will likely clip.` });
    }
    for (const r of item.regions) if (!regionOwners.has(r)) regionOwners.set(r, c);
  }
  return issues;
}
