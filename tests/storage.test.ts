// Library persistence, manifest/Markdown generation and full backup -> restore round trip.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listCharacters, listVersions, putBlob, saveCharacter, getCharacter, wipeAll } from '../src/lib/db';
import { newCharacter, makeCosmetic } from '../src/state/editor';
import { buildManifest, manifestToMarkdown, technicalSummary } from '../src/lib/exporters';
import { applyRestore, createBackup, readBackup } from '../src/lib/backup';
import { checkCompatibility } from '../src/lib/catalog';
import type { CharacterType } from '../src/lib/types';

beforeAll(() => {
  // Serve the shipped catalog JSON to the app's fetch() calls.
  globalThis.fetch = (async (url: string) => {
    const name = String(url).split('/').pop()!;
    return new Response(readFileSync(join(__dirname, '..', 'public', 'catalog', name)), { status: 200 });
  }) as typeof fetch;
});

const scout: CharacterType = {
  id: 'tf2.scout', name: 'Scout', category: 'tf2-class', tags: [], cosmeticClass: 'scout', source: { kind: 'tf2-vpk', label: 'TF2' },
  modelPath: 'models/player/scout.mdl', teams: ['red', 'blu'], teamSkins: { red: 0, blu: 1 }, skeleton: 'tf2-biped', attribution: '', notes: '', builtin: true,
};

describe('library and exports', () => {
  it('saves characters with version history', async () => {
    const c = newCharacter('tf2.scout', 'blu', 'Test Scout');
    c.config.cosmetics.push(makeCosmetic({ defindex: 30066, name: 'Brotherhood of Arms', paint: 5051 }));
    const v1 = await saveCharacter(c);
    const v2 = await saveCharacter({ ...v1, profile: { ...v1.profile, personality: 'Energetic, sarcastic' } });
    expect(v2.version).toBe(2);
    expect((await listVersions(c.id)).map((v) => v.version)).toEqual([2, 1]);
    expect((await getCharacter(c.id))?.profile.personality).toBe('Energetic, sarcastic');
  });

  it('builds a manifest and Markdown without inventing asset paths', async () => {
    const [c] = await listCharacters();
    const m = await buildManifest(c, scout);
    expect(m.format).toBe('sfmc.character.manifest');
    expect(m.cosmetics[0]).toMatchObject({ defindex: 30066, name: 'Brotherhood of Arms', paint: { name: 'Pink as Hell', rgb: [255, 105, 180] } });
    expect(m.cosmetics[0].modelPath).toBe('models/workshop/player/items/all_class/brotherhood_2/brotherhood_2_scout.mdl');
    // No game files are linked in tests, so nothing may be reported as verified.
    expect(m.assets.every((a) => !a.availableLocally && a.origin === 'missing')).toBe(true);
    const md = manifestToMarkdown(m);
    expect(md).toContain('# Test Scout');
    expect(md).toContain('not verified');
    expect(technicalSummary(m)).toContain('Personality: Energetic, sarcastic');
  });

  it('reports duplicates, class mismatches and region clashes', async () => {
    const c = newCharacter('tf2.scout');
    c.config.cosmetics = [
      makeCosmetic({ defindex: 30066, name: 'Brotherhood of Arms' }),
      makeCosmetic({ defindex: 30066, name: 'Brotherhood of Arms' }),
      makeCosmetic({ defindex: 378, name: 'Team Captain' }),
    ];
    const issues = await checkCompatibility(c.config, scout);
    expect(issues.some((i) => i.level === 'error' && i.message.includes('twice'))).toBe(true);
    expect(issues.some((i) => i.message.includes('not made for the scout'))).toBe(true);
    expect(issues.some((i) => i.message.includes('equip region'))).toBe(true);
  });
});

describe('backup and restore', () => {
  it('round-trips characters, versions and images with integrity checks and conflict handling', async () => {
    const [c] = await listCharacters();
    const img = await putBlob(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'thumbnail', 'thumb.png');
    await saveCharacter({ ...c, thumbnailId: img.id });
    const zip = await createBackup({ includeImportedFiles: false });
    const file = new File([await zip.arrayBuffer()], 'backup.zip');

    // Same browser: conflict detected; keep-both creates a copy.
    let plan = await readBackup(file);
    expect(plan.integrity.ok).toBe(true);
    expect(plan.characters[0].existing).toBeTruthy();
    expect(await applyRestore(plan, 'keep-both', { restoreSettings: false })).toMatchObject({ added: 1 });
    expect((await listCharacters()).length).toBe(2);

    // Fresh browser: everything comes back, including history and the thumbnail.
    await wipeAll();
    plan = await readBackup(file);
    expect(plan.characters[0].existing).toBeUndefined();
    await applyRestore(plan, 'skip', { restoreSettings: true });
    const restored = await getCharacter(c.id);
    expect(restored?.thumbnailId).toBeTruthy();
    expect((await listVersions(c.id)).length).toBeGreaterThanOrEqual(3);
  });

  it('rejects tampered and foreign archives', async () => {
    const { zipSync, strToU8, unzipSync } = await import('fflate');
    await expect(readBackup(new File([zipSync({ 'x.txt': strToU8('hi') })], 'x.zip'))).rejects.toThrow(/not an SFMC/i);
    const good = unzipSync(new Uint8Array(await (await createBackup({ includeImportedFiles: false })).arrayBuffer()));
    const name = Object.keys(good).find((k) => k.startsWith('characters/'))!;
    good[name] = strToU8('{"format":"sfmc.character","tampered":true}');
    const plan = await readBackup(new File([zipSync(good)], 't.zip'));
    expect(plan.integrity.ok).toBe(false);
  });
});
