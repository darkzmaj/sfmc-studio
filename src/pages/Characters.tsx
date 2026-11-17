import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Copy, LayoutGrid, List, Pencil, Plus, Search, Star, Trash2, Upload, Download, BookmarkPlus } from 'lucide-react';
import { strFromU8, unzipSync } from 'fflate';
import { deleteCharacter, listCharacters, patchCharacter, saveCharacter, uid, now, getBlob, putBlob } from '../lib/db';
import type { Character } from '../lib/types';
import { download, safeName } from '../lib/exporters';
import { useApp } from '../state/app';
import { useEditor, newCharacter } from '../state/editor';
import { Thumb } from './Dashboard';
import { relTime, useConfirm, Modal } from '../components/ui';

type Sort = 'updated' | 'name' | 'created';

export function validateCharacter(raw: unknown): Character {
  const c = raw as Character;
  if (!c || c.format !== 'sfmc.character' || typeof c.id !== 'string' || !c.profile || !c.config || !Array.isArray(c.config.cosmetics)) throw new Error('Not an SFMC Studio character file.');
  if (c.formatVersion > 1) throw new Error('This character was made by a newer version of SFMC Studio.');
  return c;
}

export default function Characters() {
  const [list, setList] = useState<Character[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'templates'>('all');
  const [renaming, setRenaming] = useState<Character | null>(null);
  const [newName, setNewName] = useState('');
  const types = useApp((s) => s.types);
  const toast = useApp((s) => s.toast);
  const team = useApp((s) => s.settings.defaultTeam);
  const loadEditor = useEditor((s) => s.load);
  const nav = useNavigate();
  const [confirm, confirmEl] = useConfirm();
  const refresh = () => listCharacters().then(setList);
  useEffect(() => { void refresh(); }, []);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    let out = (list ?? []).filter((c) => (filter === 'favorites' ? c.favorite : filter === 'templates' ? c.isTemplate : true));
    if (n) out = out.filter((c) => `${c.profile.name} ${c.profile.nickname} ${c.profile.tags.join(' ')} ${types.find((t) => t.id === c.config.typeId)?.name ?? ''}`.toLowerCase().includes(n));
    return [...out].sort((a, b) => sort === 'name' ? a.profile.name.localeCompare(b.profile.name) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [list, q, sort, filter, types]);

  const duplicate = async (c: Character, asTemplate = false) => {
    let thumbnailId: string | undefined;
    if (c.thumbnailId) { const t = await getBlob(c.thumbnailId); if (t) thumbnailId = (await putBlob(t.blob, 'thumbnail', t.name)).id; }
    const copy: Character = { ...structuredClone(c), id: uid(), version: 0, createdAt: now(), updatedAt: now(), favorite: false, isTemplate: asTemplate, thumbnailId, profile: { ...c.profile, name: asTemplate ? `${c.profile.name} (template)` : `${c.profile.name} copy` } };
    await saveCharacter(copy, asTemplate ? 'Template created' : 'Duplicated');
    toast(asTemplate ? 'Template created' : 'Duplicated', 'success');
    void refresh();
  };
  const fromTemplate = (c: Character) => {
    const n = newCharacter(c.config.typeId, c.config.team ?? team, c.profile.name.replace(/ \(template\)$/, ''));
    n.config = structuredClone(c.config);
    n.profile = { ...structuredClone(c.profile), name: n.profile.name, referenceImageIds: [] };
    loadEditor(n, { dirty: true });
    nav(`/editor/${n.id}`);
  };
  const remove = async (c: Character) => {
    if (await confirm({ title: `Delete "${c.profile.name}"?`, body: 'This removes the character, its version history and its images from this browser. It cannot be undone unless you have a backup.', action: 'Delete', danger: true })) {
      await deleteCharacter(c.id);
      if (useEditor.getState().character?.id === c.id) useEditor.getState().close();
      toast('Deleted');
      void refresh();
    }
  };
  const exportOne = (c: Character) => download(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' }), `${safeName(c.profile.name)}.sfmc-character.json`);
  const importFiles = async (files: FileList | null) => {
    for (const f of [...(files ?? [])]) {
      try {
        if (f.size > 50 * 1024 * 1024) throw new Error('File larger than 50 MB.');
        let raw: unknown;
        if (f.name.endsWith('.zip')) {
          const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => e.name === 'sfmc-character.json' && e.originalSize < 10 * 1024 * 1024 });
          if (!entries['sfmc-character.json']) throw new Error('ZIP has no sfmc-character.json.');
          raw = JSON.parse(strFromU8(entries['sfmc-character.json']));
        } else raw = JSON.parse(await f.text());
        const c = validateCharacter(raw);
        const exists = (list ?? []).some((x) => x.id === c.id);
        const imported: Character = { ...c, id: exists ? uid() : c.id, thumbnailId: undefined, profile: { ...c.profile, referenceImageIds: [], name: exists ? `${c.profile.name} (imported)` : c.profile.name }, version: 0 };
        await saveCharacter(imported, 'Imported');
        toast(`Imported ${imported.profile.name}`, 'success');
      } catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'error'); }
    }
    void refresh();
  };

  const Actions = ({ c }: { c: Character }) => (
    <>
      <Link className="btn ghost icon sm" to={`/editor/${c.id}`} aria-label="Edit" title="Edit"><Pencil /></Link>
      <button className="btn ghost icon sm" aria-label="Rename" title="Rename" onClick={() => { setRenaming(c); setNewName(c.profile.name); }}><span style={{ fontSize: 11, fontWeight: 700 }}>Aa</span></button>
      <button className="btn ghost icon sm" aria-label="Duplicate" title="Duplicate" onClick={() => void duplicate(c)}><Copy /></button>
      {c.isTemplate ? <button className="btn ghost icon sm" aria-label="New from template" title="New from template" onClick={() => fromTemplate(c)}><Plus /></button>
        : <button className="btn ghost icon sm" aria-label="Save as template" title="Save as template" onClick={() => void duplicate(c, true)}><BookmarkPlus /></button>}
      <button className="btn ghost icon sm" aria-label="Export character file" title="Export character file" onClick={() => exportOne(c)}><Download /></button>
      <button className="btn ghost icon sm danger" aria-label="Delete" title="Delete" onClick={() => void remove(c)}><Trash2 /></button>
    </>
  );
  const fav = async (c: Character) => { await patchCharacter(c.id, { favorite: !c.favorite }); void refresh(); };

  return (
    <div className="page">
      {confirmEl}
      <Modal open={!!renaming} title="Rename character" onClose={() => setRenaming(null)} footer={<>
        <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
        <button className="btn primary" onClick={async () => { if (renaming && newName.trim()) { await patchCharacter(renaming.id, { profile: { ...renaming.profile, name: newName.trim() }, updatedAt: now() }); setRenaming(null); void refresh(); } }}>Rename</button>
      </>}>
        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label="New name" />
      </Modal>
      <div className="page-head">
        <div><div className="eyebrow">Library</div><h1>Characters</h1><p>Everything here is stored in this browser only. Use Backups to keep a copy.</p></div>
        <div className="row">
          <label className="btn"><Upload />Import<input type="file" accept=".json,.zip" multiple hidden onChange={(e) => { void importFiles(e.target.files); e.target.value = ''; }} /></label>
          <Link className="btn primary" to="/editor"><Plus />New character</Link>
        </div>
      </div>
      <div className="toolbar">
        <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Search by name, tag or model" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search characters" /></label>
        <div className="seg" role="group" aria-label="Filter">
          {(['all', 'favorites', 'templates'] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        </div>
        <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="updated">Last modified</option><option value="created">Newest</option><option value="name">Name</option>
        </select>
        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={view === 'grid'} aria-label="Grid" onClick={() => setView('grid')}><LayoutGrid size={14} /></button>
          <button aria-pressed={view === 'list'} aria-label="List" onClick={() => setView('list')}><List size={14} /></button>
        </div>
      </div>
      {list && !shown.length && <div className="card empty"><h3>{list.length ? 'No matches' : 'Your library is empty'}</h3><p>{list.length ? 'Try a different search or filter.' : 'Create a character in the editor and save it.'}</p></div>}
      {view === 'grid' ? (
        <div className="char-grid">
          {shown.map((c) => (
            <article key={c.id} className="card char-card">
              <Link to={`/editor/${c.id}`} className="char-thumb" aria-label={`Edit ${c.profile.name}`}><Thumb id={c.thumbnailId} /></Link>
              <div className="char-info">
                <div className="row"><span className="name" style={{ flex: 1 }}>{c.profile.name}</span>
                  <button className="btn ghost icon sm" aria-label={c.favorite ? 'Unfavourite' : 'Favourite'} aria-pressed={c.favorite} onClick={() => void fav(c)}><Star fill={c.favorite ? 'var(--accent)' : 'none'} color={c.favorite ? 'var(--accent)' : 'currentColor'} /></button></div>
                <span className="meta">{types.find((t) => t.id === c.config.typeId)?.name ?? c.config.typeId} · {c.config.team.toUpperCase()} · {c.config.cosmetics.length} items</span>
                <span className="meta">Modified {relTime(c.updatedAt)} · v{c.version}{c.isTemplate ? ' · template' : ''}</span>
              </div>
              <div className="char-actions"><Actions c={c} /></div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th></th><th>Name</th><th>Model</th><th>Team</th><th>Items</th><th>Modified</th><th></th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td><button className="btn ghost icon sm" aria-label={c.favorite ? 'Unfavourite' : 'Favourite'} onClick={() => void fav(c)}><Star size={14} fill={c.favorite ? 'var(--accent)' : 'none'} color={c.favorite ? 'var(--accent)' : 'currentColor'} /></button></td>
                  <td><Link to={`/editor/${c.id}`}>{c.profile.name}</Link>{c.isTemplate && <span className="badge" style={{ marginLeft: 6 }}>template</span>}</td>
                  <td>{types.find((t) => t.id === c.config.typeId)?.name ?? c.config.typeId}</td>
                  <td><span className={`badge ${c.config.team}`}>{c.config.team.toUpperCase()}</span></td>
                  <td>{c.config.cosmetics.length}</td>
                  <td className="hint">{relTime(c.updatedAt)}</td>
                  <td><div className="row" style={{ gap: 0, justifyContent: 'flex-end' }}><Actions c={c} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
