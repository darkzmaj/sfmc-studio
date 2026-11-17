// VMT -> three.js material. Approximates VertexLitGeneric with MeshStandardMaterial
// plus TF2's paint blend ($blendtintbybasealpha / $colortint_base).
import {
  Color, DataTexture, DoubleSide, LinearMipmapLinearFilter, LinearFilter, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture,
} from 'three';
import { assets } from './assets';
import { kvString, kvVector, parseRoot, type KV } from './kv';
import { decodeVtf, type DecodedTexture } from './vtf';
import { normalizePath } from './vpk';

export interface MaterialInfo {
  name: string;
  vmtPath: string | null;
  shader: string;
  baseTexture: string | null;
  paintable: boolean;
  defaultTint: [number, number, number] | null;
  missing: boolean;
}

export interface SourceMaterial extends MeshStandardMaterial {
  userData: { info: MaterialInfo; tint: { value: Color }; tintOver: { value: number }; useTint: { value: number }; defaultTint: Color | null };
}

const texCache = new Map<string, Promise<Texture | null>>();
import { getTextureMaxSize } from './paths';

export function decodedToTexture(d: DecodedTexture, srgb: boolean): Texture {
  const tex = new DataTexture(d.data, d.width, d.height);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function loadTexture(path: string, srgb = true): Promise<Texture | null> {
  const p = `materials/${normalizePath(path).replace(/\.vtf$/, '')}.vtf`;
  const key = `${p}|${srgb}|${getTextureMaxSize()}`;
  let pr = texCache.get(key);
  if (!pr) {
    pr = assets.read(p).then((buf) => {
      if (!buf) return null;
      try { return decodedToTexture(decodeVtf(buf, getTextureMaxSize()), srgb); } catch (e) { console.warn('VTF', p, e); return null; }
    });
    texCache.set(key, pr);
  }
  return pr;
}

/** Dispose cached textures not referenced by `keep`. */
export async function releaseTextures(keep: Set<Texture>) {
  for (const [k, pr] of texCache) {
    const t = await pr;
    if (t && !keep.has(t)) { t.dispose(); texCache.delete(k); }
  }
}

async function readVmt(path: string, depth = 0): Promise<[string, KV] | null> {
  if (depth > 4) return null;
  const text = await assets.text(path);
  if (text == null) return null;
  const [shader, body] = parseRoot(text);
  if (shader.toLowerCase() === 'patch') {
    const inc = kvString(body, 'include');
    const base = inc ? await readVmt(normalizePath(inc), depth + 1) : null;
    if (!base) return null;
    const merged: KV = { ...base[1] };
    for (const section of ['insert', 'replace']) {
      const s = body[section];
      if (s && typeof s === 'object') Object.assign(merged, s);
    }
    return [base[0], merged];
  }
  return [shader, body];
}

export function resolveVmtPath(name: string, dirs: string[]): string | null {
  for (const d of dirs) {
    const p = normalizePath(`materials/${d}/${name}.vmt`);
    if (assets.has(p)) return p;
  }
  return null;
}

function makeMaterial(info: MaterialInfo): SourceMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 }) as SourceMaterial;
  m.userData = {
    info,
    tint: { value: new Color(1, 1, 1) },
    tintOver: { value: 0 },
    useTint: { value: 0 },
    defaultTint: null,
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = m.userData.tint;
    shader.uniforms.uTintOver = m.userData.tintOver;
    shader.uniforms.uUseTint = m.userData.useTint;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uTintOver;\nuniform float uUseTint;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec3 tinted = mix( sampledDiffuseColor.rgb * uTint, uTint, uTintOver );
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, tinted, sampledDiffuseColor.a * uUseTint );
          if ( uUseTint > 0.5 ) sampledDiffuseColor.a = 1.0;
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'sfmc-source';
  return m;
}

const fallbackInfo = (name: string): MaterialInfo => ({ name, vmtPath: null, shader: 'missing', baseTexture: null, paintable: false, defaultTint: null, missing: true });

export async function loadMaterial(name: string, dirs: string[]): Promise<SourceMaterial> {
  const vmtPath = resolveVmtPath(name, dirs);
  if (!vmtPath) {
    const m = makeMaterial(fallbackInfo(name));
    m.color.set(0x8a8580);
    return m;
  }
  const parsed = await readVmt(vmtPath);
  if (!parsed) return makeMaterial(fallbackInfo(name));
  const [shader, kv] = parsed;
  const s = shader.toLowerCase();
  const base = kvString(kv, '$basetexture') ?? kvString(kv, '$iris') ?? null;
  const blendTint = kvString(kv, '$blendtintbybasealpha') === '1';
  const defaultTint = kvVector(kvString(kv, '$colortint_base'));
  const info: MaterialInfo = { name, vmtPath, shader: s, baseTexture: base, paintable: blendTint, defaultTint: defaultTint ?? null, missing: false };
  const m = makeMaterial(info);

  if (base) {
    const tex = await loadTexture(base, true);
    if (tex) m.map = tex;
    else info.missing = true;
  }
  const bump = kvString(kv, '$bumpmap');
  if (bump && kvString(kv, '$ssbump') !== '1') {
    const nt = await loadTexture(bump, false);
    if (nt) { m.normalMap = nt; m.normalScale.set(1, -1); }
  }
  if (kvString(kv, '$translucent') === '1') { m.transparent = true; m.depthWrite = false; }
  if (kvString(kv, '$alphatest') === '1') m.alphaTest = Number(kvString(kv, '$alphatestreference') ?? 0.5) || 0.5;
  if (kvString(kv, '$nocull') === '1') m.side = DoubleSide;
  if (s === 'unlitgeneric') { m.emissive.set(0xffffff); m.emissiveMap = m.map; m.color.set(0); }
  if (s.includes('eye')) { m.roughness = 0.25; }

  if (blendTint) {
    m.userData.useTint.value = 1;
    m.userData.tintOver.value = Number(kvString(kv, '$blendtintcoloroverbase') ?? 0) || 0;
    if (defaultTint) {
      m.userData.defaultTint = new Color().setRGB(...defaultTint, SRGBColorSpace);
      m.userData.tint.value.copy(m.userData.defaultTint);
    }
  } else {
    const ct = kvVector(kvString(kv, '$color2') ?? kvString(kv, '$color'));
    if (ct) m.color.setRGB(...ct, SRGBColorSpace);
  }
  return m;
}

/** Apply a paint (sRGB 0-255 ints) or reset with null. */
export function applyPaint(m: SourceMaterial, rgb: [number, number, number] | null) {
  if (!m.userData.info?.paintable) return;
  if (rgb) m.userData.tint.value.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace);
  else if (m.userData.defaultTint) m.userData.tint.value.copy(m.userData.defaultTint);
  else m.userData.tint.value.setRGB(1, 1, 1);
}
