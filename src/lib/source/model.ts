// Assemble a three.js object from MDL + VVD + VTX (LOD 0), with skin families,
// bodygroups and a shared skeleton that cosmetics can bonemerge onto.
import { Bone, BufferAttribute, BufferGeometry, Group, Skeleton, SkinnedMesh, type Material } from 'three';
// Vendored MIT parsers (gkjohnson/source-engine-model-loader)
import { MDLLoader } from './vendor/MDLLoader.js';
import { VVDLoader } from './vendor/VVDLoader.js';
import { parseVtx } from './vendor/VTXLoader.js';
import { assets } from './assets';
import { loadMaterial, type SourceMaterial } from './material';
import { normalizePath } from './vpk';

export interface BodygroupInfo { name: string; options: string[] }

export interface SourceModel {
  path: string;
  group: Group;
  skeleton: Skeleton;
  bones: Bone[];
  boneNames: string[];
  bindPose: { position: [number, number, number]; quaternion: [number, number, number, number] }[];
  meshes: { mesh: SkinnedMesh; bodypart: number; model: number }[];
  bodygroups: BodygroupInfo[];
  skinCount: number;
  materials: SourceMaterial[];
  skinsTable: number[][];
  textures: string[];
  checksum: number;
  warnings: string[];
}

export class MissingAssetError extends Error {
  missing: string[];
  constructor(missing: string[]) { super(`Missing model files: ${missing.join(', ')}`); this.missing = missing; }
}

/** Paths of the companion files for a model. */
export function modelFiles(mdlPath: string) {
  const base = normalizePath(mdlPath).replace(/\.mdl$/, '');
  return { mdl: `${base}.mdl`, vvd: `${base}.vvd`, vtx: [`${base}.dx90.vtx`, `${base}.dx80.vtx`, `${base}.sw.vtx`, `${base}.vtx`] };
}

export function modelAvailable(mdlPath: string) {
  const f = modelFiles(mdlPath);
  return assets.has(f.mdl) && assets.has(f.vvd) && f.vtx.some((v) => assets.has(v));
}

export async function loadSourceModel(mdlPath: string): Promise<SourceModel> {
  const f = modelFiles(mdlPath);
  const vtxPath = f.vtx.find((v) => assets.has(v));
  const [mdlBuf, vvdBuf, vtxBuf] = await Promise.all([assets.read(f.mdl), assets.read(f.vvd), vtxPath ? assets.read(vtxPath) : null]);
  const missing = [!mdlBuf && f.mdl, !vvdBuf && f.vvd, !vtxBuf && f.vtx[0]].filter(Boolean) as string[];
  if (missing.length) throw new MissingAssetError(missing);

  const head = new DataView(mdlBuf!);
  if (head.getUint32(0, true) !== 0x54534449) throw new Error('Not an MDL file (bad IDST signature)');
  const version = head.getInt32(4, true);
  if (version < 44 || version > 49) throw new Error(`Unsupported MDL version ${version} (supported: 44-49)`);

  const mdl = new MDLLoader().parse(mdlBuf);
  const vvd = new VVDLoader().parse(vvdBuf);
  const vtx = parseVtx(vtxBuf);
  const warnings: string[] = [];
  if (mdl.header.checksum !== vvd.header.checksum || mdl.header.checksum !== vtx.header.checksum) warnings.push('File checksums do not match (MDL/VVD/VTX from different builds).');

  const dirs: string[] = mdl.textureDirectories.map((d: string) => d.replace(/\\/g, '/'));
  const materials = await Promise.all(mdl.textures.map((t: string) => loadMaterial(t.replace(/\\/g, '/'), dirs)));
  materials.forEach((m: SourceMaterial) => { if (m.userData.info.missing) warnings.push(`Material not found: ${m.userData.info.name}`); });

  const group = new Group();
  group.name = f.mdl;
  const bones: Bone[] = mdl.bones.map((b: any) => {
    const bone = new Bone();
    bone.name = b.name;
    bone.position.copy(b.pos);
    bone.quaternion.copy(b.quaternion);
    return bone;
  });
  bones.forEach((b, i) => {
    const parent = mdl.bones[i].parent;
    (parent < 0 ? group : bones[parent]).add(b);
  });
  if (!bones.length) { const b = new Bone(); b.name = 'root'; bones.push(b); group.add(b); }
  const bindPose = bones.map((b) => ({ position: b.position.toArray() as [number, number, number], quaternion: b.quaternion.toArray() as [number, number, number, number] }));
  group.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);

  const vtxView = new DataView(vtx.buffer);
  const meshes: SourceModel['meshes'] = [];
  const bodygroups: BodygroupInfo[] = [];
  vtx.bodyParts.forEach((vbp: any, bpi: number) => {
    const mbp = mdl.bodyParts[bpi];
    if (!mbp) return;
    bodygroups.push({ name: mbp.name, options: mbp.models.map((m: any) => (m.nummeshes ? m.name : '(none)')) });
    vbp.models.forEach((vm: any, mi: number) => {
      const mm = mbp.models[mi];
      const lod = vm.lods[0];
      if (!mm || !lod || mm.nummeshes !== lod.numMeshes) return;
      const indices: number[] = [];
      const geometry = new BufferGeometry();
      lod.meshes.forEach((vmesh: any, mei: number) => {
        const mmesh = mm.meshes[mei];
        const start = indices.length;
        for (const sg of vmesh.stripGroups) {
          for (const strip of sg.strips) {
            const local: number[] = [];
            for (let k = 0; k < strip.numIndices; k++) {
              const i2 = vtxView.getUint16(sg.indexDataStart + (strip.indexOffset + k) * 2, true);
              const orig = vtxView.getUint16(sg.vertexDataStart + i2 * 9 + 4, true);
              local.push(orig + mmesh.vertexoffset + mm.vertexindex / 48);
            }
            if (strip.flags & 2) {
              for (let k = 2; k < local.length; k++) {
                const [a, b, c] = k % 2 ? [local[k - 1], local[k - 2], local[k]] : [local[k - 2], local[k - 1], local[k]];
                if (a !== b && b !== c && a !== c) indices.push(a, c, b);
              }
            } else {
              for (let k = 0; k + 2 < local.length; k += 3) indices.push(local[k], local[k + 2], local[k + 1]);
            }
          }
        }
        geometry.addGroup(start, indices.length - start, mmesh.material);
      });
      if (!indices.length) return;
      const maxIndex = indices.reduce((a, b) => (a > b ? a : b), 0);
      geometry.setIndex(new BufferAttribute(maxIndex > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
      for (const k of ['position', 'normal', 'uv', 'skinWeight', 'skinIndex'] as const) geometry.setAttribute(k, vvd.attributes[k]);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new SkinnedMesh(geometry, materials as Material[]);
      mesh.name = `${mbp.name}/${mm.name}`;
      mesh.frustumCulled = false;
      mesh.userData.textureIndexByGroup = geometry.groups.map((g) => g.materialIndex);
      group.add(mesh);
      mesh.bind(skeleton);
      meshes.push({ mesh, bodypart: bpi, model: mi });
    });
  });

  const model: SourceModel = {
    path: f.mdl, group, skeleton, bones, boneNames: bones.map((b) => b.name), bindPose, meshes, bodygroups,
    skinCount: Math.max(1, mdl.skinsTable.length), materials, skinsTable: mdl.skinsTable,
    textures: mdl.textures, checksum: mdl.header.checksum, warnings,
  };
  setSkin(model, 0);
  return model;
}

/** Remap each group's material index through the skin family table. */
export function setSkin(model: SourceModel, family: number) {
  const row = model.skinsTable[Math.min(Math.max(0, family), model.skinsTable.length - 1)] ?? [];
  for (const { mesh } of model.meshes) {
    const tex: number[] = mesh.userData.textureIndexByGroup;
    mesh.geometry.groups.forEach((g, i) => { g.materialIndex = row[tex[i]] ?? tex[i]; });
  }
}

/** bodygroups: name -> selected model index. Unlisted bodyparts show model 0. */
export function setBodygroups(model: SourceModel, selection: Record<string, number>) {
  for (const m of model.meshes) {
    const name = model.bodygroups[m.bodypart]?.name;
    m.mesh.visible = (selection[name] ?? 0) === m.model;
  }
}

/**
 * Bonemerge: rebind a cosmetic's meshes to the character skeleton by bone name.
 * Unmatched bones fall back to the nearest matched ancestor. Returns unmatched bone names.
 */
export function bonemerge(cosmetic: SourceModel, target: SourceModel): string[] {
  const byName = new Map(target.boneNames.map((n, i) => [n.toLowerCase(), i]));
  const unmatched: string[] = [];
  const map = cosmetic.bones.map((b) => {
    let cur: any = b;
    while (cur && cur.isBone) {
      const hit = byName.get(cur.name.toLowerCase());
      if (hit !== undefined) return hit;
      cur = cur.parent;
    }
    return 0;
  });
  cosmetic.bones.forEach((b, i) => { if (!byName.has(b.name.toLowerCase())) unmatched.push(b.name); });
  for (const { mesh } of cosmetic.meshes) {
    const src = mesh.geometry.getAttribute('skinIndex');
    const arr = new Uint16Array(src.count * 4);
    for (let v = 0; v < src.count; v++) for (let c = 0; c < 4; c++) arr[v * 4 + c] = map[src.getComponent(v, c)] ?? 0;
    mesh.geometry.setAttribute('skinIndex', new BufferAttribute(arr, 4));
    mesh.bind(target.skeleton, mesh.bindMatrix);
  }
  return unmatched;
}

export function disposeModel(model: SourceModel) {
  for (const { mesh } of model.meshes) mesh.geometry.dispose();
  for (const m of model.materials) m.dispose();
}
