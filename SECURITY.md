# Security policy

## Reporting a vulnerability

Please report security issues privately with GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/darkzmaj/sfmc-studio/security/advisories/new), or through the contact details at [darkzmaj.eu](https://darkzmaj.eu). Do not open a public issue for an unfixed vulnerability. You can expect an acknowledgement within a week.

## Scope and threat model

SFMC Studio is a static single-page app. The server only serves files. It stores no visitor data and has no accounts, uploads or API.

In scope:

- Parsing of untrusted files in the browser: VPK, MDL/VVD/VTX, VTF, VMT, GLB, ZIP backups, character JSON.
- Isolation between visitors (data lives in per-origin IndexedDB; nothing is sent to the server).
- The nginx configuration and Docker image (headers, CSP, non-root, read-only).

Out of scope: people with access to the same unlocked browser profile (browser storage is per profile, not per person), and vulnerabilities in the browser itself.

## Hardening in place

- **Strict CSP**: `script-src 'self'`, no third-party origins, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'none'`, `connect-src 'self' blob: data:`.
- **No remote code or analytics**: fonts and all libraries are bundled.
- **Imports**: extension allow-list, magic-number checks (IDST, IDSV, VTF, glTF), VMT text and size checks, per-file (256 MB) and per-import (2 GB) caps, and path normalisation that rejects `..` and maps files only into `models/`, `materials/` or `glb/`.
- **ZIPs**: declared uncompressed sizes and file counts are checked before inflating (zip-bomb protection). Restore accepts only an exact allow-list of entry names. Backups carry SHA-256 checksums that are verified before restore.
- **Parsers**: bounds and size checks on VPK trees, VTF dimensions and mip data, and KeyValues nesting depth. MDL versions are limited to 44-49.
- **Rendering**: imported data is only ever treated as bytes, text or textures. Nothing imported is evaluated or inserted as HTML.
- **Container**: `nginx-unprivileged` (uid 101), runs with `read_only`, `cap_drop: ALL` and `no-new-privileges`. Dotfiles and source maps are denied, and request bodies are capped at 1 KB.
