// Procedural pose presets for TF2-style bipeds. Each step aims a bone toward a
// direction in model space (Source: +X forward, +Y left, +Z up), measured from the
// bone to its child, so it works regardless of each model's reference pose.
import { Quaternion, Vector3, type Bone } from 'three';
import type { SourceModel } from '../lib/source/model';

type Step = { bone: string; child: string; dir: [number, number, number]; amount?: number } | { bone: string; rotate: [number, number, number]; deg: number };
export interface PoseDef { id: string; name: string; description: string; steps: Step[] }

const arms = (downL: [number, number, number], downR: [number, number, number], elbowL?: [number, number, number], elbowR?: [number, number, number]): Step[] => [
  { bone: 'bip_upperArm_L', child: 'bip_lowerArm_L', dir: downL },
  { bone: 'bip_upperArm_R', child: 'bip_lowerArm_R', dir: downR },
  ...(elbowL ? [{ bone: 'bip_lowerArm_L', child: 'bip_hand_L', dir: elbowL } as Step] : []),
  ...(elbowR ? [{ bone: 'bip_lowerArm_R', child: 'bip_hand_R', dir: elbowR } as Step] : []),
];

export const POSES: PoseDef[] = [
  { id: 'reference', name: 'Reference', description: 'The model\'s own bind pose, exactly as compiled.', steps: [] },
  { id: 'a-pose', name: 'A-pose', description: 'Arms angled down about 45°. Good for checking cosmetics on shoulders and arms.', steps: arms([0, 0.75, -0.66], [0, -0.75, -0.66]) },
  { id: 'relaxed', name: 'Relaxed', description: 'Arms at the sides with a slight elbow bend.', steps: arms([0.05, 0.25, -0.97], [0.05, -0.25, -0.97], [0.35, 0.12, -0.93], [0.35, -0.12, -0.93]) },
  { id: 'presentation', name: 'Presentation', description: 'Relaxed stance, head turned slightly toward camera left.', steps: [...arms([0.05, 0.28, -0.96], [0.1, -0.3, -0.95], [0.4, 0.1, -0.9], [0.45, -0.1, -0.88]), { bone: 'bip_head', rotate: [0, 0, 1], deg: 14 }, { bone: 'bip_spine_2', rotate: [0, 0, 1], deg: 6 }] },
  { id: 'hands-on-hips', name: 'Hands on hips', description: 'Elbows out, hands near the belt.', steps: arms([-0.1, 0.7, -0.7], [-0.1, -0.7, -0.7], [0.45, -0.55, -0.7], [0.45, 0.55, -0.7]) },
];

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpW = new Vector3();

export function resetPose(model: SourceModel) {
  model.bones.forEach((b, i) => { b.position.fromArray(model.bindPose[i].position); b.quaternion.fromArray(model.bindPose[i].quaternion); });
}

/** Model-space rotation of a bone (relative to the model root group). */
function modelQuat(bone: Bone, root: SourceModel['group'], out: Quaternion) {
  out.identity();
  let cur: Bone['parent'] = bone;
  const chain: Quaternion[] = [];
  while (cur && cur !== root) { chain.push(cur.quaternion); cur = cur.parent; }
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i]);
  return out;
}
function modelPos(bone: Bone, root: SourceModel['group'], out: Vector3) {
  bone.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);
  out.setFromMatrixPosition(bone.matrixWorld);
  return root.worldToLocal(out);
}

/** Rotate a bone by q expressed in model space. */
function rotateModelSpace(bone: Bone, root: SourceModel['group'], q: Quaternion) {
  const parentQ = bone.parent && bone.parent !== root ? modelQuat(bone.parent as Bone, root, new Quaternion()) : new Quaternion();
  const local = parentQ.clone().invert().multiply(q).multiply(parentQ);
  bone.quaternion.premultiply(local);
  bone.updateMatrixWorld(true);
}

export function applyPose(model: SourceModel, poseId: string): string[] {
  resetPose(model);
  model.group.updateMatrixWorld(true);
  const pose = POSES.find((p) => p.id === poseId);
  const missing: string[] = [];
  if (!pose) return missing;
  const find = (n: string) => model.bones.find((b) => b.name.toLowerCase() === n.toLowerCase());
  // Pose directions are authored in upright Source space (+X forward, +Z up); the group may carry
  // an upright correction, so map them into the group's local frame.
  const toLocal = model.group.quaternion.clone().invert();
  for (const s of pose.steps) {
    const bone = find(s.bone);
    if (!bone) { missing.push(s.bone); continue; }
    if ('rotate' in s) {
      rotateModelSpace(bone, model.group, tmpQ.setFromAxisAngle(new Vector3(...s.rotate).applyQuaternion(toLocal).normalize(), (s.deg * Math.PI) / 180));
      continue;
    }
    const child = find(s.child);
    if (!child) { missing.push(s.child); continue; }
    const a = modelPos(bone, model.group, tmpV.clone());
    const b = modelPos(child, model.group, tmpW.clone());
    const cur = b.sub(a).normalize();
    const target = new Vector3(...s.dir).applyQuaternion(toLocal).normalize();
    const q = new Quaternion().setFromUnitVectors(cur, target);
    if (s.amount !== undefined) q.slerp(new Quaternion(), 1 - s.amount);
    rotateModelSpace(bone, model.group, q);
  }
  return missing;
}

export function poseSupported(model: SourceModel) {
  return ['bip_upperArm_L', 'bip_upperArm_R', 'bip_lowerArm_L'].every((n) => model.boneNames.some((b) => b.toLowerCase() === n.toLowerCase()));
}
