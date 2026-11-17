import { useEffect, useState } from 'react';
import { FolderOpen, Link2, Trash2, Upload, RefreshCw, FileArchive, Unlink } from 'lucide-react';
import { linkDirectory, linkFileList, mountImports, restoreTf2, supportsDirectoryPicker, unlinkTf2 } from '../lib/tf2files';
import { fromFileList, fromZip, importFiles, LIMITS, type ImportReport } from '../lib/importer';
import { deletePack, listFiles, listPacks, putBlob, putCustomType, uid } from '../lib/db';
import { getTypeLinks, setTypeLink } from '../lib/catalog';
import { assets } from '../lib/source/assets';
import type { ImportPack, ImportedFile } from '../lib/types';
import { useApp } from '../state/app';
import { Notice, fmtBytes, useConfirm } from '../components/ui';

export default function Imports() {
  const { tf2, setTf2, toast, types, refreshTypes } = useApp();
  useApp((s) => s.assetsVersion);
  const [busy, setBusy] = useState(false);
  const [packs, setPacks] = useState<ImportPack[]>([]);
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [packName, setPackName] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [redistributable, setRedistributable] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const refresh = async () => { setPacks(await listPacks()); setFiles(await listFiles()); setLinks(await getTypeLinks()); };
  useEffect(() => { void refresh(); }, []);

  const link = async (fn: () => Promise<{ linked: string[]; entries: number }>) => {
    setBusy(true);
    try {
      const r = await fn();
      setTf2('linked');
      toast(`Linked ${r.linked.length} VPK sets (${r.entries.toLocaleString()} files)`, 'success');
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const pickDir = () => link(async () => linkDirectory(await window.showDirectoryPicker({ id: 'tf2', mode: 'read' })));

  const runImport = async (candidates: Promise<ReturnType<typeof fromFileList>>) => {
    setBusy(true); setReport(null);
    try {
      const list = await candidates;
      const r = await importFiles(list, packName.trim() || `Import ${new Date().toLocaleString()}`, { redistributable, sourceNote: sourceNote.trim() }, (done, total, label) => setProgress({ done, total, label }));
      setReport(r);
      await mountImports();
      await refresh();
      toast(`Imported ${r.accepted.length} files${r.rejected.length ? `, rejected ${r.rejected.length}` : ''}`, r.accepted.length ? 'success' : 'error');
      setPackName(''); setSourceNote(''); setRedistributable(false);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); setProgress(null); }
  };

  const importGlb = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.glb$/i.test(f.name) || f.size > LIMITS.fileBytes) { toast('Choose a .glb file under 256 MB.', 'error'); return; }
    const head = new DataView(await f.slice(0, 4).arrayBuffer());
    if (head.getUint32(0, true) !== 0x46546c67) { toast('Not a binary glTF file.', 'error'); return; }
    const blob = await putBlob(f, 'glb', f.name);
    await putCustomType({ id: `custom.${uid().slice(0, 8)}`, name: f.name.replace(/\.glb$/i, ''), category: 'custom', tags: ['glb', 'imported'], source: { kind: 'glb', label: 'Imported GLB' }, glbBlobId: blob.id, teams: ['red', 'blu'], skeleton: 'custom', attribution: '', notes: 'Converted glTF model. Skins and bodygroups are not available; cosmetics only follow it if bone names match the TF2 skeleton.', builtin: false });
    await refreshTypes();
    toast('GLB added as a custom model type', 'success');
  };

  const linkable = types.filter((t) => t.source.kind !== 'tf2-vpk' && t.source.kind !== 'builtin-demo' && !t.glbBlobId);
  const models = files.filter((f) => f.path.endsWith('.mdl'));

  return (
    <div className="page stack" style={{ gap: 26 }}>
      {confirmEl}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Assets</div><h1>Imports</h1><p>Game and Workshop models are never hosted by this site. Link your own TF2 installation, or import model files you are allowed to use. Everything stays in this browser.</p></div>
      </div>

      <section className="card card-pad stack">
        <div className="row"><h2>Team Fortress 2 files</h2><span className="spacer" />
          <span className={`badge ${tf2 === 'linked' ? 'ok' : tf2 === 'needs-permission' ? 'warn' : ''}`}>{tf2 === 'linked' ? 'Linked' : tf2 === 'needs-permission' ? 'Permission needed' : 'Not linked'}</span></div>
        <p className="hint">Select your <code>Team Fortress 2</code> folder (or its <code>tf</code> subfolder), usually <code>Steam/steamapps/common/Team Fortress 2</code>. The browser reads <code>tf2_misc</code> and <code>tf2_textures</code> VPKs in place, on demand. No game data is copied or uploaded.</p>
        <div className="row wrap">
          {supportsDirectoryPicker() && <button className="btn primary" disabled={busy} onClick={() => void pickDir()}><FolderOpen />Choose TF2 folder</button>}
          {tf2 === 'needs-permission' && <button className="btn" disabled={busy} onClick={() => void link(async () => { const s = await restoreTf2(true); if (s !== 'linked') throw new Error('Permission was not granted.'); return { linked: assets.list().filter((p) => p.id.startsWith('vpk:')).map((p) => p.label), entries: 0 }; })}><RefreshCw />Reconnect</button>}
          <label className="btn"><Upload />{supportsDirectoryPicker() ? 'Or select .vpk files' : 'Select .vpk files'}
            <input type="file" accept=".vpk" multiple hidden onChange={(e) => { const fl = e.target.files; if (fl?.length) void link(() => linkFileList(fl)); e.target.value = ''; }} /></label>
          {tf2 === 'linked' && <button className="btn ghost" onClick={async () => { await unlinkTf2(); setTf2('none'); }}><Unlink />Unlink</button>}
        </div>
        {!supportsDirectoryPicker() && <Notice>This browser cannot remember folders, so select <code>tf2_misc_dir.vpk</code>, all <code>tf2_misc_0NN.vpk</code> files and the matching <code>tf2_textures</code> files each visit (multi-select in the file dialog). Chrome and Edge can remember the folder.</Notice>}
        {tf2 === 'linked' && <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>{assets.list().filter((p) => p.id.startsWith('vpk:')).map((p) => <li key={p.id}>{p.label}</li>)}</ul>}
      </section>

      <section className="card card-pad stack">
        <h2>Import model files</h2>
        <p className="hint">For Saxton Hale, female variants, Workshop downloads and custom characters. Choose a folder that contains <code>models/</code> and <code>materials/</code>, or a ZIP of it. Accepted: .mdl .vvd .vtx .phy .ani .vtf .vmt .glb. Files are checked by header, paths are normalised, and limits are {fmtBytes(LIMITS.fileBytes)} per file and {fmtBytes(LIMITS.totalBytes)} per import.</p>
        <div className="grid-2">
          <label className="field"><span>Name for this import</span><input className="input" placeholder="FemScout by …" value={packName} onChange={(e) => setPackName(e.target.value)} /></label>
          <label className="field"><span>Source or Workshop link (for your records)</span><input className="input" placeholder="https://steamcommunity.com/sharedfiles/…" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={redistributable} onChange={(e) => setRedistributable(e.target.checked)} />I made these files or have permission to redistribute them (allows including them in exported bundles)</label>
        <div className="row wrap">
          <label className="btn primary"><FolderOpen />Choose folder
            <input type="file" multiple hidden disabled={busy} {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { const fl = e.target.files; if (fl?.length) void runImport(Promise.resolve(fromFileList(fl))); e.target.value = ''; }} /></label>
          <label className="btn"><FileArchive />Choose ZIP
            <input type="file" accept=".zip" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void runImport(fromZip(f)); e.target.value = ''; }} /></label>
          <label className="btn"><Upload />Choose files
            <input type="file" multiple hidden disabled={busy} accept=".mdl,.vvd,.vtx,.phy,.ani,.vtf,.vmt" onChange={(e) => { const fl = e.target.files; if (fl?.length) void runImport(Promise.resolve(fromFileList(fl))); e.target.value = ''; }} /></label>
          <label className="btn"><Upload />Add GLB model
            <input type="file" accept=".glb" hidden onChange={(e) => { void importGlb(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        {progress && <div className="stack" style={{ gap: 6 }} aria-live="polite"><div className="progress"><div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div><span className="hint">{progress.done} / {progress.total} · {progress.label}</span></div>}
        {report && (
          <div className="stack" style={{ gap: 6 }}>
            <p><strong>{report.accepted.length}</strong> files imported{report.models.length ? `, including ${report.models.length} model${report.models.length === 1 ? '' : 's'}` : ''}. Link a model to a catalog entry below.</p>
            {report.rejected.length > 0 && <details><summary className="hint">{report.rejected.length} files rejected</summary><ul className="hint">{report.rejected.slice(0, 200).map((r, i) => <li key={i}><code>{r.name}</code>: {r.reason}</li>)}</ul></details>}
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Link imported models to catalog entries</h2>
        {!models.length && <p className="hint">No imported .mdl files yet.</p>}
        {models.length > 0 && (
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Model</th><th>Import</th><th>Used by</th><th>Link to</th></tr></thead>
              <tbody>
                {models.map((m) => {
                  const linkedTo = Object.entries(links).filter(([, p]) => p === m.path).map(([k]) => types.find((t) => t.id === k)?.name ?? k);
                  return (
                    <tr key={m.path}>
                      <td><code>{m.path}</code></td>
                      <td className="hint">{packs.find((p) => p.id === m.packId)?.name}</td>
                      <td>{linkedTo.join(', ') || <span className="hint">nothing</span>}</td>
                      <td><select className="select" style={{ minWidth: 200 }} value="" onChange={async (e) => { if (!e.target.value) return; await setTypeLink(e.target.value, m.path); await refreshTypes(); await refresh(); toast('Linked', 'success'); }} aria-label={`Link ${m.path}`}>
                        <option value="">Choose an entry…</option>
                        {linkable.map((t) => <option key={t.id} value={t.id}>{t.name}{links[t.id] ? ' (replace link)' : ''}</option>)}
                      </select></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {Object.keys(links).length > 0 && (
          <div className="row wrap">{Object.entries(links).map(([k, p]) => <span key={k} className="badge"><Link2 size={11} />{types.find((t) => t.id === k)?.name ?? k} → {p.split('/').pop()}<button className="btn ghost icon sm" style={{ width: 16, height: 16 }} aria-label="Unlink" onClick={async () => { await setTypeLink(k, null); await refreshTypes(); await refresh(); }}>×</button></span>)}</div>
        )}
      </section>

      <section className="stack">
        <h2>Imported packs</h2>
        {!packs.length && <p className="hint">Nothing imported yet.</p>}
        {packs.map((p) => (
          <div key={p.id} className="card card-pad row wrap">
            <div style={{ flex: 1, minWidth: 200 }}><strong style={{ fontWeight: 600 }}>{p.name}</strong><div className="hint">{p.fileCount} files · {fmtBytes(p.totalBytes)} · {new Date(p.createdAt).toLocaleDateString()}{p.sourceNote ? ` · ${p.sourceNote}` : ''}</div></div>
            {p.redistributable ? <span className="badge ok">Redistributable</span> : <span className="badge">Private use</span>}
            <button className="btn danger" onClick={async () => { if (await confirm({ title: `Delete "${p.name}"?`, body: `Removes ${p.fileCount} imported files from this browser. Characters keep their settings but these models will show as missing.`, action: 'Delete files', danger: true })) { await deletePack(p.id); await mountImports(); await refresh(); } }}><Trash2 />Delete</button>
          </div>
        ))}
      </section>
    </div>
  );
}
