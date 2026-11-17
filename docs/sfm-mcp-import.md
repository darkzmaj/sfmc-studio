# Using a Studio character in SFM-MCP (local, no network)

SFM-MCP (https://github.com/darkzmaj/SFM-MCP) can rebuild a Studio character inside **your own** Source Filmmaker and
animate it. Nothing leaves your PC: the SFM bridge listens on `127.0.0.1` only, and you move a file, not a connection.

1. In Studio, build the character: class, team (skin), bodygroups, cosmetics, paints.
2. **Export > Manifest** (`*.manifest.json`, format `sfmc.character.manifest` v1).
3. Put the file anywhere on the PC that runs SFM. In an MCP client (Claude Code, Codex) call
   `sfm_character_validate` (offline check and an availability report), then `sfm_live_import_character`.
4. SFM-MCP spawns the high-quality face model for the class (`models/player/hwm/<class>.mdl`) with the manifest's skin
   and bodygroups, then reports cosmetics. Anything not installed locally is **listed as missing**, never replaced
   by a different item.
5. Apply cinematic animation to the imported character (`sfm_live_skill`, `sfm_live_expression`, `sfm_live_speak`, ...).

## What the importer checks

* `format` is `sfmc.character.manifest` and `formatVersion` is not newer than the importer understands.
* Every model path is a lowercase, relative, forward-slash `models/**/*.mdl` path (no `..`, drive letters, backslashes,
  URLs). Unsafe paths are rejected, not repaired.
* Sizes, counts and numeric ranges are capped; unknown fields are ignored. The file is parsed as data only: nothing in it
  is ever executed, and text such as names or notes is never interpreted.
* Assets are looked up with SFM's own file system (loose files and VPKs). Missing models are reported.

## Limits

* Full acting (face rig, motion solver) is audited for **Scout and Engineer**. Other classes import and can use
  generic controls, but need `tools/probe_rig.py` rig data first.
* Cosmetic attachment depends on SFM's bone-merge support; see SFM-MCP's docs/CHARACTER_IMPORT.md for what was verified.
