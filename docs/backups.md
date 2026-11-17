# Backups and restore

Everything a visitor creates lives in their browser. The **Backups** page turns the whole library into one ZIP and restores it again.

## What a backup contains

```
backup-manifest.json     format "sfmc.backup" v1, app version, counts, SHA-256 of every other file
characters/<id>.json     one file per character ("sfmc.character" v1)
versions/<id>.json       saved version history per character
blobs.json               metadata for stored images/files
blobs/<id>.<ext>         thumbnails and reference images (and imported model files if chosen)
custom-types.json        user-defined model types
imports.json             import pack metadata (and file mappings if imported files are included)
settings.json            settings and model links
```

Linked TF2 game files are never included. Imported model files are only included if the user ticks the option, because they may be third-party files that the user should keep private.

## Restore

1. Choose a backup ZIP. Only the expected entry names are read; everything else is ignored.
2. Every file listed in `backup-manifest.json` is checked against its SHA-256. Problems are shown before anything is written.
3. Characters that already exist (same ID) are reported as conflicts. Choose one of:
   - **Keep both**: restored copies get new IDs and a "(restored)" suffix.
   - **Overwrite**: replaces the existing character and its version history.
   - **Skip**: leaves existing characters alone.
4. Settings are only restored when you tick that option.

Backups made by a newer app version (higher `formatVersion`) are refused with a message to update.

## Reminders

The dashboard shows a reminder when the library has characters and no backup was made within the chosen interval (default 7 days; configurable or off on the Backups page). There are no pop-ups.

## Individual characters

The Characters page exports one character as `*.sfmc-character.json` and imports `.json` files or SFMC character bundles (`.sfmc.zip`). Imported characters get a new ID if the ID already exists.

## Operator backups (self-hosting)

The server holds no user data, so there is nothing to back up on the server beyond the repository itself. Keep the domain stable: browser storage is tied to the site's origin.
