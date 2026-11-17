import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Trash2, Eye, EyeOff, CircleAlert, TriangleAlert, Info, Copy, ImagePlus, X, History } from 'lucide-react';
import type { CatalogItem, EquippedCosmetic, Paint } from '../lib/types';
import { checkCompatibility, getItem, loadPaints, paintColor, type Issue } from '../lib/catalog';
import { buildManifest, technicalSummary } from '../lib/exporters';
import { deleteBlob, getBlob, listVersions, putBlob } from '../lib/db';
import type { CharacterVersion } from '../lib/types';
import { POSES } from '../viewer/poses';
import type { RigStatus } from '../viewer/rig';
import { activeViewer } from '../viewer/active';
import type { LightingPreset } from '../viewer/Viewer';
import { ItemIcon, fmtDate } from '../components/ui';
import { useEditor } from '../state/editor';
import { useApp } from '../state/app';

type Tab = 'equipped' | 'appearance' | 'profile' | 'technical';

const IssueIcon = ({ level }: { level: Issue['level'] }) => (level === 'error' ? <CircleAlert /> : level === 'warning' ? <TriangleAlert /> : <Info />);

function Vec({ value, onChange, step, label }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void; step: number; label: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="vec">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <input key={axis} className="input" type="number" step={step} value={value[i]} aria-label={`${label} ${axis}`}
            onChange={(e) => { const v = [...value] as [number, number, number]; v[i] = Number(e.target.value) || 0; onChange(v); }} />
        ))}
      </div>
    </div>
  );
}

function EquipRow({ c, index, count, item, paints, issues, status, team }: { c: EquippedCosmetic; index: number; count: number; item?: CatalogItem; paints: Paint[]; issues: Issue[]; status?: RigStatus['cosmetics'][string]; team: 'red' | 'blu' }) {
  const [open, setOpen] = useState(false);
  const update = useEditor((s) => s.updateCosmetic);
  const edit = useEditor((s) => s.edit);
  const move = (d: number) => edit((s) => {
    const list = [...s.config.cosmetics];
    const j = index + d;
    if (j < 0 || j >= list.length) return s;
    [list[index], list[j]] = [list[j], list[index]];
    return { ...s, config: { ...s.config, cosmetics: list } };
  });
  const remove = () => edit((s) => ({ ...s, config: { ...s.config, cosmetics: s.config.cosmetics.filter((x) => x.uid !== c.uid) } }));
  const stateBadge = !status ? null
    : status.state === 'ready' ? <span className="badge ok">3D</span>
    : status.state === 'loading' ? <span className="badge">Loading</span>
    : status.state === 'metadata-only' ? <span className="badge">Metadata only</span>
    : status.state === 'missing' ? <span className="badge warn">Model missing</span>
    : <span className="badge err">Error</span>;
  const paint = c.paint != null ? paints.find((p) => p.id === c.paint) : undefined;
  return (
    <div className="equip">
      <div className="equip-head">
        <ItemIcon path={item?.icon} />
        <button className="btn ghost" style={{ justifyContent: 'flex-start', padding: '0 4px', height: 'auto', minWidth: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span style={{ minWidth: 0, textAlign: 'left' }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 580, opacity: c.visible ? 1 : 0.5 }}>{c.name}</span>
            <span className="row" style={{ gap: 4, marginTop: 2 }}>{stateBadge}{paint && <span className="badge"><span style={{ width: 8, height: 8, borderRadius: 2, background: `rgb(${paintColor(paint, team).join(',')})` }} />{paint.name}</span>}</span>
          </span>
        </button>
        <div className="row" style={{ gap: 0 }}>
          <button className="btn ghost icon sm" aria-label={c.visible ? 'Hide' : 'Show'} title={c.visible ? 'Hide' : 'Show'} onClick={() => update(c.uid, { visible: !c.visible })}>{c.visible ? <Eye /> : <EyeOff />}</button>
          <button className="btn ghost icon sm" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => move(-1)}><ArrowUp /></button>
          <button className="btn ghost icon sm" aria-label="Move down" title="Move down" disabled={index === count - 1} onClick={() => move(1)}><ArrowDown /></button>
          <button className="btn ghost icon sm danger" aria-label="Remove" title="Remove" onClick={remove}><Trash2 /></button>
        </div>
      </div>
      {issues.length > 0 && <div style={{ padding: '0 10px 8px', display: 'grid', gap: 4 }}>{issues.map((i, k) => <div key={k} className={`issue ${i.level}`}><IssueIcon level={i.level} />{i.message}</div>)}</div>}
      {status?.message && status.state !== 'metadata-only' && <div style={{ padding: '0 10px 8px' }} className="issue warning"><TriangleAlert />{status.message}</div>}
      {open && (
        <div className="equip-body">
          {item?.styles && item.styles.length > 0 && (
            <label className="field"><span>Style</span>
              <select className="select" value={c.style ?? ''} onChange={(e) => update(c.uid, { style: e.target.value === '' ? undefined : Number(e.target.value) })}>
                {item.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          {item?.paintable !== false && (
            <div className="field"><span>Paint{item && !item.paintable ? ' (not paintable)' : ''}</span>
              <div className="row">
                <select className="select" value={c.customColor ? 'custom' : c.paint ?? ''} onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') update(c.uid, { paint: null, customColor: [255, 255, 255] });
                  else update(c.uid, { paint: v === '' ? null : Number(v), customColor: null });
                }}>
                  <option value="">Unpainted</option>
                  {paints.map((p) => <option key={p.id} value={p.id}>{p.name}{p.blu ? ' (team)' : ''}</option>)}
                  <option value="custom">Custom colour (SFM only)</option>
                </select>
                {c.customColor && <input type="color" aria-label="Custom colour" value={`#${c.customColor.map((n) => n.toString(16).padStart(2, '0')).join('')}`} onChange={(e) => { const h = e.target.value; update(c.uid, { customColor: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number] }, `color-${c.uid}`); }} />}
              </div>
            </div>
          )}
          <Vec label="Offset (units)" step={0.25} value={c.offset} onChange={(v) => update(c.uid, { offset: v }, `off-${c.uid}`)} />
          <Vec label="Rotation (degrees)" step={1} value={c.rotation} onChange={(v) => update(c.uid, { rotation: v }, `rot-${c.uid}`)} />
          <label className="field"><span>Scale {c.scale.toFixed(2)}</span>
            <input type="range" min={0.5} max={1.5} step={0.01} value={c.scale} onChange={(e) => update(c.uid, { scale: Number(e.target.value) }, `scale-${c.uid}`)} />
          </label>
          <div className="row">
            <button className="btn sm" onClick={() => update(c.uid, { offset: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}>Reset transform</button>
            {status?.path && <code className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status.path}>{status.path}</code>}
          </div>
        </div>
      )}
    </div>
  );
}

function Equipped({ status }: { status: RigStatus }) {
  const character = useEditor((s) => s.character)!;
  const types = useApp((s) => s.types);
  const [items, setItems] = useState<Record<number, CatalogItem>>({});
  const [paints, setPaints] = useState<Paint[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const type = types.find((t) => t.id === character.config.typeId);
  useEffect(() => { void loadPaints().then(setPaints); }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<number, CatalogItem> = {};
      for (const c of character.config.cosmetics) if (c.defindex !== undefined) { const it = await getItem(c.defindex); if (it) out[c.defindex] = it; }
      const iss = await checkCompatibility(character.config, type);
      if (alive) { setItems(out); setIssues(iss); }
    })();
    return () => { alive = false; };
  }, [character.config, type, status]);
  const list = character.config.cosmetics;
  if (!list.length) return <div className="empty"><h3>Nothing equipped</h3><p>Pick cosmetics from the list on the left. There is no three-item limit here.</p></div>;
  const general = issues.filter((i) => !i.uid);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row"><span className="panel-title">{list.length} equipped</span><span className="spacer" />
        <span className="hint">{Object.values(status.cosmetics).filter((s) => s.state === 'ready').length} rendered in 3D</span></div>
      {general.map((i, k) => <div key={k} className={`issue ${i.level}`}><IssueIcon level={i.level} />{i.message}</div>)}
      {list.map((c, i) => <EquipRow key={c.uid} c={c} index={i} count={list.length} item={c.defindex !== undefined ? items[c.defindex] : undefined} paints={paints} issues={issues.filter((x) => x.uid === c.uid)} status={status.cosmetics[c.uid]} team={character.config.team} />)}
    </div>
  );
}

function Appearance({ status }: { status: RigStatus }) {
  const character = useEditor((s) => s.character)!;
  const setConfig = useEditor((s) => s.setConfig);
  const [view, setView] = useState({ lighting: 'studio' as LightingPreset, background: '#1b1a19', fov: 35 });
  const info = status.baseInfo;
  const cfg = character.config;
  const applyView = (p: Partial<typeof view>) => { const next = { ...view, ...p }; setView(next); activeViewer()?.setOptions(next); };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="stack">
        <div className="panel-title">Pose</div>
        <select className="select" value={cfg.pose} onChange={(e) => setConfig({ pose: e.target.value })} disabled={!!info && !info.poseSupported} aria-label="Pose">
          {POSES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="hint">{info && !info.poseSupported ? 'This skeleton has no TF2-style arm bones, so only the reference pose is available.' : POSES.find((p) => p.id === cfg.pose)?.description}</p>
      </section>
      <section className="stack">
        <div className="panel-title">Skin</div>
        <select className="select" aria-label="Skin family" value={cfg.skin ?? ''} onChange={(e) => setConfig({ skin: e.target.value === '' ? undefined : Number(e.target.value) })} disabled={!info}>
          <option value="">Team default ({cfg.team.toUpperCase()})</option>
          {Array.from({ length: info?.skinCount ?? 0 }, (_, i) => <option key={i} value={i}>Skin {i}{i === 0 ? ' (RED)' : i === 1 ? ' (BLU)' : ''}</option>)}
        </select>
        {info && info.skinCount > 2 && <p className="hint">TF2 class models also include über, zombie and other variant skins (2 and up).</p>}
      </section>
      <section className="stack">
        <div className="panel-title">Bodygroups</div>
        {!info?.bodygroups.length && <p className="hint">This model has no switchable bodygroups.</p>}
        {info?.bodygroups.filter((b) => b.options.length > 1).map((b) => (
          <label key={b.name} className="field"><span>{b.name}</span>
            <select className="select" value={cfg.bodygroups[b.name] ?? ''} onChange={(e) => {
              const next = { ...cfg.bodygroups };
              if (e.target.value === '') delete next[b.name]; else next[b.name] = Number(e.target.value);
              setConfig({ bodygroups: next });
            }}>
              <option value="">Automatic (cosmetics decide)</option>
              {b.options.map((o, i) => <option key={i} value={i}>{o === '(none)' ? 'Hidden' : i === 0 ? 'Default' : `Variant ${i}`}</option>)}
            </select>
          </label>
        ))}
      </section>
      <section className="stack">
        <div className="panel-title">Eyes</div>
        <p className="hint">TF2 eyes use Source's projected eye shader, which the web preview approximates. An iris tint can be recorded for SFM in the manifest.</p>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!cfg.eyes.irisColor} onChange={(e) => setConfig({ eyes: { irisColor: e.target.checked ? '#6b8fb3' : null } })} />Record iris colour</label>
          {cfg.eyes.irisColor && <input type="color" aria-label="Iris colour" value={cfg.eyes.irisColor} onChange={(e) => setConfig({ eyes: { irisColor: e.target.value } }, 'iris')} />}
        </div>
      </section>
      <section className="stack">
        <div className="panel-title">Viewer</div>
        <label className="field"><span>Lighting</span>
          <div className="seg" role="group" aria-label="Lighting">
            {(['studio', 'soft', 'dramatic', 'flat'] as const).map((l) => <button key={l} aria-pressed={view.lighting === l} onClick={() => applyView({ lighting: l })}>{l[0].toUpperCase() + l.slice(1)}</button>)}
          </div>
        </label>
        <div className="row"><span className="label" style={{ flex: 1 }}>Background</span><input type="color" aria-label="Background colour" value={view.background} onChange={(e) => applyView({ background: e.target.value })} /></div>
        <label className="field"><span>Field of view {view.fov}°</span><input type="range" min={15} max={75} value={view.fov} onChange={(e) => applyView({ fov: Number(e.target.value) })} /></label>
      </section>
      {info && (
        <section className="stack">
          <div className="panel-title">Model</div>
          <code className="hint">{info.path}</code>
          <p className="hint">{info.boneCount} bones · {info.skinCount} skins · checksum {info.checksum}</p>
          {info.warnings.map((w, i) => <div key={i} className="issue warning"><TriangleAlert />{w}</div>)}
        </section>
      )}
    </div>
  );
}

const PROFILE_FIELDS: { key: 'description' | 'personality' | 'voice' | 'outfit' | 'animationNotes' | 'special' | 'story'; label: string; rows: number; placeholder: string }[] = [
  { key: 'description', label: 'Description', rows: 5, placeholder: 'Who is this character?' },
  { key: 'personality', label: 'Personality and behaviour', rows: 3, placeholder: 'Energetic, sarcastic, hates losing' },
  { key: 'voice', label: 'Voice and speaking style', rows: 3, placeholder: 'Fast-paced, Boston accent' },
  { key: 'outfit', label: 'Outfit description', rows: 3, placeholder: 'What they wear and why' },
  { key: 'animationNotes', label: 'Animation notes', rows: 3, placeholder: 'Exaggerated gestures, quick head turns' },
  { key: 'special', label: 'Special characteristics', rows: 2, placeholder: 'Scars, props, quirks' },
  { key: 'story', label: 'Story and scene notes', rows: 4, placeholder: 'Where this character appears' },
];

function Profile() {
  const p = useEditor((s) => s.character!.profile);
  const setProfile = useEditor((s) => s.setProfile);
  const toast = useApp((s) => s.toast);
  const [tagText, setTagText] = useState('');
  const [refs, setRefs] = useState<{ id: string; url: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void Promise.all(p.referenceImageIds.map(async (id) => { const b = await getBlob(id); if (!b) return null; const url = URL.createObjectURL(b.blob); urls.push(url); return { id, url, name: b.name }; }))
      .then((r) => { if (alive) setRefs(r.filter((x): x is NonNullable<typeof x> => !!x)); });
    return () => { alive = false; urls.forEach(URL.revokeObjectURL); };
  }, [p.referenceImageIds]);
  const addTag = () => {
    const t = tagText.trim().toLowerCase();
    if (t && !p.tags.includes(t)) setProfile({ tags: [...p.tags, t] });
    setTagText('');
  };
  const addRefs = async (files: FileList | null) => {
    const ids: string[] = [];
    for (const f of [...(files ?? [])]) {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast(`${f.name}: only PNG, JPEG or WebP images`, 'error'); continue; }
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: larger than 15 MB`, 'error'); continue; }
      ids.push((await putBlob(f, 'reference', f.name.slice(0, 120))).id);
    }
    if (ids.length) setProfile({ referenceImageIds: [...p.referenceImageIds, ...ids] });
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid-2">
        <label className="field"><span>Character name</span><input className="input" value={p.name} onChange={(e) => setProfile({ name: e.target.value }, 'name')} /></label>
        <label className="field"><span>Display nickname</span><input className="input" value={p.nickname} onChange={(e) => setProfile({ nickname: e.target.value }, 'nickname')} /></label>
      </div>
      {PROFILE_FIELDS.map((f) => (
        <label key={f.key} className="field"><span>{f.label}</span>
          <textarea className="textarea" rows={f.rows} placeholder={f.placeholder} value={p[f.key]} onChange={(e) => setProfile({ [f.key]: e.target.value }, f.key)} />
        </label>
      ))}
      <div className="field"><span>Tags</span>
        <div className="row wrap">{p.tags.map((t) => <span key={t} className="badge">{t}<button className="btn ghost icon sm" style={{ width: 16, height: 16 }} aria-label={`Remove tag ${t}`} onClick={() => setProfile({ tags: p.tags.filter((x) => x !== t) })}><X size={11} /></button></span>)}</div>
        <div className="row"><input className="input" placeholder="Add tag and press Enter" value={tagText} onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} /><button className="btn" onClick={addTag}>Add</button></div>
      </div>
      <div className="field"><span>Reference images</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {refs.map((r) => (
            <div key={r.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
              <img src={r.url} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button className="btn icon sm" style={{ position: 'absolute', top: 4, right: 4 }} aria-label={`Remove ${r.name}`} onClick={() => { setProfile({ referenceImageIds: p.referenceImageIds.filter((x) => x !== r.id) }); void deleteBlob(r.id); }}><X /></button>
            </div>
          ))}
          <label className="btn" style={{ aspectRatio: '1', height: 'auto', flexDirection: 'column' }}><ImagePlus /><span style={{ fontSize: 11 }}>Add</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void addRefs(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <span className="hint">Stored only in this browser. Included in bundles and backups.</span>
      </div>
    </div>
  );
}

function Technical() {
  const character = useEditor((s) => s.character)!;
  const load = useEditor((s) => s.edit);
  const types = useApp((s) => s.types);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState('');
  const [versions, setVersions] = useState<CharacterVersion[]>([]);
  const type = types.find((t) => t.id === character.config.typeId);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { void buildManifest(character, type).then((m) => { if (alive) setText(technicalSummary(m)); }); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [character, type]);
  useEffect(() => { if (character.version) void listVersions(character.id).then(setVersions); }, [character.id, character.version]);
  const restore = (v: CharacterVersion) => { load(() => structuredClone(v.snapshot)); toast(`Loaded version ${v.version}. Save to keep it.`); };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="stack">
        <div className="row"><div className="panel-title">Automatic technical description</div><span className="spacer" />
          <button className="btn sm" onClick={() => { void navigator.clipboard.writeText(text).then(() => toast('Copied', 'success')); }}><Copy />Copy</button></div>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, margin: 0, color: 'var(--text-2)', lineHeight: 1.55 }}>{text || 'Generating…'}</pre>
        <p className="hint">Generated from the saved configuration. Asset paths are only listed as verified when they exist in your linked or imported files.</p>
      </section>
      <section className="stack">
        <div className="panel-title"><History size={12} style={{ verticalAlign: -1 }} /> Version history</div>
        {!versions.length && <p className="hint">Versions appear here each time you save.</p>}
        {versions.map((v) => (
          <div key={v.version} className="row" style={{ fontSize: 13 }}>
            <span className="badge">v{v.version}</span><span className="hint" style={{ flex: 1 }}>{fmtDate(v.savedAt)}</span>
            <button className="btn sm" onClick={() => restore(v)} disabled={v.version === character.version}>Load</button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function RightPanel({ status }: { status: RigStatus }) {
  const [tab, setTab] = useState<Tab>('equipped');
  const count = useEditor((s) => s.character?.config.cosmetics.length ?? 0);
  const tabs = useMemo(() => [['equipped', `Equipped${count ? ` ${count}` : ''}`], ['appearance', 'Appearance'], ['profile', 'Profile'], ['technical', 'Technical']] as const, [count]);
  return (
    <aside className="editor-right" aria-label="Character settings">
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="pane" role="tabpanel">
        {tab === 'equipped' && <Equipped status={status} />}
        {tab === 'appearance' && <Appearance status={status} />}
        {tab === 'profile' && <Profile />}
        {tab === 'technical' && <Technical />}
      </div>
    </aside>
  );
}
