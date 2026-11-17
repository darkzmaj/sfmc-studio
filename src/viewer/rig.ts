// Builds and incrementally updates the 3D character for a CharacterConfig.
import { Box3, Euler, Group, Matrix4, Quaternion, Vector3, type SkinnedMesh, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterConfig, CharacterType, Paint } from '../lib/types';
import { bonemerge, disposeModel, loadSourceModel, MissingAssetError, modelAvailable, setBodygroups, setSkin, uprightCorrection, type SourceModel } from '../lib/source/model';
import { applyPaint, releaseTextures, type SourceMaterial } from '../lib/source/material';
import { cosmeticModelPath, getItem, loadPaints, paintColor } from '../lib/catalog';
import { getBlob } from '../lib/db';
import { createMannequin } from './mannequin';
import { applyPose, poseSupported } from './poses';

export interface CosmeticStatus { uid: string; state: 'loading' | 'ready' | 'metadata-only' | 'missing' | 'error'; message?: string; path?: string; unmatchedBones?: string[] }
export interface RigStatus {
  base: 'empty' | 'loading' | 'ready' | 'missing' | 'error';
  message?: string;
  baseInfo?: { path: string; bodygroups: SourceModel['bodygroups']; skinCount: number; boneCount: number; warnings: string[]; poseSupported: boolean; checksum: number };
  cosmetics: Record<string, CosmeticStatus>;
}

interface LoadedCosmetic { path: string; model: SourceModel; center: Vector3 }

export class CharacterRig {
  readonly root = new Group();
  private base: SourceModel | null = null;
  private baseKey = '';
  private cosmetics = new Map<string, LoadedCosmetic>();
  private queue: Promise<void> = Promise.resolve();
  private pending: { type: CharacterType; config: CharacterConfig } | null = null;
  status: RigStatus = { base: 'empty', cosmetics: {} };
  onStatus: (s: RigStatus) => void = () => {};
  onChange: (fit: boolean) => void = () => {};

  constructor() {
    // Source is Z-up; three.js is Y-up.
    this.root.rotation.x = -Math.PI / 2;
    this.root.updateMatrixWorld(true);
  }

  private emit(patch: Partial<RigStatus>) {
    this.status = { ...this.status, ...patch, cosmetics: { ...this.status.cosmetics, ...(patch.cosmetics ?? {}) } };
    this.onStatus(this.status);
  }

  /** Apply a configuration. Calls coalesce: only the newest pending config is processed. */
  apply(type: CharacterType, config: CharacterConfig) {
    this.pending = { type, config };
    this.queue = this.queue.then(async () => {
      const job = this.pending;
      if (!job) return;
      this.pending = null;
      try { await this.applyNow(job.type, job.config); } catch (e) { console.error(e); this.emit({ base: 'error', message: String((e as Error).message ?? e) }); }
    });
    return this.queue;
  }

  private async loadBase(type: CharacterType): Promise<SourceModel> {
    if (type.source.kind === 'builtin-demo') return createMannequin();
    if (type.glbBlobId) return loadGlbBase(type.glbBlobId);
    if (!type.modelPath) throw new MissingAssetError([]);
    return loadSourceModel(type.modelPath);
  }

  private async applyNow(type: CharacterType, config: CharacterConfig) {
    const key = `${type.id}|${type.modelPath ?? ''}|${type.glbBlobId ?? ''}`;
    let refit = false;
    if (key !== this.baseKey || !this.base) {
      this.clearCosmetics();
      if (this.base) { this.root.remove(this.base.group); disposeModel(this.base); this.base = null; }
      this.baseKey = key;
      this.emit({ base: 'loading', message: undefined, baseInfo: undefined, cosmetics: {} });
      this.status.cosmetics = {};
      try {
        this.base = await this.loadBase(type);
      } catch (e) {
        const missing = e instanceof MissingAssetError;
        this.emit({ base: missing ? 'missing' : 'error', message: missing ? (type.source.kind === 'tf2-vpk' ? 'Link your TF2 folder to load this model.' : 'Import and link a model file for this character.') : String((e as Error).message) });
        this.onChange(true);
        return;
      }
      if (!type.glbBlobId) this.base.group.quaternion.copy(uprightCorrection(this.base));
      this.root.add(this.base.group);
      refit = true;
    }
    const base = this.base!;
    const paints = await loadPaints();

    // Cosmetics: resolve desired paths, load new ones, drop removed ones.
    const desired = new Map<string, string | null>();
    const itemCache = new Map<number, Awaited<ReturnType<typeof getItem>>>();
    for (const c of config.cosmetics) {
      if (c.defindex !== undefined) {
        const item = await getItem(c.defindex);
        itemCache.set(c.defindex, item);
        desired.set(c.uid, item ? cosmeticModelPath(item, c.style, type.cosmeticClass) ?? null : null);
      } else desired.set(c.uid, c.customModelPath ?? null);
    }
    for (const [uid, lc] of this.cosmetics) {
      if (desired.get(uid) !== lc.path) { this.removeCosmetic(uid); }
    }
    const statuses: Record<string, CosmeticStatus> = {};
    for (const c of config.cosmetics) {
      const path = desired.get(c.uid) ?? null;
      if (!path) { statuses[c.uid] = { uid: c.uid, state: 'metadata-only', message: 'No 3D model in the item schema.' }; continue; }
      if (this.cosmetics.has(c.uid)) { statuses[c.uid] = this.status.cosmetics[c.uid] ?? { uid: c.uid, state: 'ready', path }; continue; }
      if (!modelAvailable(path)) { statuses[c.uid] = { uid: c.uid, state: 'missing', path, message: 'Model file not found. Link TF2 or import it.' }; continue; }
      this.emit({ cosmetics: { [c.uid]: { uid: c.uid, state: 'loading', path } } });
      try {
        const model = await loadSourceModel(path);
        if (this.base !== base) { disposeModel(model); return; }
        const unmatched = bonemerge(model, base);
        const box = new Box3();
        for (const { mesh } of model.meshes) { mesh.geometry.computeBoundingBox(); box.union(mesh.geometry.boundingBox!); }
        const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
        for (const { mesh } of model.meshes) base.group.add(mesh);
        this.cosmetics.set(c.uid, { path, model, center });
        const warn = unmatched.length && type.skeleton !== 'tf2-biped' ? `${unmatched.length} bones did not match this skeleton.` : undefined;
        statuses[c.uid] = { uid: c.uid, state: 'ready', path, unmatchedBones: unmatched, message: warn ?? model.warnings[0] };
      } catch (e) {
        statuses[c.uid] = { uid: c.uid, state: 'error', path, message: String((e as Error).message) };
      }
    }

    // Base appearance.
    const teamSkin = type.teamSkins?.[config.team] ?? (config.team === 'blu' ? 1 : 0);
    setSkin(base, config.skin ?? teamSkin);
    const bodygroups: Record<string, number> = {};
    for (const c of config.cosmetics) {
      if (!c.visible || c.defindex === undefined) continue;
      const item = itemCache.get(c.defindex);
      const style = item?.styles?.find((s) => s.id === c.style);
      for (const bg of [...(item?.hideBodygroups ?? []), ...(style?.hideBodygroups ?? [])]) bodygroups[bg] = 1;
    }
    Object.assign(bodygroups, config.bodygroups);
    setBodygroups(base, bodygroups);
    const missingBones = applyPose(base, config.pose);

    // Per-cosmetic appearance.
    for (const c of config.cosmetics) {
      const lc = this.cosmetics.get(c.uid);
      if (!lc) continue;
      const item = c.defindex !== undefined ? itemCache.get(c.defindex) : undefined;
      const style = item?.styles?.find((s) => s.id === c.style);
      const styleSkin = config.team === 'blu' ? style?.skinBlu : style?.skinRed;
      setSkin(lc.model, styleSkin ?? (config.team === 'blu' ? 1 : 0));
      const paint: Paint | undefined = c.paint != null ? paints.find((p) => p.id === c.paint) : undefined;
      const rgb = c.customColor ?? (paint ? paintColor(paint, config.team) : null);
      for (const m of lc.model.materials) applyPaint(m as SourceMaterial, rgb);
      const q = new Quaternion().setFromEuler(new Euler(...c.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
      const offset = new Matrix4().makeTranslation(lc.center.x + c.offset[0], lc.center.y + c.offset[1], lc.center.z + c.offset[2])
        .multiply(new Matrix4().compose(new Vector3(), q, new Vector3(c.scale, c.scale, c.scale)))
        .multiply(new Matrix4().makeTranslation(-lc.center.x, -lc.center.y, -lc.center.z));
      for (const { mesh } of lc.model.meshes) { mesh.visible = c.visible; (mesh as SkinnedMesh).bindMatrix.copy(offset); }
    }

    const warnings = [...base.warnings];
    if (config.pose !== 'reference' && missingBones.length) warnings.push(`Pose skipped bones not in this skeleton: ${[...new Set(missingBones)].join(', ')}`);
    this.emit({
      base: 'ready', message: undefined,
      baseInfo: { path: base.path, bodygroups: base.bodygroups, skinCount: base.skinCount, boneCount: base.bones.length, warnings, poseSupported: poseSupported(base), checksum: base.checksum },
      cosmetics: statuses,
    });
    // Replace (not merge) so removed cosmetics drop out of the status.
    this.status.cosmetics = statuses;
    this.onStatus(this.status);
    this.onChange(refit);
  }

  private removeCosmetic(uid: string) {
    const lc = this.cosmetics.get(uid);
    if (!lc) return;
    for (const { mesh } of lc.model.meshes) mesh.removeFromParent();
    disposeModel(lc.model);
    this.cosmetics.delete(uid);
  }

  private clearCosmetics() {
    for (const uid of [...this.cosmetics.keys()]) this.removeCosmetic(uid);
  }

  /** Bounding box of visible geometry in world space (Y-up). */
  bounds(): Box3 {
    const box = new Box3();
    this.root.updateMatrixWorld(true);
    this.root.traverseVisible((o) => {
      const m = o as SkinnedMesh;
      if ((m as { isMesh?: boolean }).isMesh && m.geometry) {
        m.computeBoundingBox();
        if (m.boundingBox) box.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld));
      }
    });
    return box;
  }

  /** Model file identities for manifests. */
  loadedModels() {
    return {
      base: this.base ? { path: this.base.path, checksum: this.base.checksum } : null,
      cosmetics: [...this.cosmetics.entries()].map(([uid, lc]) => ({ uid, path: lc.path, checksum: lc.model.checksum })),
    };
  }

  dispose() {
    this.clearCosmetics();
    if (this.base) { this.root.remove(this.base.group); disposeModel(this.base); this.base = null; }
    this.baseKey = '';
    void releaseTextures(new Set<Texture>());
  }
}

async function loadGlbBase(blobId: string): Promise<SourceModel> {
  const rec = await getBlob(blobId);
  if (!rec) throw new MissingAssetError([`glb:${blobId}`]);
  const gltf = await new GLTFLoader().parseAsync(await rec.blob.arrayBuffer(), '');
  const group = new Group();
  group.name = rec.name;
  // glTF is Y-up (metres); convert to Source space (Z-up, inches) under the rig root.
  const holder = gltf.scene;
  holder.rotation.x = Math.PI / 2;
  const size = new Box3().setFromObject(holder).getSize(new Vector3());
  if (Math.max(size.x, size.y, size.z) < 10) holder.scale.setScalar(39.37);
  group.add(holder);
  group.updateMatrixWorld(true);
  const meshes: SourceModel['meshes'] = [];
  let skeleton: SourceModel['skeleton'] | null = null;
  holder.traverse((o) => {
    const m = o as SkinnedMesh;
    if ((m as { isMesh?: boolean }).isMesh) { m.frustumCulled = false; if (m.isSkinnedMesh) { skeleton ??= m.skeleton; meshes.push({ mesh: m, bodypart: 0, model: 0 }); } }
  });
  const sk = skeleton as SourceModel['skeleton'] | null;
  const bones = sk ? sk.bones : [];
  return {
    path: `glb:${rec.name}`, group, skeleton: sk!, bones, boneNames: bones.map((b) => b.name),
    bindPose: bones.map((b) => ({ position: b.position.toArray() as [number, number, number], quaternion: b.quaternion.toArray() as [number, number, number, number] })),
    meshes, bodygroups: [], skinCount: 1, materials: [], skinsTable: [[]], textures: [], checksum: 0,
    warnings: sk ? [] : ['GLB has no skeleton: poses and cosmetic attachment are unavailable.'],
  };
}
