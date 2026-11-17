// Assemble a three.js object from MDL + VVD + VTX (LOD 0), with skin families,
// bodygroups and a shared skeleton that cosmetics can bonemerge onto.
import { Bone, BufferAttribute, BufferGeometry, Group, Quaternion, Skeleton, SkinnedMesh, Vector3, type Material } from 'three';
// Vendored MIT parsers (gkjohnson/source-engine-model-loader)
import { MDLLoader } from './vendor/MDLLoader.js';
import { VVDLoader } from './vendor/VVDLoader.js';
import { parseVtx } from './vendor/VTXLoader.js';
import { assets } from './assets';
import { loadMaterial, type SourceMaterial } from './material';
import { modelFiles, modelAvailable } from './paths';
export { modelFiles, modelAvailable };

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
  const vtx = parseVtx(vtxBuf!);
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
    const tex: number[] | undefined = mesh.userData.textureIndexByGroup;
    if (!tex) continue;
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
 * Bonemerge: drive a cosmetic with the character's bones (matched by name), the way Source's
 * bonemerge does. Each cosmetic bone i is rendered with targetBone.matrixWorld * cosmeticInverseBind[i],
 * so items compiled with their own reference pose (common for older hats, whose head bone sits near
 * the origin) still land on the matching bone. Unmatched bones follow their nearest matched ancestor.
 * Returns the names of cosmetic bones that had no match on the target.
 */
export function bonemerge(cosmetic: SourceModel, target: SourceModel): string[] {
  const byName = new Map(target.bones.map((b) => [b.name.toLowerCase(), b]));
  const unmatched: string[] = [];
  const bones: Bone[] = [];
  const inverses = cosmetic.skeleton.boneInverses.map((m) => m.clone());
  cosmetic.bones.forEach((b, i) => {
    if (!byName.has(b.name.toLowerCase())) unmatched.push(b.name);
    let cur: Bone | null = b;
    let hit: Bone | undefined;
    while (cur && (cur as Bone).isBone) {
      hit = byName.get(cur.name.toLowerCase());
      if (hit) break;
      cur = cur.parent as Bone | null;
    }
    if (hit && cur !== b && cur) {
      // Follow the matched ancestor using that ancestor's inverse bind.
      const ai = cosmetic.bones.indexOf(cur);
      if (ai >= 0) inverses[i] = cosmetic.skeleton.boneInverses[ai].clone();
    }
    bones.push(hit ?? target.bones[0]);
  });
  const skeleton = new Skeleton(bones, inverses);
  for (const { mesh } of cosmetic.meshes) mesh.bind(skeleton, mesh.bindMatrix);
  return unmatched;
}

/**
 * TF2 player models are compiled with a reference pose that is not upright (animations stand
 * them up). Find the rotation that makes pelvis->head point +Z (Source up) and foot->toe point +X
 * (forward). Returns identity when the needed bones are missing or already aligned.
 */
export function uprightCorrection(model: SourceModel): Quaternion {
  const q = new Quaternion();
  const find = (...names: string[]) => model.bones.find((b) => names.includes(b.name.toLowerCase()));
  const pelvis = find('bip_pelvis', 'pelvis', 'valvebiped.bip01_pelvis');
  const head = find('bip_head', 'head', 'valvebiped.bip01_head1');
  if (!pelvis || !head) return q;
  model.group.updateMatrixWorld(true);
  const inv = model.group.matrixWorld.clone().invert();
  const pos = (b: Bone) => new Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
  const up = pos(head).sub(pos(pelvis)).normalize();
  if (up.lengthSq() < 0.5) return q;
  q.setFromUnitVectors(up, new Vector3(0, 0, 1));
  const foot = find('bip_foot_l', 'bip_foot_r', 'valvebiped.bip01_l_foot');
  const toe = find('bip_toe_l', 'bip_toe_r', 'valvebiped.bip01_l_toe0');
  if (foot && toe) {
    const fwd = pos(toe).sub(pos(foot)).applyQuaternion(q);
    fwd.z = 0;
    if (fwd.lengthSq() > 1e-6) q.premultiply(new Quaternion().setFromUnitVectors(fwd.normalize(), new Vector3(1, 0, 0)));
  }
  return q;
}

export function disposeModel(model: SourceModel) {
  for (const { mesh } of model.meshes) mesh.geometry.dispose();
  for (const m of model.materials) m.dispose();
}
