// Operator-hosted asset pack (see scripts/asset-pack.ts): game-relative files served from /tf2/.
// Loaded automatically when the deployment provides /tf2/index.json, so visitors need no import.
import { assets, type AssetProvider } from './source/assets';
import { normalizePath } from './source/vpk';

const BASE = `${import.meta.env.BASE_URL}tf2/`;

export class HttpProvider implements AssetProvider {
  readonly id = 'hosted';
  readonly label: string;
  private files: Map<string, number>;
  constructor(files: Record<string, number>, label: string) {
    this.files = new Map(Object.entries(files));
    this.label = label;
  }
  has(p: string) { try { return this.files.has(normalizePath(p)); } catch { return false; } }
  async read(p: string) {
    const n = normalizePath(p);
    if (!this.files.has(n)) return null;
    const res = await fetch(BASE + n.split('/').map(encodeURIComponent).join('/'));
    return res.ok ? res.arrayBuffer() : null;
  }
  paths() { return this.files.keys(); }
  get count() { return this.files.size; }
}

let hosted: HttpProvider | null = null;

/** Mounts the hosted pack as the lowest-priority provider (a visitor's own files win). */
export async function mountHostedPack(): Promise<HttpProvider | null> {
  try {
    const res = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const idx = await res.json() as { format?: string; files?: Record<string, number> };
    if (idx.format !== 'sfmc.asset-pack' || !idx.files) return null;
    hosted = new HttpProvider(idx.files, `Hosted models (${Object.keys(idx.files).length.toLocaleString()} files)`);
    assets.add(hosted);
    return hosted;
  } catch {
    return null;
  }
}

export const hostedPack = () => hosted;

/** Optional operator-provided model entries (/tf2/types.json), e.g. permitted community or 18+ models. */
export async function loadHostedTypes(): Promise<import('./types').CharacterType[]> {
  if (!hosted) return [];
  try {
    const res = await fetch(`${BASE}types.json`, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t.id === 'string' && t.id.startsWith('hosted.') && typeof t.name === 'string' && typeof t.modelPath === 'string')
      .map((t) => ({ category: 'custom', tags: [], teams: ['red', 'blu'], skeleton: 'unknown', attribution: '', notes: '', ...t,
        source: { kind: 'hosted', label: t.source?.label ?? 'Hosted on this site', url: t.source?.url }, builtin: true, mature: !!t.mature, glbBlobId: undefined }));
  } catch { return []; }
}

/** URL of a pre-rendered item icon in the hosted pack, if present. */
export function hostedIconUrl(icon: string): string | null {
  try {
    const p = `icons/${normalizePath(icon)}.png`;
    return hosted?.has(p) ? BASE + p : null;
  } catch { return null; }
}
