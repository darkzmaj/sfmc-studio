// Ordered set of read-only asset providers (user imports first, then game VPKs).
// All paths are game-relative ("models/player/scout.mdl"), never filesystem paths.
import { normalizePath, VpkArchive } from './vpk';

export interface AssetProvider {
  readonly id: string;
  readonly label: string;
  has(path: string): boolean;
  read(path: string): Promise<ArrayBuffer | null>;
  /** CRC32 when the container stores one (VPK). */
  crc?(path: string): number | undefined;
  paths(): Iterable<string>;
}

export class VpkProvider implements AssetProvider {
  readonly id: string;
  readonly label: string;
  private vpk: VpkArchive;
  constructor(id: string, label: string, vpk: VpkArchive) {
    this.id = id;
    this.label = label;
    this.vpk = vpk;
  }
  has(p: string) { return this.vpk.has(p); }
  read(p: string) { return this.vpk.read(p); }
  crc(p: string) { return this.vpk.entries.get(normalizePath(p))?.crc; }
  paths() { return this.vpk.entries.keys(); }
}

export class MapProvider implements AssetProvider {
  readonly id: string;
  readonly label: string;
  private files: Map<string, Blob>;
  constructor(id: string, label: string, files: Map<string, Blob>) {
    this.id = id;
    this.label = label;
    this.files = files;
  }
  has(p: string) { return this.files.has(normalizePath(p)); }
  async read(p: string) { return (await this.files.get(normalizePath(p))?.arrayBuffer()) ?? null; }
  paths() { return this.files.keys(); }
}

export class AssetManager {
  private providers: AssetProvider[] = [];
  private listeners = new Set<() => void>();
  version = 0;

  set(providers: AssetProvider[]) {
    this.providers = providers;
    this.version++;
    this.listeners.forEach((l) => l());
  }
  add(provider: AssetProvider, front = false) {
    const rest = this.providers.filter((p) => p.id !== provider.id);
    this.set(front ? [provider, ...rest] : [...rest, provider]);
  }
  remove(id: string) {
    this.set(this.providers.filter((p) => p.id !== id));
  }
  list() { return this.providers; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  has(path: string) {
    try { return this.providers.some((p) => p.has(path)); } catch { return false; }
  }
  /** Which provider would serve this path. */
  source(path: string) { return this.providers.find((p) => p.has(path)); }
  async read(path: string): Promise<ArrayBuffer | null> {
    for (const p of this.providers) if (p.has(path)) return p.read(path);
    return null;
  }
  async text(path: string) {
    const b = await this.read(path);
    return b ? new TextDecoder().decode(b) : null;
  }
}

export const assets = new AssetManager();
