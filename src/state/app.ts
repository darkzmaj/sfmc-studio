import { create } from 'zustand';
import { assets } from '../lib/source/assets';
import { loadAllTypes } from '../lib/catalog';
import { getSettings, setSettings } from '../lib/db';
import { mountImports, restoreTf2, tf2Linked, type RestoreState } from '../lib/tf2files';
import { setTextureMaxSize } from '../lib/source/paths';
import type { CharacterType, Settings } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';

export interface Toast { id: number; message: string; tone: 'info' | 'success' | 'error' }

interface AppState {
  ready: boolean;
  assetsVersion: number;
  tf2: RestoreState | 'linked';
  settings: Settings;
  types: CharacterType[];
  toasts: Toast[];
  init(): Promise<void>;
  refreshTypes(): Promise<void>;
  updateSettings(p: Partial<Settings>): Promise<void>;
  toast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  setTf2(s: AppState['tf2']): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  assetsVersion: 0,
  tf2: 'none',
  settings: DEFAULT_SETTINGS,
  types: [],
  toasts: [],
  async init() {
    assets.subscribe(() => set({ assetsVersion: assets.version, tf2: tf2Linked() ? 'linked' : get().tf2 === 'linked' ? 'none' : get().tf2 }));
    const settings = await getSettings();
    setTextureMaxSize(settings.textureQuality);
    set({ settings });
    await mountImports().catch((e) => console.warn('imports', e));
    let tf2: RestoreState | 'linked' = await restoreTf2(false).catch(() => 'error' as const);
    if (import.meta.env.DEV && tf2 !== 'linked' && new URLSearchParams(location.search).has('devtf2')) {
      const { devLinkTf2 } = await import('../lib/tf2files');
      tf2 = await devLinkTf2().then(() => 'linked' as const, (e) => { console.warn(e); return tf2; });
    }
    set({ tf2 });
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__sfmc = { assets };
    await get().refreshTypes();
    set({ ready: true });
  },
  async refreshTypes() { set({ types: await loadAllTypes() }); },
  async updateSettings(p) {
    const settings = await setSettings(p);
    if (p.textureQuality) setTextureMaxSize(p.textureQuality);
    set({ settings });
  },
  toast(message, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 3500);
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
  setTf2(tf2) { set({ tf2 }); },
}));
