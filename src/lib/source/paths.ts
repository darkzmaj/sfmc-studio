// Lightweight path helpers (no three.js import) so catalog/availability checks stay out of the 3D chunk.
import { assets } from './assets';
import { normalizePath } from './vpk';

/** Paths of the companion files for a model. */
export function modelFiles(mdlPath: string) {
  const base = normalizePath(mdlPath).replace(/\.mdl$/, '');
  return { mdl: `${base}.mdl`, vvd: `${base}.vvd`, vtx: [`${base}.dx90.vtx`, `${base}.dx80.vtx`, `${base}.sw.vtx`, `${base}.vtx`] };
}

export function modelAvailable(mdlPath: string) {
  try {
    const f = modelFiles(mdlPath);
    return assets.has(f.mdl) && assets.has(f.vvd) && f.vtx.some((v) => assets.has(v));
  } catch { return false; }
}

let textureMaxSize = 2048;
export const getTextureMaxSize = () => textureMaxSize;
export function setTextureMaxSize(n: number) { textureMaxSize = n; }
