#!/usr/bin/env node
// Builds public/catalog/{cosmetics,paints,effects,meta}.json from the TF2 item schema.
//
// Sources (in order of preference):
//   1. tsuza/tf2-item-schema (daily mirror of the Steam schema + items_game)
//   2. Optional local TF2 install for English names (TF2_DIR/resource/tf_english.txt)
//
// Usage: node scripts/build-catalog.mjs [--cache <dir>]
//        TF2_DIR="D:/SteamLibrary/steamapps/common/Team Fortress 2/tf" node scripts/build-catalog.mjs
//
// Only factual item metadata is written. No Valve images or models are downloaded or stored.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'catalog');
const BASE = 'https://raw.githubusercontent.com/tsuza/tf2-item-schema/master/files';
const cacheArg = process.argv.indexOf('--cache');
const CACHE = cacheArg > 0 ? process.argv[cacheArg + 1] : null;

async function fetchJson(rel) {
  const cached = CACHE && join(CACHE, rel.replace(/\//g, '_'));
  if (cached && existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  const text = await res.text();
  if (cached) { mkdirSync(CACHE, { recursive: true }); writeFileSync(cached, text); }
  return JSON.parse(text);
}

// --- Localisation -----------------------------------------------------------
const tokens = new Map();
function loadLocalisation() {
  const dir = process.env.TF2_DIR;
  const file = dir && join(dir, 'resource', 'tf_english.txt');
  if (!file || !existsSync(file)) return false;
  const buf = readFileSync(file);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const re = /^\s*"([^"]+)"\s+"((?:[^"\\]|\\.)*)"/gm;
  for (let m; (m = re.exec(text));) {
    const k = m[1].toLowerCase();
    if (!tokens.has(k)) tokens.set(k, m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
  }
  return true;
}
const loc = (token, fallback) => {
  if (!token) return fallback;
  if (!token.startsWith('#')) return token;
  return tokens.get(token.slice(1).toLowerCase()) ?? fallback;
};

// --- Prefab resolution ------------------------------------------------------
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}
function resolve(item, prefabs, depth = 0) {
  if (!item.prefab || depth > 10) return item;
  let base = {};
  for (const name of String(item.prefab).split(/\s+/)) {
    const p = prefabs[name];
    if (p) base = merge(base, resolve(p, prefabs, depth + 1));
  }
  const { prefab, ...rest } = item;
  return merge(base, rest);
}

const CLASSES = ['scout', 'soldier', 'pyro', 'demoman', 'heavy', 'engineer', 'medic', 'sniper', 'spy'];
const truthy = (o) => Object.entries(o ?? {}).filter(([, v]) => v === '1' || v === 1).map(([k]) => k.toLowerCase());

function models(src) {
  if (!src) return undefined;
  if (src.model_player_per_class) {
    const per = {};
    for (const [k, v] of Object.entries(src.model_player_per_class)) per[k.toLowerCase()] = v;
    return { perClass: per };
  }
  if (src.model_player) return { all: src.model_player };
  return undefined;
}

async function main() {
  const [ig, en] = await Promise.all([fetchJson('items_game_json.txt'), fetchJson('localized/item_schema_json_en.txt')]);
  const G = ig.items_game;
  const hasLocal = loadLocalisation();
  const schemaNames = new Map(en.result.items.map((i) => [String(i.defindex), i.item_name]));
  // Without a local tf_english.txt (e.g. in CI), keep names from the previously shipped catalog so a
  // sync only adds/updates metadata and never degrades display names. User presets store defindexes,
  // so catalog updates can never overwrite saved characters.
  const previous = new Map();
  for (const f of ['cosmetics.json', 'paints.json']) {
    const file = join(OUT, f);
    if (existsSync(file)) for (const i of JSON.parse(readFileSync(file, 'utf8'))) previous.set(String(i.id), i.name);
  }
  const nameOf = (id, it) => loc(it.item_name, null) ?? schemaNames.get(id) ?? previous.get(id) ?? it.name;

  const cosmetics = [];
  for (const [id, raw] of Object.entries(G.items)) {
    if (id === 'default') continue;
    const it = resolve(raw, G.prefabs);
    const slot = it.item_slot;
    if (it.item_class !== 'tf_wearable' || !['head', 'misc'].includes(slot)) continue;
    const toRegions = (v) => (!v ? [] : typeof v === 'string' ? [v] : Object.keys(v));
    const regions = [...new Set([...toRegions(it.equip_regions), ...toRegions(it.equip_region)].map((r) => String(r).toLowerCase()))];
    let classes = truthy(it.used_by_classes);
    if (!classes.length) continue;
    const styles = Object.entries(it.visuals?.styles ?? {}).map(([sid, s]) => ({
      id: Number(sid),
      name: loc(s.name, s.name ?? `Style ${sid}`),
      skinRed: s.skin_red !== undefined ? Number(s.skin_red) : s.skin !== undefined ? Number(s.skin) : undefined,
      skinBlu: s.skin_blu !== undefined ? Number(s.skin_blu) : s.skin !== undefined ? Number(s.skin) : undefined,
      model: models(s),
      hideBodygroups: s.additional_hidden_bodygroups ? truthy(s.additional_hidden_bodygroups) : undefined,
    }));
    cosmetics.push({
      id: Number(id),
      name: nameOf(id, it),
      internal: it.name,
      slot,
      classes: classes.length === 9 ? ['all'] : classes,
      regions,
      model: models(it),
      icon: it.image_inventory ?? undefined,
      paintable: it.capabilities?.paintable === '1',
      styles: styles.length ? styles : undefined,
      hideBodygroups: it.visuals?.player_bodygroups ? truthy(it.visuals.player_bodygroups) : undefined,
      year: it.first_sale_date ? Number(String(it.first_sale_date).slice(0, 4)) : undefined,
      holiday: it.holiday_restriction ?? undefined,
    });
  }
  cosmetics.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  const paints = [];
  for (const [id, raw] of Object.entries(G.items)) {
    const it = resolve(raw, G.prefabs);
    if (it.tool?.type !== 'paint_can') continue;
    const attrs = { ...(it.attributes ?? {}), ...(it.static_attrs ?? {}) };
    const get = (k) => { const v = attrs[k]; return v === undefined ? undefined : Number(typeof v === 'object' ? v.value : v); };
    const red = get('set item tint RGB');
    if (red === undefined) continue;
    const blu = get('set item tint RGB 2');
    const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    paints.push({ id: Number(id), name: nameOf(id, it), red: rgb(red), blu: blu !== undefined && blu !== red ? rgb(blu) : undefined });
  }
  paints.sort((a, b) => a.name.localeCompare(b.name));

  const effects = Object.entries(G.attribute_controlled_attached_particles?.cosmetic_unusual_effects ?? {}).map(([id, e]) => ({
    id: Number(id), system: e.system, name: loc(`#Attrib_Particle${id}`, e.system),
  }));

  const regionConflicts = {};
  for (const [k, v] of Object.entries(G.equip_conflicts ?? {})) regionConflicts[k] = Object.keys(v);

  mkdirSync(OUT, { recursive: true });
  const meta = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'https://github.com/tsuza/tf2-item-schema',
    itemsGameUrl: en.result.items_game_url,
    englishNames: hasLocal ? 'tf_english.txt (local TF2 install)' : 'Steam schema (first page) + internal names',
    counts: { cosmetics: cosmetics.length, paints: paints.length, effects: effects.length },
    classes: CLASSES,
    regionConflicts,
    notice: 'Item metadata is from Valve\'s public TF2 item schema. Team Fortress 2 and its items are trademarks and copyright of Valve Corporation.',
  };
  writeFileSync(join(OUT, 'cosmetics.json'), JSON.stringify(cosmetics));
  writeFileSync(join(OUT, 'paints.json'), JSON.stringify(paints));
  writeFileSync(join(OUT, 'effects.json'), JSON.stringify(effects));
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(meta.counts, meta.englishNames);
}

main().catch((e) => { console.error(e); process.exit(1); });
