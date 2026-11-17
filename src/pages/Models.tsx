import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, Plus, Trash2, Upload, ExternalLink } from 'lucide-react';
import type { CharacterType, Tf2Class } from '../lib/types';
import { TF2_CLASSES } from '../lib/types';
import { deleteCustomType, putCustomType, uid } from '../lib/db';
import { download } from '../lib/exporters';
import { useApp } from '../state/app';
import { newCharacter, useEditor } from '../state/editor';
import { availabilityBadge, useVisibleTypes } from '../editor/LeftPanel';
import { Modal, useConfirm } from '../components/ui';
import { normalizePath } from '../lib/source/vpk';

const blank = (): CharacterType => ({
  id: `custom.${uid().slice(0, 8)}`, name: '', category: 'custom', tags: [], source: { kind: 'local-import', label: 'Imported model' },
  modelPath: '', teams: ['red', 'blu'], teamSkins: { red: 0, blu: 1 }, skeleton: 'unknown', attribution: '', notes: '', builtin: false,
});

export function validateType(raw: unknown): CharacterType {
  const t = raw as CharacterType;
  if (!t || typeof t.id !== 'string' || !t.id.startsWith('custom.') || typeof t.name !== 'string' || !t.name.trim()) throw new Error('Custom types need an id starting with "custom." and a name.');
  if (t.modelPath) normalizePath(t.modelPath);
  return { ...blank(), ...t, builtin: false, glbBlobId: undefined };
}

export default function Models() {
  const { refreshTypes, toast, settings } = useApp();
  const types = useVisibleTypes();
  useApp((s) => s.assetsVersion);
  const [editing, setEditing] = useState<CharacterType | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const nav = useNavigate();
  const load = useEditor((s) => s.load);

  const save = async () => {
    if (!editing) return;
    try {
      const t = validateType({ ...editing, tags: editing.tags.filter(Boolean), modelPath: editing.modelPath ? normalizePath(editing.modelPath) : undefined });
      await putCustomType(t);
      await refreshTypes();
      setEditing(null);
      toast('Model type saved', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const importTypes = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 2 * 1024 * 1024) throw new Error('File larger than 2 MB.');
      const raw = JSON.parse(await f.text());
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const r of arr) await putCustomType(validateType(r));
      await refreshTypes();
      toast(`Imported ${arr.length} model type${arr.length === 1 ? '' : 's'}`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const custom = types.filter((t) => !t.builtin);

  return (
    <div className="page">
      {confirmEl}
      <div className="page-head">
        <div><div className="eyebrow">Base models</div><h1>Models</h1><p>Every character starts from one of these. Add your own types for Workshop or custom models without touching any code; they are stored in this browser and included in backups.</p></div>
        <div className="row">
          <label className="btn"><Upload />Import types<input type="file" accept=".json" hidden onChange={(e) => { void importTypes(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn" disabled={!custom.length} onClick={() => download(new Blob([JSON.stringify(custom, null, 2)], { type: 'application/json' }), 'sfmc-model-types.json')}><Download />Export types</button>
          <button className="btn primary" onClick={() => setEditing(blank())}><Plus />Add model type</button>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Category</th><th>Source</th><th>Model path</th><th>Cosmetics</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td><strong style={{ fontWeight: 600 }}>{t.name}</strong>{t.mature && <span className="badge warn" style={{ marginLeft: 6 }}>18+</span>}<div className="hint">{t.tags.slice(0, 4).join(', ')}</div></td>
                <td>{t.category.replace('-', ' ')}</td>
                <td>{t.source.url ? <a href={t.source.url} rel="noopener" target="_blank">{t.source.label} <ExternalLink size={11} /></a> : t.source.label}</td>
                <td><code className="hint">{t.modelPath ?? '(link on Imports page)'}</code></td>
                <td>{t.cosmeticClass ?? '-'}</td>
                <td>{availabilityBadge(t)}</td>
                <td><div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => { const c = newCharacter(t.id, settings.defaultTeam, `New ${t.name}`); load(c, { dirty: true }); nav(`/editor/${c.id}`); }}>Create</button>
                  {!t.builtin && <button className="btn sm" onClick={() => setEditing(structuredClone(t))}>Edit</button>}
                  {!t.builtin && <button className="btn sm icon danger" aria-label={`Delete ${t.name}`} onClick={async () => { if (await confirm({ title: `Delete "${t.name}"?`, body: 'Characters using this type keep their data but will show as missing a model.', action: 'Delete', danger: true })) { await deleteCustomType(t.id); await refreshTypes(); } }}><Trash2 /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>Each entry records name, category, tags, source, model path, teams, skins, availability, attribution and compatibility notes. Built-in TF2 entries load from your own game files; community entries require an import you are allowed to use.</p>
      <Modal open={!!editing} title={editing?.name ? `Edit ${editing.name}` : 'New model type'} onClose={() => setEditing(null)} footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save</button></>}>
        {editing && (
          <div className="stack">
            <label className="field"><span>Display name</span><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
            <div className="grid-2">
              <label className="field"><span>Category</span><select className="select" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as CharacterType['category'] })}>
                <option value="custom">Custom</option><option value="workshop">Workshop</option><option value="female-variant">Female variant</option><option value="boss">Boss</option></select></label>
              <label className="field"><span>Uses cosmetics of</span><select className="select" value={editing.cosmeticClass ?? ''} onChange={(e) => setEditing({ ...editing, cosmeticClass: (e.target.value || undefined) as Tf2Class | undefined })}>
                <option value="">None (custom skeleton)</option>{TF2_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            </div>
            <label className="field"><span>Model path (game-relative)</span><input className="input mono" placeholder="models/player/custom/femscout.mdl" value={editing.modelPath ?? ''} onChange={(e) => setEditing({ ...editing, modelPath: e.target.value })} /></label>
            <div className="grid-2">
              <label className="field"><span>Skeleton</span><select className="select" value={editing.skeleton} onChange={(e) => setEditing({ ...editing, skeleton: e.target.value as CharacterType['skeleton'] })}><option value="tf2-biped">TF2 biped (bip_* bones)</option><option value="custom">Custom</option><option value="unknown">Unknown</option></select></label>
              <label className="field"><span>Workshop URL (optional)</span><input className="input" value={editing.source.url ?? ''} onChange={(e) => setEditing({ ...editing, source: { ...editing.source, kind: e.target.value ? 'workshop' : 'local-import', label: e.target.value ? 'SFM Workshop' : 'Imported model', url: e.target.value || undefined } })} /></label>
            </div>
            <div className="grid-2">
              <label className="field"><span>RED skin</span><input className="input" type="number" min={0} value={editing.teamSkins?.red ?? 0} onChange={(e) => setEditing({ ...editing, teamSkins: { red: Number(e.target.value), blu: editing.teamSkins?.blu ?? 1 } })} /></label>
              <label className="field"><span>BLU skin</span><input className="input" type="number" min={0} value={editing.teamSkins?.blu ?? 1} onChange={(e) => setEditing({ ...editing, teamSkins: { red: editing.teamSkins?.red ?? 0, blu: Number(e.target.value) } })} /></label>
            </div>
            <label className="field"><span>Tags (comma separated)</span><input className="input" value={editing.tags.join(', ')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((s) => s.trim()) })} /></label>
            <label className="check"><input type="checkbox" checked={!!editing.mature} onChange={(e) => setEditing({ ...editing, mature: e.target.checked })} />18+ model (hidden until a visitor confirms their age)</label>
            <label className="field"><span>Attribution</span><input className="input" placeholder="Model by …" value={editing.attribution} onChange={(e) => setEditing({ ...editing, attribution: e.target.value })} /></label>
            <label className="field"><span>Compatibility notes</span><textarea className="textarea" rows={3} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
          </div>
        )}
      </Modal>
    </div>
  );
}
