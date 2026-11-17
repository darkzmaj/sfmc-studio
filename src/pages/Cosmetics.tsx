import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import type { CatalogItem, Tf2Class } from '../lib/types';
import { TF2_CLASSES } from '../lib/types';
import { cosmeticModelPath, loadMeta, type CatalogMeta } from '../lib/catalog';
import { modelAvailable } from '../lib/source/paths';
import { useEditor, makeCosmetic } from '../state/editor';
import { useApp } from '../state/app';
import CosmeticBrowser from '../editor/CosmeticBrowser';
import { ItemIcon, Notice } from '../components/ui';

function Detail({ item }: { item: CatalogItem }) {
  const character = useEditor((s) => s.character);
  const edit = useEditor((s) => s.edit);
  const types = useApp((s) => s.types);
  const toast = useApp((s) => s.toast);
  useApp((s) => s.assetsVersion);
  const nav = useNavigate();
  const type = character ? types.find((t) => t.id === character.config.typeId) : undefined;
  const classes = item.classes[0] === 'all' ? [...TF2_CLASSES] : (item.classes as Tf2Class[]);
  const equipped = character?.config.cosmetics.some((c) => c.defindex === item.id);
  const add = () => {
    if (!character) return;
    if (!equipped) edit((s) => ({ ...s, config: { ...s.config, cosmetics: [...s.config.cosmetics, makeCosmetic({ defindex: item.id, name: item.name, style: item.styles?.[0]?.id })] } }));
    toast(equipped ? 'Already equipped' : `Added ${item.name} to ${character.profile.name}`, 'success');
    nav(`/editor/${character.id}`);
  };
  return (
    <div className="card card-pad stack" style={{ position: 'sticky', top: 16 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <ItemIcon path={item.icon} size="lg" alt={item.name} />
        <div className="stack" style={{ gap: 4 }}>
          <h2>{item.name}</h2>
          <span className="hint">#{item.id} · {item.slot}{item.year ? ` · ${item.year}` : ''}{item.holiday ? ` · ${item.holiday.replace(/_/g, ' ')}` : ''}</span>
          <div className="row wrap">{item.paintable && <span className="badge accent">Paintable</span>}{item.styles && <span className="badge">{item.styles.length} styles</span>}{item.regions.map((r) => <span key={r} className="badge">{r.replace(/_/g, ' ')}</span>)}</div>
        </div>
      </div>
      {character ? (
        <button className="btn primary" onClick={add} disabled={!!type?.cosmeticClass && !classes.includes(type.cosmeticClass)}><Plus />{equipped ? 'Open in editor' : `Equip on ${character.profile.name}`}</button>
      ) : <Notice>Open a character in the <Link to="/editor">editor</Link> to equip items from here.</Notice>}
      {type?.cosmeticClass && !classes.includes(type.cosmeticClass) && <p className="hint">Not made for the {type.cosmeticClass}.</p>}
      <div className="stack" style={{ gap: 6 }}>
        <div className="panel-title">Classes and 3D models</div>
        <table className="table">
          <tbody>
            {classes.map((c) => {
              const p = cosmeticModelPath(item, undefined, c);
              const ok = !!p && modelAvailable(p);
              return <tr key={c}><td style={{ width: 90 }}>{c}</td><td><code className="hint" style={{ wordBreak: 'break-all' }}>{p ?? 'no model in schema'}</code></td><td>{p && <span className={`badge ${ok ? 'ok' : ''}`}>{ok ? 'Available' : 'Not linked'}</span>}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {item.styles && (
        <div className="stack" style={{ gap: 6 }}><div className="panel-title">Styles</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-2)' }}>{item.styles.map((s) => <li key={s.id}>{s.name}{s.skinRed !== undefined ? ` (skin ${s.skinRed}/${s.skinBlu})` : ''}{s.model ? ' · own model' : ''}</li>)}</ul></div>
      )}
      {item.hideBodygroups && <p className="hint">Hides bodygroups: {item.hideBodygroups.join(', ')}</p>}
      <p className="hint">Internal name: {item.internal}</p>
    </div>
  );
}

export default function Cosmetics() {
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const character = useEditor((s) => s.character);
  const types = useApp((s) => s.types);
  const tf2 = useApp((s) => s.tf2);
  const type = character ? types.find((t) => t.id === character.config.typeId) : undefined;
  useEffect(() => { void loadMeta().then(setMeta); }, []);
  const equipped = new Set((character?.config.cosmetics ?? []).map((c) => c.defindex).filter((x): x is number => x !== undefined));
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Catalog</div><h1>Cosmetics</h1>
          <p>{meta ? `${meta.counts.cosmetics.toLocaleString()} cosmetics from the TF2 item schema, generated ${new Date(meta.generatedAt).toLocaleDateString()}.` : 'Loading catalog…'} Icons and 3D models come from your linked TF2 files; items without them stay usable as metadata.</p></div>
      </div>
      {tf2 !== 'linked' && <div style={{ marginBottom: 16 }}><Notice>Link your TF2 folder on the <Link to="/imports">Imports</Link> page to see item icons and 3D availability.</Notice></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 420px)', gap: 16, alignItems: 'start' }} className="cosmetics-layout">
        <div className="card" style={{ height: 'min(72vh, 900px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <CosmeticBrowser cls={type?.cosmeticClass} equipped={equipped} selectedId={selected?.id} onPick={setSelected} />
        </div>
        {selected ? <Detail item={selected} /> : <div className="card empty"><h3>Select an item</h3><p>Click any cosmetic to see its classes, styles, regions and model paths.</p></div>}
      </div>
      <style>{'@media (max-width: 960px) { .cosmetics-layout { grid-template-columns: 1fr !important; } }'}</style>
      {meta && <p className="hint" style={{ marginTop: 16 }}>{meta.notice} Names: {meta.englishNames}. Source: <a href={meta.source} rel="noopener">{meta.source}</a>.</p>}
    </div>
  );
}
