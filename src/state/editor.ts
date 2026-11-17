// Global editor state. Lives outside React routes so edits survive panel and page
// switches; a debounced draft is written to IndexedDB so they also survive reloads.
import { create } from 'zustand';
import type { Character, CharacterConfig, CharacterProfile, EquippedCosmetic } from '../lib/types';
import { getCharacter, kvGet, kvSet, now, saveCharacter, uid } from '../lib/db';

export interface Snapshot { profile: CharacterProfile; config: CharacterConfig }

export const emptyProfile = (): CharacterProfile => ({
  name: 'Untitled character', nickname: '', description: '', personality: '', voice: '', outfit: '',
  animationNotes: '', special: '', story: '', tags: [], referenceImageIds: [],
});

export const defaultConfig = (typeId: string, team: 'red' | 'blu' = 'red'): CharacterConfig => ({
  typeId, team, bodygroups: {}, cosmetics: [], pose: 'reference', eyes: {},
});

export function newCharacter(typeId: string, team: 'red' | 'blu' = 'red', name?: string): Character {
  const t = now();
  return {
    id: uid(), format: 'sfmc.character', formatVersion: 1,
    profile: { ...emptyProfile(), name: name ?? 'Untitled character' },
    config: defaultConfig(typeId, team), favorite: false, isTemplate: false,
    createdAt: t, updatedAt: t, version: 0,
  };
}

const HISTORY = 100;

interface EditorState {
  character: Character | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  savedAt: string | null;
  /** Coalescing key: consecutive edits with the same key merge into one undo step. */
  lastKey: string | null;
  load(c: Character, opts?: { dirty?: boolean }): void;
  close(): void;
  edit(fn: (s: Snapshot) => Snapshot, key?: string): void;
  setProfile(patch: Partial<CharacterProfile>, key?: string): void;
  setConfig(patch: Partial<CharacterConfig>, key?: string): void;
  updateCosmetic(uidv: string, patch: Partial<EquippedCosmetic>, key?: string): void;
  undo(): void;
  redo(): void;
  save(note?: string, thumbnailId?: string): Promise<Character | null>;
}

const snap = (c: Character): Snapshot => ({ profile: c.profile, config: c.config });

export const useEditor = create<EditorState>((set, get) => ({
  character: null, past: [], future: [], dirty: false, savedAt: null, lastKey: null,

  load(c, opts) {
    void kvSet('lastOpen', c.id);
    set({ character: structuredClone(c), past: [], future: [], dirty: !!opts?.dirty, savedAt: c.version ? c.updatedAt : null, lastKey: null });
  },
  close() { set({ character: null, past: [], future: [], dirty: false, lastKey: null }); void kvSet('draft', null); },

  edit(fn, key) {
    const { character, past, lastKey } = get();
    if (!character) return;
    const before = snap(character);
    const after = fn(before);
    if (after === before) return;
    const merge = key && key === lastKey;
    set({
      character: { ...character, ...after },
      past: merge ? past : [...past.slice(-HISTORY + 1), before],
      future: [],
      dirty: true,
      lastKey: key ?? null,
    });
  },
  setProfile(patch, key) { get().edit((s) => ({ ...s, profile: { ...s.profile, ...patch } }), key); },
  setConfig(patch, key) { get().edit((s) => ({ ...s, config: { ...s.config, ...patch } }), key); },
  updateCosmetic(u, patch, key) {
    get().edit((s) => ({ ...s, config: { ...s.config, cosmetics: s.config.cosmetics.map((c) => (c.uid === u ? { ...c, ...patch } : c)) } }), key);
  },
  undo() {
    const { character, past, future } = get();
    if (!character || !past.length) return;
    const prev = past[past.length - 1];
    set({ character: { ...character, ...prev }, past: past.slice(0, -1), future: [snap(character), ...future], dirty: true, lastKey: null });
  },
  redo() {
    const { character, past, future } = get();
    if (!character || !future.length) return;
    const [next, ...rest] = future;
    set({ character: { ...character, ...next }, past: [...past, snap(character)], future: rest, dirty: true, lastKey: null });
  },
  async save(note, thumbnailId) {
    const { character } = get();
    if (!character) return null;
    const stored = await saveCharacter({ ...character, thumbnailId: thumbnailId ?? character.thumbnailId }, note);
    set({ character: { ...get().character!, version: stored.version, updatedAt: stored.updatedAt, createdAt: stored.createdAt, thumbnailId: stored.thumbnailId }, dirty: false, savedAt: stored.updatedAt });
    await kvSet('draft', null);
    return stored;
  },
}));

// Draft autosave: every change to an open, dirty character is persisted after a short pause.
let timer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.character === prev.character || !s.character || !s.dirty) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void kvSet('draft', { character: useEditor.getState().character, at: now() }); }, 400);
});

export async function restoreDraft(): Promise<boolean> {
  const d = await kvGet<{ character: Character; at: string } | null>('draft');
  if (!d?.character) return false;
  useEditor.getState().load(d.character, { dirty: true });
  return true;
}

/** Reopen the last character after a reload (draft first, then the last saved one). */
export async function ensureOpenCharacter(): Promise<boolean> {
  if (useEditor.getState().character) return true;
  if (await restoreDraft()) return true;
  const id = await kvGet<string>('lastOpen');
  const c = id ? await getCharacter(id) : undefined;
  if (c) useEditor.getState().load(c);
  return !!c;
}

export function makeCosmetic(partial: Partial<EquippedCosmetic> & { name: string }): EquippedCosmetic {
  return { uid: uid(), offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1, visible: true, paint: null, ...partial };
}
