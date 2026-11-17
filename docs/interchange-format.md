# Character interchange format (v1)

SFMC Studio exports three related files. All are plain JSON or Markdown and are generated in the browser.

| File | Format id | Purpose |
|---|---|---|
| `*.manifest.json` | `sfmc.character.manifest` v1 | Resolved, machine-readable spec for tools (an SFM MCP server, scripts). Schema: [`public/schema/sfmc-character-manifest.v1.schema.json`](../public/schema/sfmc-character-manifest.v1.schema.json) |
| `*.sfmc-character.json` | `sfmc.character` v1 | The editable character record (what the library stores). Re-importable on the Characters page. |
| `character.md` | Markdown | Human-readable spec for people and LLM agents (Claude, Codex). |

A ZIP bundle contains all three plus `render.png`, reference images and a README that lists external assets which were deliberately **not** included.

## Design goals

The manifest is designed so a future SFM MCP server can, without any guessing:

1. **Load a preset**: `character.profile` and `model.typeId`.
2. **Resolve model dependencies**: `assets[]` lists every MDL with its companion files, its origin (`tf2-vpk`, `user-import`, `missing`), the VPK CRC32 or the imported file's SHA-256, and `dependencies` lists Workshop requirements.
3. **Spawn the model**: `model.modelPath` (game-relative, e.g. `models/player/scout.mdl`).
4. **Apply skins and bodygroups**: `model.skin` (resolved from team unless overridden) and `model.bodygroups` (explicit overrides; cosmetic-driven hiding comes from the item schema, see below).
5. **Attach cosmetics**: `cosmetics[]` in user order, each with `defindex`, resolved per-class `modelPath`, `style`, `paint.rgb`, an optional `customColor`, and a `transform` relative to the bonemerged default position.
6. **Read personality and animation instructions**: `character.profile.personality`, `voice`, `animationNotes`, `story`.

## Conventions

- Paths are lowercase, forward-slash, game-relative. They are never local filesystem paths.
- `availableLocally: true` means the file existed in the exporting user's linked TF2 VPKs or imports at export time. Paths that were not verified are still listed (they come from the item schema) and are flagged.
- Transforms use Source units in model space: +X forward, +Y left, +Z up. Rotation is Euler XYZ in degrees around the item's own bounding-box centre. Scale is uniform.
- Paint RGB is the in-game tint for the character's team (team paints have different RED and BLU values). Custom colours are not possible in TF2 itself and are marked as `customColor`.
- Bodygroup hiding: TF2 items declare `player_bodygroups` (for example a hat hides the default `hat` bodygroup). SFMC applies these automatically; `model.bodygroups` holds only the user's explicit overrides.
- Poses are procedural presets (`model.pose.procedural: true`), not animation sequences.

## Versioning

- `formatVersion` is an integer. Additive, optional fields do not bump it.
- Removing or changing the meaning of a field bumps it. Consumers should reject versions newer than they understand.
- Backups use a separate format (`sfmc.backup` v1, see [backups.md](backups.md)).

## Example (abridged)

```json
{
  "format": "sfmc.character.manifest",
  "formatVersion": 1,
  "character": { "id": "4b09…", "version": 3, "profile": { "name": "Pink Hood Scout", "personality": "Energetic, sarcastic" } },
  "model": { "typeId": "tf2.scout", "modelPath": "models/player/scout.mdl", "team": "blu", "skin": 1, "bodygroups": {}, "pose": { "id": "hands-on-hips", "procedural": true } },
  "cosmetics": [{
    "name": "Brotherhood of Arms", "defindex": 30066,
    "modelPath": "models/workshop/player/items/all_class/brotherhood_2/brotherhood_2_scout.mdl",
    "paint": { "defindex": 5051, "name": "Pink as Hell", "rgb": [255, 105, 180] },
    "transform": { "offset": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": 1 }, "visible": true
  }],
  "assets": [{ "role": "base-model", "path": "models/player/scout.mdl", "origin": "tf2-vpk", "vpkCrc32": "7eafc16b", "availableLocally": true }],
  "dependencies": { "requiresTf2": true, "workshop": [] }
}
```

## MCP status

No live MCP connection is implemented: the SFM MCP project is unpublished and its real SFM adapter is not finished, so there is no compatible API to talk to. Export is standalone. A future MCP tool can accept a manifest path or JSON body and use the fields above.
