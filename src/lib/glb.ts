// Convert the currently rendered character (Source model + bonemerged cosmetics) to GLB.
// Source identifiers are preserved in glTF "extras" so the file stays traceable to its origin.
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Viewer } from '../viewer/Viewer';
import type { Manifest } from './exporters';

export async function exportGlb(viewer: Viewer, manifest: Manifest): Promise<Blob> {
  const root = viewer.rig.root;
  const prev = root.userData;
  root.userData = {
    sfmc: {
      format: 'sfmc.glb-conversion', formatVersion: 1,
      character: manifest.character.id, typeId: manifest.model.typeId,
      baseModel: viewer.rig.loadedModels().base,
      cosmetics: viewer.rig.loadedModels().cosmetics,
      assets: manifest.assets.map((a) => ({ path: a.path, origin: a.origin, vpkCrc32: a.vpkCrc32, sha256: a.sha256 })),
      note: 'Converted from Source Engine models for preview/interchange. Units: Source inches, rotated to glTF Y-up. Third-party asset rights are unchanged by conversion.',
    },
  };
  try {
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
  } finally {
    root.userData = prev;
  }
}
