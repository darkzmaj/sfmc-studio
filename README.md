# SFM Character Studio

**SFMC Studio** is an open-source, browser-based character creator and library for Source Filmmaker and Team Fortress 2 animation. Pick a mercenary, dress them in any cosmetic from the full TF2 item catalog, inspect them in a real 3D viewer, write who they are, and export a render plus a machine-readable spec you can reuse in every scene.

Official site: **https://sfmc-studio.kori.my** · By [Maj Kovačič](https://darkzmaj.eu) · KORI Network · MIT licensed

> Not affiliated with or endorsed by Valve Corporation. No Valve or Workshop assets are hosted or distributed by this project. Models and textures are read from your own TF2 installation, in your browser.

## Features

- **Real 3D models**: parses TF2's VPK archives and Source MDL/VVD/VTX/VTF/VMT files directly in the browser (three.js). Orbit, pan, zoom, front/back/left/right/top presets, perspective or orthographic camera, adjustable FOV, lighting presets, background colour, grid and floor, fullscreen.
- **All nine classes**, RED and BLU skins (plus über and zombie skin families), bodygroups and procedural poses (reference, A-pose, relaxed, presentation, hands on hips).
- **Complete cosmetic catalog**: about 9,600 cosmetics from the TF2 item schema with search, class, equip-region, paintable and 3D-availability filters and sorting, rendered in a virtualised list. Item icons are decoded from your own VPKs.
- **Equip without the three-item limit**, with duplicate prevention, equip-region clash warnings, class compatibility checks and clear "metadata only" or "model missing" states. Styles, all TF2 paints (team paints included), custom colours, per-item offset, rotation and scale, visibility and ordering.
- **Profiles**: name, nickname, long description, personality, voice, outfit, animation notes, special characteristics, story notes, tags and reference images, plus an automatic technical description generated from the configuration.
- **Library**: grid and list views, search, favourites, sorting, duplicate, rename, templates, delete with confirmation, version history, per-character import and export.
- **Exports**: PNG renders up to 8K (transparent or coloured background, any angle), JSON manifest (`sfmc.character.manifest` v1 with JSON Schema), Markdown spec, ZIP bundle, and GLB conversion with source identifiers.
- **Backups**: full-library ZIP with SHA-256 integrity checks, restore with conflict detection (keep both, overwrite or skip), and backup reminders.
- **Community models**: import Saxton Hale, female variants or any Workshop model you may use (folder or ZIP, validated), then link it to a catalog entry. Add your own model types without code.
- **Undo and redo**, autosaved drafts, keyboard shortcuts, responsive layout.

## Privacy architecture

- Every visitor's characters, descriptions, images, imports and settings are stored **only in their own browser** (IndexedDB, per origin). There is no account, no server database, no sharing, no public URL and no analytics.
- The server is static nginx. It cannot see or return anyone's projects. Another visitor cannot access your data.
- Your TF2 folder is read in place. Nothing is uploaded.
- A strict Content Security Policy blocks all third-party requests.
- Browser storage is isolated per **browser profile and origin, not per person**: anyone using the same unlocked browser profile can open the library. Clearing site data, private windows or storage eviction can delete it, so the app reminds you to keep ZIP backups.

## Quick start (local)

```bash
git clone https://github.com/darkzmaj/sfmc-studio.git
cd sfmc-studio
npm ci
npm run dev
```

Open http://localhost:5173, go to **Imports → Choose TF2 folder** (Chrome or Edge; other browsers can select the `.vpk` files), then create a character. The built-in test mannequin works without any game files.

```bash
npm test        # vitest: parsers, storage, exports, backup round trip (+ optional local TF2 test)
npm run build   # type-check and production build into dist/
```

## Deploy (Docker / Coolify)

```bash
docker compose up -d --build     # http://localhost:8080, health check at /healthz
```

The image is a static nginx (non-root, read-only capable, about 80 MB) with security headers and SPA fallback. No volumes or environment variables are needed because the server stores nothing. Full Coolify instructions, DNS, HTTPS and HSTS: **[docs/deployment-coolify.md](docs/deployment-coolify.md)**.

## Documentation

- [Interchange format](docs/interchange-format.md): manifest fields and the planned SFM MCP integration.
- [Asset pipeline](docs/asset-pipeline.md): Source parsing, bonemerge, GLB conversion, known approximations.
- [Backups](docs/backups.md): backup format and restore rules.
- [Deployment](docs/deployment-coolify.md): Docker and Coolify.
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Browser support

Latest Chrome, Edge, Firefox and Safari with WebGL 2. Remembering the TF2 folder between visits needs the File System Access API (Chrome, Edge, Opera). Other browsers ask you to select the VPK files on each visit.

## Limitations

- TF2 does not ship Saxton Hale or female class player models. These entries need a community model you import yourself.
- Unusual particle effects, eye shaders, facial flexes and TF2's exact toon lighting are approximated or not rendered (see the asset pipeline doc).
- Poses are procedural presets, not TF2 animation sequences.
- No live SFM MCP connection yet: the MCP is unpublished and its SFM adapter is unimplemented. Manifests are designed for it.

## Licence

Application code and original assets © 2026 Maj Kovačič, released under the [MIT License](LICENSE). Team Fortress 2, Source Filmmaker and all related characters, items and artwork are property of Valve Corporation. Community models belong to their authors. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
