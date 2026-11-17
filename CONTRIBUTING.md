# Contributing

Thanks for helping improve SFM Character Studio. Issues and pull requests are welcome.

## Development setup

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit and integration tests (vitest)
npm run build      # type-check and production build
```

Node 22 or newer is recommended.

### Testing with your own TF2 files

The app reads VPKs through the File System Access API or a file picker. For local development there is a dev-server-only endpoint that serves your installation's VPKs with HTTP range requests:

```bash
TF2_ROOT="/path/to/Steam/steamapps/common/Team Fortress 2" npm run dev
# then open http://localhost:5173/?devtf2
```

`tests/tf2-local.test.ts` runs against a local install when `TF2_DIR` points at its `tf` folder, and skips otherwise.

### Regenerating the cosmetic catalog

```bash
TF2_DIR="/path/to/Team Fortress 2/tf" npm run catalog
```

Without `TF2_DIR` the script keeps English names from the existing catalog. The weekly GitHub workflow does the same and opens a pull request when items change.

## Ground rules

- **Never commit game or Workshop assets** (`.vpk .mdl .vvd .vtx .vtf .vmt` and similar; `.gitignore` blocks them). Tests must not depend on them, apart from the opt-in local test.
- **Keep visitor data in the browser.** Do not add server-side storage, analytics, trackers or third-party network requests. The CSP blocks them anyway.
- **Validate untrusted input** at every boundary: imports, backups, character files.
- Keep UI copy plain and specific. No fake features: if something only works with local assets, say so in the UI.
- Run `npm test` and `npm run build` before opening a PR, and add a test for new parsing or storage logic.

## Project layout

```
src/lib/source/   VPK, KeyValues, VTF, VMT, MDL assembly (vendored MIT parsers in vendor/)
src/lib/          catalog, IndexedDB, importer, exporters, backup, TF2 linking
src/viewer/       three.js viewer, character rig, poses, test mannequin
src/editor/       editor panels
src/pages/        routes
scripts/          catalog generator, dev helpers
deploy/           nginx config
docs/             format, deployment and pipeline docs
```

By contributing you agree that your contributions are licensed under the MIT License.
