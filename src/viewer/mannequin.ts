// Original procedural test mannequin (MIT). TF2-style bone names so poses and
// the editor work without any game files. Units: Source inches, Z-up.
import { Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, Group, Matrix4, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SourceModel } from '../lib/source/model';
import type { SourceMaterial } from '../lib/source/material';

type BoneDef = [name: string, parent: string | null, pos: [number, number, number]];
// Positions are relative to parent.
const BONES: BoneDef[] = [
  ['bip_pelvis', null, [0, 0, 38]],
  ['bip_spine_0', 'bip_pelvis', [0, 0, 4]],
  ['bip_spine_1', 'bip_spine_0', [0, 0, 5]],
  ['bip_spine_2', 'bip_spine_1', [0, 0, 5]],
  ['bip_spine_3', 'bip_spine_2', [0, 0, 5]],
  ['bip_neck', 'bip_spine_3', [0, 0, 6]],
  ['bip_head', 'bip_neck', [0, 0, 3.5]],
  ['bip_collar_L', 'bip_spine_3', [0, 2, 4]],
  ['bip_upperArm_L', 'bip_collar_L', [0, 5, 0]],
  ['bip_lowerArm_L', 'bip_upperArm_L', [0, 10.5, 0]],
  ['bip_hand_L', 'bip_lowerArm_L', [0, 10, 0]],
  ['bip_collar_R', 'bip_spine_3', [0, -2, 4]],
  ['bip_upperArm_R', 'bip_collar_R', [0, -5, 0]],
  ['bip_lowerArm_R', 'bip_upperArm_R', [0, -10.5, 0]],
  ['bip_hand_R', 'bip_lowerArm_R', [0, -10, 0]],
  ['bip_hip_L', 'bip_pelvis', [0, 4, -1]],
  ['bip_knee_L', 'bip_hip_L', [0, 0, -17.5]],
  ['bip_foot_L', 'bip_knee_L', [0, 0, -17]],
  ['bip_toe_L', 'bip_foot_L', [5, 0, -2.5]],
  ['bip_hip_R', 'bip_pelvis', [0, -4, -1]],
  ['bip_knee_R', 'bip_hip_R', [0, 0, -17.5]],
  ['bip_foot_R', 'bip_knee_R', [0, 0, -17]],
  ['bip_toe_R', 'bip_foot_R', [5, 0, -2.5]],
];

// [bone, geometry, local offset from bone, orientation axis]
function limb(len: number, r: number, axis: 'x' | 'y' | 'z', sign = 1) {
  const g = new CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 12);
  const q = new Quaternion();
  if (axis === 'x') q.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
  if (axis === 'z') q.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0, 1));
  g.applyQuaternion(q);
  const off = new Vector3(axis === 'x' ? len / 2 : 0, axis === 'y' ? (len / 2) * sign : 0, axis === 'z' ? (len / 2) * sign : 0);
  return { g, off };
}

export function createMannequin(): SourceModel {
  const group = new Group();
  group.name = 'sfmc-mannequin';
  const bones: Bone[] = [];
  const byName = new Map<string, Bone>();
  for (const [name, parent, pos] of BONES) {
    const b = new Bone();
    b.name = name;
    b.position.set(...pos);
    (parent ? byName.get(parent)! : group).add(b);
    bones.push(b);
    byName.set(name, b);
  }
  group.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);

  const parts: { bone: string; g: BufferGeometry; off: Vector3 }[] = [];
  const add = (bone: string, part: { g: BufferGeometry; off: Vector3 }) => parts.push({ bone, ...part });
  add('bip_pelvis', { g: new BoxGeometry(7, 13, 9), off: new Vector3(0, 0, 2) });
  add('bip_spine_1', { g: new BoxGeometry(7.5, 13.5, 12), off: new Vector3(0, 0, 2) });
  add('bip_spine_3', { g: new BoxGeometry(8, 16, 10), off: new Vector3(0, 0, 1) });
  add('bip_neck', limb(4, 1.6, 'z'));
  { const g = new SphereGeometry(4.6, 20, 16); g.scale(1.05, 0.95, 1.1); add('bip_head', { g, off: new Vector3(0.6, 0, 4) }); }
  { const g = new BoxGeometry(2.2, 3.2, 1.2); add('bip_head', { g, off: new Vector3(4.6, 0, 3.2) }); } // nose block marks the front
  for (const s of ['L', 'R'] as const) {
    const sign = s === 'L' ? 1 : -1;
    add(`bip_upperArm_${s}`, limb(10.5, 1.9, 'y', sign));
    add(`bip_lowerArm_${s}`, limb(10, 1.6, 'y', sign));
    add(`bip_hand_${s}`, { g: new BoxGeometry(2.4, 4, 1.4), off: new Vector3(0, 2 * sign, 0) });
    add(`bip_hip_${s}`, limb(17.5, 2.6, 'z', -1));
    add(`bip_knee_${s}`, limb(17, 2.1, 'z', -1));
    add(`bip_foot_${s}`, { g: new BoxGeometry(8, 3.6, 2.6), off: new Vector3(2.5, 0, -1.4) });
  }

  const geos = parts.map(({ bone, g, off }) => {
    const b = byName.get(bone)!;
    const geo = g.toNonIndexed();
    geo.applyMatrix4(new Matrix4().makeTranslation(off.x, off.y, off.z).premultiply(b.matrixWorld));
    geo.deleteAttribute('uv');
    const n = geo.getAttribute('position').count;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    const bi = bones.indexOf(b);
    for (let i = 0; i < n; i++) { idx[i * 4] = bi; w[i * 4] = 1; }
    geo.setAttribute('skinIndex', new BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new BufferAttribute(w, 4));
    return geo;
  });
  const geometry = mergeGeometries(geos)!;
  geometry.computeVertexNormals();
  geometry.clearGroups();
  geometry.addGroup(0, geometry.getAttribute('position').count, 0);

  const mat = (hex: string) => {
    const m = new MeshStandardMaterial({ color: new Color(hex), roughness: 0.6, metalness: 0 }) as SourceMaterial;
    m.userData = { info: { name: 'mannequin', vmtPath: null, shader: 'procedural', baseTexture: null, paintable: false, defaultTint: null, missing: false }, tint: { value: new Color() }, tintOver: { value: 0 }, useTint: { value: 0 }, defaultTint: null };
    return m;
  };
  const materials = [mat('#a8483c'), mat('#4a6a8c')];
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = 'mannequin';
  mesh.frustumCulled = false;
  mesh.userData.textureIndexByGroup = [0];
  group.add(mesh);
  mesh.bind(skeleton);

  return {
    path: 'builtin:mannequin', group, skeleton, bones, boneNames: bones.map((b) => b.name),
    bindPose: bones.map((b) => ({ position: b.position.toArray() as [number, number, number], quaternion: b.quaternion.toArray() as [number, number, number, number] })),
    meshes: [{ mesh, bodypart: 0, model: 0 }], bodygroups: [], skinCount: 2, materials, skinsTable: [[0], [1]], textures: [], checksum: 0, warnings: [],
  };
}
