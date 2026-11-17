# Asset pipeline

## Direct Source model loading (default)

SFMC Studio parses Source Engine assets in the browser. No conversion step is needed for TF2 content.

```
User's TF2 folder ──► VPK directory parser (src/lib/source/vpk.ts)
                        │  random-access reads via File/Blob.slice, nothing copied
                        ▼
MDL + VVD + VTX ─────► vendored MIT parsers (gkjohnson) + SFMC assembly (model.ts)
                        │  LOD 0, skin families, bodygroups, skeleton,
                        │  VTX struct-layout auto-detection (25/27 vs 33/35 bytes)
VMT ─────────────────► KeyValues parser (kv.ts), "patch" materials resolved
VTF ─────────────────► CPU decoder (vtf.ts): DXT1/3/5, BGRA/RGBA/RGB, 565, 4444, 5551, I8/IA88/A8
                        ▼
three.js SkinnedMesh + MeshStandardMaterial with TF2 paint blend
($blendtintbybasealpha, $blendtintcoloroverbase, $colortint_base)
```

Verified against a TF2 installation (November 2026): all nine class models, their 8 skin families (RED, BLU, über, zombie variants), bodygroups (hat, headphones, shoes_socks, dogtags and so on), and workshop cosmetics. MDL versions 44-49 are accepted.

### Orientation

TF2 player models are compiled with a reference pose that is not upright (their animations stand them up). SFMC computes an upright correction from the pelvis-to-head and foot-to-toe bone directions, so models stand on the floor facing forward. Poses are procedural bone rotations applied in that corrected frame.

### Cosmetic attachment (bonemerge)

TF2 cosmetics are authored on the class skeleton. SFMC re-binds each cosmetic mesh to the character's skeleton by bone name (the browser equivalent of SFM's bonemerge). Unmatched bones fall back to their nearest matched ancestor and are reported in the UI, which flags items that do not fit a custom skeleton.

### Known approximations

- **Lighting**: TF2's `$lightwarptexture`, phong and rim lighting are approximated with physically based shading.
- **Eyes**: Source's projected eyeball shader is not reproduced. Eyes render with their base material.
- **Unusual effects**: particle systems (PCF) are not rendered. Effect names are catalog metadata only.
- **Flexes and facial animation** are not applied.

## Imported models (Workshop, community, custom)

Imports accept loose `models/` and `materials/` trees or ZIPs. Each file is validated and stored in IndexedDB under its game-relative path. The imports provider has priority over VPKs, so an imported model can also override a stock path. An imported `.mdl` is linked to a catalog entry (Saxton Hale, female variants, custom types) on the Imports page. Links are stored per browser and included in backups.

## glTF / GLB conversion pipeline

When direct parsing is not suitable, for example models from other engines or edited meshes, use GLB:

1. **Export a converted character from SFMC** (Exports → *Export GLB*). It writes the currently rendered character (base + bonemerged cosmetics) as glTF binary. `extras.sfmc` on the scene root records the source MDL paths, VPK CRC32 or SHA-256 hashes, cosmetic UIDs and the character/type IDs, so the converted file stays associated with its original Source assets.
2. **Bring in your own GLB** (Imports → *Add GLB model*). It becomes a custom model type. glTF Y-up metres are converted to Source Z-up inches automatically. Skins and bodygroups are not available for GLB; TF2 cosmetics only follow a GLB if its bone names match the TF2 skeleton.
3. **Offline conversion of MDL to GLB** (optional): decompile with [Crowbar](https://steamcommunity.com/groups/CrowbarTool), import the SMD/DMX into Blender with [Blender Source Tools](http://steamreview.org/BlenderSourceTools/), keep the original bone names, and export glTF 2.0 (`.glb`). Record the original `models/...mdl` path in the custom model type so manifests keep pointing at the real SFM asset.

Conversion does not change the licence of third-party assets. Do not publish converted Valve or Workshop models without permission.
