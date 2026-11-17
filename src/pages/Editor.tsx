import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Undo2, Redo2, Save, Image as ImageIcon, FileJson, FileText, Package, ChevronDown } from 'lucide-react';
import { getCharacter, putBlob, requestPersistence } from '../lib/db';
import { buildBundle, buildManifest, download, manifestToMarkdown, safeName } from '../lib/exporters';
import { useEditor, newCharacter, restoreDraft } from '../state/editor';
import { useApp } from '../state/app';
import { activeViewer } from '../viewer/active';
import type { RigStatus } from '../viewer/rig';
import type { ViewPreset } from '../viewer/Viewer';
import ViewerPane from '../editor/ViewerPane';
import LeftPanel, { TypePicker } from '../editor/LeftPanel';
import RightPanel from '../editor/RightPanel';
import { relTime, useConfirm } from '../components/ui';

export async function captureThumbnail(existingId?: string) {
  const v = activeViewer();
  if (!v) return existingId;
  try {
    const blob = await v.capture({ width: 512, height: 512, fit: true });
    return (await putBlob(blob, 'thumbnail', 'thumbnail.png', existingId)).id;
  } catch { return existingId; }
}

function StartScreen() {
  const nav = useNavigate();
  const load = useEditor((s) => s.load);
  const team = useApp((s) => s.settings.defaultTeam);
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">Character editor</div><h1>Choose a base model</h1><p>Start from a TF2 class, a community model you have imported, or the built-in test mannequin. You can switch the base model later.</p></div>
        <Link className="btn" to="/characters">Open a saved character</Link></div>
      <TypePicker onPick={(t) => { const c = newCharacter(t.id, team, `New ${t.name}`); load(c, { dirty: true }); nav(`/editor/${c.id}`, { replace: true }); }} />
    </div>
  );
}

export default function Editor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { character, dirty, past, future, savedAt, load, undo, redo, save, setProfile } = useEditor();
  const types = useApp((s) => s.types);
  const ready = useApp((s) => s.ready);
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<RigStatus>({ base: 'empty', cosmetics: {} });
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  // Resolve which character to edit: URL id > open draft > start screen.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const current = useEditor.getState().character;
      if (id && current?.id === id) return;
      if (!current && (await restoreDraft())) {
        const d = useEditor.getState().character;
        if (!id || d?.id === id) { if (alive && d && !id) nav(`/editor/${d.id}`, { replace: true }); return; }
      }
      if (!id) { const c = useEditor.getState().character; if (c && alive) nav(`/editor/${c.id}`, { replace: true }); return; }
      const cur = useEditor.getState();
      if (cur.character && cur.dirty && cur.character.id !== id) {
        const ok = await confirm({ title: 'Discard unsaved changes?', body: `"${cur.character.profile.name}" has unsaved changes. Opening another character discards them.`, action: 'Discard and open', danger: true });
        if (!ok) { nav(`/editor/${cur.character.id}`, { replace: true }); return; }
      }
      setLoading(true);
      const c = await getCharacter(id);
      if (!alive) return;
      setLoading(false);
      if (c) load(c); else { toast('Character not found in this browser.', 'error'); nav('/editor', { replace: true }); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const doSave = async () => {
    const c = useEditor.getState().character;
    if (!c) return;
    const thumb = await captureThumbnail(c.thumbnailId);
    const stored = await save(undefined, thumb);
    if (stored) {
      toast(`Saved version ${stored.version}`, 'success');
      if (stored.version === 1) void requestPersistence();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const inText = (e.target as HTMLElement).closest('input, textarea');
      if (k === 's') { e.preventDefault(); void doSave(); }
      else if (k === 'z' && !inText) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y' && !inText) { e.preventDefault(); redo(); }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (useEditor.getState().dirty) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
  });

  if (!ready || loading) return <div className="viewer-state" style={{ position: 'relative', minHeight: 300 }}><div className="spinner" /></div>;
  if (!character || (id && character.id !== id)) return <>{confirmEl}<StartScreen /></>;

  const type = types.find((t) => t.id === character.config.typeId);
  const base = safeName(character.profile.name);
  const exportPng = async () => {
    const v = activeViewer();
    if (!v) return;
    download(await v.capture({ width: 2048, height: 2048 }), `${base}.png`);
  };
  const exportJson = async () => download(new Blob([JSON.stringify(await buildManifest(character, type), null, 2)], { type: 'application/json' }), `${base}.manifest.json`);
  const exportMd = async () => download(new Blob([manifestToMarkdown(await buildManifest(character, type))], { type: 'text/markdown' }), `${base}.md`);
  const exportZip = async () => {
    const v = activeViewer();
    const render = v ? await v.capture({ width: 1024, height: 1024 }) : null;
    const { zip, excluded } = await buildBundle(character, type, { render, includeRedistributable: true });
    download(zip, `${base}.sfmc.zip`);
    toast(`Bundle exported. ${excluded.length} third-party asset file${excluded.length === 1 ? '' : 's'} referenced, not included.`, 'success');
  };
  const view = (p: ViewPreset) => activeViewer()?.view(p);

  return (
    <div className="editor">
      {confirmEl}
      <div className="editor-top">
        <input className="editor-title" aria-label="Character name" value={character.profile.name} onChange={(e) => setProfile({ name: e.target.value }, 'name')} />
        <span className={`badge ${character.config.team}`}>{character.config.team.toUpperCase()}</span>
        <span className="hint">{type?.name ?? character.config.typeId}</span>
        <span className="spacer" />
        <span className="hint" aria-live="polite">{dirty ? 'Unsaved changes (draft kept in this browser)' : savedAt ? `Saved ${relTime(savedAt)}` : ''}</span>
        <button className="btn ghost" onClick={() => { useEditor.getState().close(); nav('/editor'); }}>New</button>
      </div>
      <LeftPanel />
      <ViewerPane onStatus={setStatus} />
      <RightPanel status={status} />
      <div className="editor-bottom">
        <button className="btn icon" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 /></button>
        <button className="btn icon" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}><Redo2 /></button>
        <div className="seg" role="group" aria-label="Camera presets">
          {(['front', 'back', 'left', 'right', 'top'] as const).map((p) => <button key={p} onClick={() => view(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
        </div>
        <button className="btn" onClick={() => activeViewer()?.reset()}>Reset view</button>
        <span className="spacer" />
        <div style={{ position: 'relative' }}>
          <button className="btn" aria-expanded={exportOpen} aria-haspopup="menu" onClick={() => setExportOpen((o) => !o)}>Export<ChevronDown /></button>
          {exportOpen && (
            <div className="card" role="menu" style={{ position: 'absolute', bottom: 40, right: 0, padding: 6, display: 'grid', gap: 2, minWidth: 230, zIndex: 20 }} onClick={() => setExportOpen(false)}>
              <button className="btn ghost" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => void exportPng()}><ImageIcon />PNG render (2048 px)</button>
              <button className="btn ghost" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => void exportJson()}><FileJson />Manifest (JSON)</button>
              <button className="btn ghost" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => void exportMd()}><FileText />Specification (Markdown)</button>
              <button className="btn ghost" role="menuitem" style={{ justifyContent: 'flex-start' }} onClick={() => void exportZip()}><Package />Character bundle (ZIP)</button>
              <Link className="btn ghost" role="menuitem" style={{ justifyContent: 'flex-start' }} to="/exports">More options…</Link>
            </div>
          )}
        </div>
        <button className="btn primary" onClick={() => void doSave()} title="Save (Ctrl+S)"><Save />Save</button>
      </div>
    </div>
  );
}
