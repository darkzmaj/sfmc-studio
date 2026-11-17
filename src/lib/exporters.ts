// Character manifest (JSON), Markdown spec and ZIP bundle. All generated in the browser.
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Character, CharacterType, Paint, CatalogItem, ImportPack, ImportedFile } from './types';
import { cosmeticModelPath, getItem, loadMeta, loadPaints, paintColor } from './catalog';
import { assets } from './source/assets';
import { modelFiles } from './source/paths';
import { getBlob, listFiles, listPacks, sha256 } from './db';
import { POSES } from '../viewer/poses';
import { APP } from './brand';

export const MANIFEST_FORMAT = 'sfmc.character.manifest';
export const MANIFEST_VERSION = 1;

export interface AssetRef {
  role: 'base-model' | 'cosmetic-model';
  path: string;
  files: string[];
  availableLocally: boolean;
  origin: 'tf2-vpk' | 'user-import' | 'missing';
  vpkCrc32?: string;
  sha256?: string;
  importPack?: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  formatVersion: typeof MANIFEST_VERSION;
  generator: { name: string; version: string; url: string };
  exportedAt: string;
  character: {
    id: string; version: number; createdAt: string; updatedAt: string;
    profile: Character['profile'];
    tags: string[];
  };
  model: {
    typeId: string; name: string; category: string; cosmeticClass?: string; skeleton: string;
    source: CharacterType['source']; modelPath?: string; team: string; skin: number;
    bodygroups: Record<string, number>; pose: { id: string; name: string; procedural: true };
  };
  cosmetics: {
    uid: string; name: string; defindex?: number; equipRegions: string[]; modelPath?: string;
    style?: { id: number; name: string }; paint?: { defindex: number; name: string; rgb: [number, number, number] } | null;
    customColor?: [number, number, number] | null;
    transform: { offset: [number, number, number]; rotationDeg: [number, number, number]; scale: number };
    visible: boolean; modelAvailable: boolean;
  }[];
  assets: AssetRef[];
  dependencies: { workshop: { typeId: string; url?: string; note: string }[]; requiresTf2: boolean };
  catalog: { generatedAt: string; source: string };
  notes: string[];
}

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');

async function assetRef(role: AssetRef['role'], mdlPath: string, files: ImportedFile[], packs: ImportPack[]): Promise<AssetRef> {
  const f = modelFiles(mdlPath);
  const existing = [f.mdl, f.vvd, ...f.vtx].filter((p) => assets.has(p));
  const src = assets.source(f.mdl);
  const imported = files.find((x) => x.path === f.mdl);
  const ref: AssetRef = {
    role, path: f.mdl, files: existing.length ? existing : [f.mdl, f.vvd, f.vtx[0]], availableLocally: !!src,
    origin: imported ? 'user-import' : src?.id.startsWith('vpk:') ? 'tf2-vpk' : 'missing',
  };
  const crc = src?.crc?.(f.mdl);
  if (crc !== undefined) ref.vpkCrc32 = hex(crc);
  if (imported) { ref.sha256 = imported.sha256; ref.importPack = packs.find((p) => p.id === imported.packId)?.name; }
  return ref;
}

export async function buildManifest(c: Character, type: CharacterType | undefined): Promise<Manifest> {
  const [paints, meta, files, packs] = await Promise.all([loadPaints(), loadMeta(), listFiles(), listPacks()]);
  const cls = type?.cosmeticClass;
  const assetsOut: AssetRef[] = [];
  if (type?.modelPath) assetsOut.push(await assetRef('base-model', type.modelPath, files, packs));
  const cosmetics: Manifest['cosmetics'] = [];
  for (const e of c.config.cosmetics) {
    const item: CatalogItem | undefined = e.defindex !== undefined ? await getItem(e.defindex) : undefined;
    const path = item ? cosmeticModelPath(item, e.style, cls) : e.customModelPath;
    const paint: Paint | undefined = e.paint != null ? paints.find((p) => p.id === e.paint) : undefined;
    const style = item?.styles?.find((s) => s.id === e.style);
    if (path) assetsOut.push(await assetRef('cosmetic-model', path, files, packs));
    cosmetics.push({
      uid: e.uid, name: item?.name ?? e.name, defindex: e.defindex, equipRegions: item?.regions ?? [], modelPath: path,
      style: style ? { id: style.id, name: style.name } : undefined,
      paint: paint ? { defindex: paint.id, name: paint.name, rgb: paintColor(paint, c.config.team) } : null,
      customColor: e.customColor ?? null,
      transform: { offset: e.offset, rotationDeg: e.rotation, scale: e.scale }, visible: e.visible,
      modelAvailable: !!path && assets.has(path),
    });
  }
  const teamSkin = type?.teamSkins?.[c.config.team] ?? (c.config.team === 'blu' ? 1 : 0);
  const pose = POSES.find((p) => p.id === c.config.pose) ?? POSES[0];
  const notes: string[] = [];
  if (assetsOut.some((a) => !a.availableLocally)) notes.push('Some asset paths were not present in the files linked when this manifest was exported; they are listed as referenced, not verified.');
  return {
    format: MANIFEST_FORMAT, formatVersion: MANIFEST_VERSION,
    generator: { name: APP.name, version: APP.version, url: APP.url },
    exportedAt: new Date().toISOString(),
    character: { id: c.id, version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt, profile: c.profile, tags: c.profile.tags },
    model: {
      typeId: c.config.typeId, name: type?.name ?? c.config.typeId, category: type?.category ?? 'unknown', cosmeticClass: cls,
      skeleton: type?.skeleton ?? 'unknown', source: type?.source ?? { kind: 'local-import', label: 'Unknown' }, modelPath: type?.modelPath,
      team: c.config.team, skin: c.config.skin ?? teamSkin, bodygroups: c.config.bodygroups,
      pose: { id: pose.id, name: pose.name, procedural: true },
    },
    cosmetics,
    assets: assetsOut,
    dependencies: {
      workshop: type && type.source.kind === 'workshop' ? [{ typeId: type.id, url: type.source.url, note: type.notes }] : [],
      requiresTf2: assetsOut.some((a) => a.origin === 'tf2-vpk') || type?.source.kind === 'tf2-vpk',
    },
    catalog: { generatedAt: meta.generatedAt, source: meta.source },
    notes,
  };
}

const line = (label: string, v?: string) => (v && v.trim() ? `- **${label}:** ${v.trim()}\n` : '');
const section = (title: string, v?: string) => (v && v.trim() ? `\n## ${title}\n\n${v.trim()}\n` : '');

export function technicalSummary(m: Manifest): string {
  const lines = [
    `Character: ${m.character.profile.name}${m.character.profile.nickname ? ` ("${m.character.profile.nickname}")` : ''}`,
    `Model: ${m.model.name}`,
    `Team: ${m.model.team.toUpperCase()} (skin ${m.model.skin})`,
    `Pose: ${m.model.pose.name}`,
    `Cosmetics: ${m.cosmetics.length ? m.cosmetics.map((c) => `${c.name}${c.defindex !== undefined ? ` [#${c.defindex}]` : ''}`).join(', ') : 'none'}`,
    `Paints: ${m.cosmetics.filter((c) => c.paint || c.customColor).map((c) => `${c.name}: ${c.paint ? `${c.paint.name} (rgb ${c.paint.rgb.join(',')})` : `custom rgb ${c.customColor!.join(',')}`}`).join('; ') || 'none'}`,
    `Styles: ${m.cosmetics.filter((c) => c.style).map((c) => `${c.name}: ${c.style!.name} (#${c.style!.id})`).join('; ') || 'default'}`,
    `Bodygroup overrides: ${Object.entries(m.model.bodygroups).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`,
  ];
  const p = m.character.profile;
  if (p.personality) lines.push(`Personality: ${p.personality}`);
  if (p.voice) lines.push(`Voice notes: ${p.voice}`);
  if (p.animationNotes) lines.push(`Animation notes: ${p.animationNotes}`);
  const verified = m.assets.filter((a) => a.availableLocally).map((a) => a.path);
  const unverified = m.assets.filter((a) => !a.availableLocally).map((a) => a.path);
  lines.push(`SFM asset paths (verified in linked files): ${verified.join(', ') || 'none'}`);
  if (unverified.length) lines.push(`Referenced but not verified: ${unverified.join(', ')}`);
  return lines.join('\n');
}

export function manifestToMarkdown(m: Manifest): string {
  const p = m.character.profile;
  let md = `# ${p.name}\n\n`;
  md += `> Character specification exported by ${m.generator.name} ${m.generator.version} on ${m.exportedAt.slice(0, 10)}.\n> Format \`${m.format}\` v${m.formatVersion}. Machine-readable data is in \`manifest.json\`.\n\n`;
  md += line('Nickname', p.nickname) + line('Base model', `${m.model.name} (${m.model.typeId})`) + line('Team', m.model.team.toUpperCase()) + line('Tags', p.tags.join(', '));
  md += section('Description', p.description) + section('Personality and behaviour', p.personality) + section('Voice and speaking style', p.voice);
  md += section('Outfit', p.outfit) + section('Animation notes', p.animationNotes) + section('Special characteristics', p.special) + section('Story and scene notes', p.story);
  md += `\n## Equipment\n\n`;
  if (!m.cosmetics.length) md += 'No cosmetics equipped.\n';
  else {
    md += '| Item | Defindex | Style | Paint | Regions | Model path | Model available |\n|---|---|---|---|---|---|---|\n';
    for (const c of m.cosmetics) {
      md += `| ${c.name}${c.visible ? '' : ' (hidden)'} | ${c.defindex ?? 'custom'} | ${c.style?.name ?? 'default'} | ${c.paint?.name ?? (c.customColor ? `custom ${c.customColor.join(',')}` : 'none')} | ${c.equipRegions.join(', ') || '-'} | ${c.modelPath ? `\`${c.modelPath}\`` : 'none in schema'} | ${c.modelAvailable ? 'yes' : 'no'} |\n`;
    }
  }
  md += `\n## Technical summary\n\n\`\`\`text\n${technicalSummary(m)}\n\`\`\`\n`;
  md += `\n## Asset references\n\n`;
  for (const a of m.assets) md += `- \`${a.path}\` (${a.role}, ${a.origin}${a.vpkCrc32 ? `, VPK CRC32 ${a.vpkCrc32}` : ''}${a.sha256 ? `, sha256 ${a.sha256.slice(0, 16)}…` : ''})${a.availableLocally ? '' : ' **not verified**'}\n`;
  if (!m.assets.length) md += 'None.\n';
  if (m.dependencies.requiresTf2) md += `\nRequires Team Fortress 2 game files (not included).\n`;
  for (const w of m.dependencies.workshop) md += `\nRequires a community model for **${w.typeId}**${w.url ? ` (search: ${w.url})` : ''}. ${w.note}\n`;
  for (const n of m.notes) md += `\n> ${n}\n`;
  return md;
}

export function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeName = (s: string) => (s.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'character').toLowerCase();

/** ZIP with manifest, Markdown, thumbnail/render, reference images and (only if marked redistributable) imported files. */
export async function buildBundle(c: Character, type: CharacterType | undefined, opts: { render?: Blob | null; includeRedistributable: boolean }): Promise<{ zip: Blob; included: string[]; excluded: string[] }> {
  const m = await buildManifest(c, type);
  const files: Zippable = {};
  const included: string[] = [];
  const excluded: string[] = [];
  files['manifest.json'] = strToU8(JSON.stringify(m, null, 2));
  files['character.md'] = strToU8(manifestToMarkdown(m));
  files['sfmc-character.json'] = strToU8(JSON.stringify(c, null, 2));
  if (opts.render) files['render.png'] = new Uint8Array(await opts.render.arrayBuffer());
  else if (c.thumbnailId) { const t = await getBlob(c.thumbnailId); if (t) files['thumbnail.png'] = new Uint8Array(await t.blob.arrayBuffer()); }
  for (const id of c.profile.referenceImageIds) {
    const r = await getBlob(id);
    if (r) files[`references/${id.slice(0, 8)}-${r.name.replace(/[^\w.\-]+/g, '_')}`] = new Uint8Array(await r.blob.arrayBuffer());
  }
  const [allFiles, packs] = await Promise.all([listFiles(), listPacks()]);
  const okPacks = new Set(packs.filter((p) => p.redistributable).map((p) => p.id));
  for (const a of m.assets) {
    for (const path of a.files) {
      const f = allFiles.find((x) => x.path === path);
      if (f && opts.includeRedistributable && okPacks.has(f.packId)) {
        const b = await getBlob(f.blobId);
        if (b) { files[`assets/${path}`] = new Uint8Array(await b.blob.arrayBuffer()); included.push(path); continue; }
      }
      excluded.push(path);
    }
  }
  const readme = `This bundle was exported by ${APP.name} (${APP.url}).\n\nIncluded: manifest.json, character.md, sfmc-character.json${opts.render ? ', render.png' : ''}${included.length ? `, ${included.length} user-owned asset files under assets/` : ''}.\n\nNot included (third-party or game assets, referenced only):\n${excluded.map((p) => `- ${p}`).join('\n') || '- none'}\n\nTeam Fortress 2 assets belong to Valve Corporation and are never redistributed by SFMC Studio.\n`;
  files['README.txt'] = strToU8(readme);
  const zip = zipSync(files, { level: 6 });
  return { zip: new Blob([zip as BlobPart], { type: 'application/zip' }), included, excluded };
}

export { sha256 };
