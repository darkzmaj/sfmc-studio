import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ExternalLink, RotateCcw, SquarePen, Trash2, TriangleAlert } from 'lucide-react';
import { create } from 'zustand';
import type { CatalogItem, CharacterConfig, Paint, PriceSnapshot, Team, Tf2Class } from '../lib/types';
import { TF2_CLASSES } from '../lib/types';
import { getItem, itemPrice, loadMeta, loadPaints, loadPrices, marketUrl, paintColor, typeAvailability, type CatalogMeta } from '../lib/catalog';
import { useApp } from '../state/app';
import { defaultConfig, makeCosmetic, newCharacter, useEditor } from '../state/editor';
import ViewerPane from '../editor/ViewerPane';
import CosmeticBrowser from '../editor/CosmeticBrowser';
import { ItemIcon, Notice } from '../components/ui';
import type { RigStatus } from '../viewer/rig';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const label = (c: string) => c[0].toUpperCase() + c.slice(1);

// Try Out state lives apart from the editor, so experimenting never touches saved characters.
const useTry = create<{ config: CharacterConfig; set: (c: CharacterConfig) => void }>((set) => ({
  config: { ...defaultConfig('tf2.scout'), pose: 'reference' },
  set: (config) => set({ config }),
}));

export default function TryOut() {
  const { config, set } = useTry();
  const types = useApp((s) => s.types);
  const ready = useApp((s) => s.ready);
  useApp((s) => s.assetsVersion);
  const loadEditor = useEditor((s) => s.load);
  const nav = useNavigate();
  const [status, setStatus] = useState<RigStatus>({ base: 'empty', cosmetics: {} });
  const [items, setItems] = useState<Record<number, CatalogItem>>({});
  const [prices, setPrices] = useState<Record<number, { cents: number; listings: number } | null>>({});
  const [snap, setSnap] = useState<PriceSnapshot | null>(null);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [priceMap, setPriceMap] = useState<Map<number, number> | null>(null);
  const type = types.find((t) => t.id === config.typeId);
  const cls = type?.cosmeticClass as Tf2Class | undefined;

  useEffect(() => { void loadPrices().then(setSnap); void loadPaints().then(setPaints); void loadMeta().then(setMeta); }, []);
  // Price badges for the list: precompute once per catalog.
  useEffect(() => {
    void (async () => {
      const { loadCosmetics } = await import('../lib/catalog');
      const all = await loadCosmetics();
      const m = new Map<number, number>();
      for (const it of all) { const p = await itemPrice(it); if (p) m.set(it.id, p.cents); }
      setPriceMap(m);
    })();
  }, [snap]);
  useEffect(() => {
    void (async () => {
      const it: Record<number, CatalogItem> = {}, pr: typeof prices = {};
      for (const c of config.cosmetics) if (c.defindex !== undefined) { const x = await getItem(c.defindex); if (x) { it[x.id] = x; pr[x.id] = await itemPrice(x); } }
      setItems(it); setPrices(pr);
    })();
  }, [config.cosmetics]);

  const pickClass = (c: Tf2Class) => set({ ...config, typeId: `tf2.${c}`, cosmetics: [], bodygroups: {}, skin: undefined });
  const toggle = (item: CatalogItem) => {
    const has = config.cosmetics.find((c) => c.defindex === item.id);
    set({ ...config, cosmetics: has ? config.cosmetics.filter((c) => c !== has) : [...config.cosmetics, makeCosmetic({ defindex: item.id, name: item.name, style: item.styles?.[0]?.id })] });
  };
  const update = (uid: string, patch: Partial<CharacterConfig['cosmetics'][number]>) => set({ ...config, cosmetics: config.cosmetics.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) });

  const lines = config.cosmetics.map((c) => {
    const item = c.defindex !== undefined ? items[c.defindex] : undefined;
    const price = c.defindex !== undefined ? prices[c.defindex] : null;
    const paint = c.paint != null ? paints.find((p) => p.id === c.paint) : undefined;
    const paintCents = paint ? snap?.paints[String(paint.id)]?.p ?? null : null;
    return { c, item, price, paint, paintCents };
  });
  const total = lines.reduce((a, l) => a + (l.price?.cents ?? 0) + (l.paintCents ?? 0), 0);
  const unpriced = lines.filter((l) => !l.price).length;

  // In-game rules: 3 cosmetic slots, and items sharing an equip region (or conflicting regions) cannot be worn together.
  const clashes = useMemo(() => {
    const out: string[] = [];
    const owners = new Map<string, string>();
    for (const l of lines) {
      if (!l.item) continue;
      for (const r of l.item.regions) {
        const conflict = [r, ...(meta?.regionConflicts[r] ?? [])].map((x) => owners.get(x)).find(Boolean);
        if (conflict && conflict !== l.item.name) out.push(`${l.item.name} and ${conflict} share the "${r.replace(/_/g, ' ')}" region`);
      }
      for (const r of l.item.regions) if (!owners.has(r)) owners.set(r, l.item.name);
    }
    return out;
  }, [lines, meta]);

  const openInEditor = () => {
    const c = newCharacter(config.typeId, config.team, `My ${type?.name ?? 'character'}`);
    c.config = structuredClone(config);
    loadEditor(c, { dirty: true });
    nav(`/editor/${c.id}`);
  };

  return (
    <div className="page stack" style={{ gap: 18, maxWidth: 1480 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Try out</div><h1>Preview a loadout before you buy</h1>
          <p>Pick a class, click cosmetics to try them on in 3D, and see what the look would cost on the Steam Community Market.</p></div>
        <div className="row">
          <div className="seg" role="group" aria-label="Team">
            {(['red', 'blu'] as Team[]).map((t) => <button key={t} className={`team-${t}`} aria-pressed={config.team === t} onClick={() => set({ ...config, team: t, skin: undefined })}>{t.toUpperCase()}</button>)}
          </div>
          <button className="btn" onClick={() => set({ ...config, cosmetics: [] })} disabled={!config.cosmetics.length}><RotateCcw />Clear</button>
          <button className="btn primary" onClick={openInEditor}><SquarePen />Open in editor</button>
        </div>
      </div>

      <div className="class-strip" role="radiogroup" aria-label="Class">
        {TF2_CLASSES.map((c) => {
          const t = types.find((x) => x.id === `tf2.${c}`);
          return (
            <button key={c} role="radio" aria-checked={config.typeId === `tf2.${c}`} className="type-tile" aria-pressed={config.typeId === `tf2.${c}`} onClick={() => pickClass(c)}>
              <span className="t-name">{label(c)}</span>
              {t && ready && typeAvailability(t) !== 'ready' && <span className="hint">Needs TF2 files</span>}
            </button>
          );
        })}
      </div>

      <div className="tryout">
        <div className="card tryout-list">
          <CosmeticBrowser cls={cls} lockClass equipped={new Set(config.cosmetics.map((c) => c.defindex!).filter(Boolean))} onPick={toggle} compact
            extra={(it) => { const p = priceMap?.get(it.id); return p !== undefined ? <span className="price-tag">{usd(p)}</span> : null; }} />
        </div>
        <div className="card tryout-view">
          <ViewerPane config={config} onStatus={setStatus} />
        </div>
        <aside className="card card-pad stack tryout-cart" aria-label="Loadout and price">
          <div className="row"><h2>Your loadout</h2><span className="spacer" /><span className="hint">{config.cosmetics.length} item{config.cosmetics.length === 1 ? '' : 's'}</span></div>
          {!config.cosmetics.length && <p className="hint">Click cosmetics on the left to try them on.</p>}
          {lines.map(({ c, item, price, paint, paintCents }) => (
            <div key={c.uid} className="cart-line">
              <ItemIcon path={item?.icon} />
              <div style={{ minWidth: 0 }}>
                <div className="name" style={{ fontWeight: 580, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div className="hint row" style={{ gap: 6 }}>
                  {price ? <a href={marketUrl(item?.name ?? c.name)} target="_blank" rel="noopener noreferrer">{usd(price.cents)} <ExternalLink size={10} /></a> : <span>Not on market</span>}
                  {status.cosmetics[c.uid]?.state === 'metadata-only' && <span>· no 3D model</span>}
                </div>
                {item?.paintable && (
                  <select className="select" style={{ marginTop: 6, minHeight: 28, padding: '2px 26px 2px 8px', fontSize: 12 }} aria-label={`Paint for ${c.name}`} value={c.paint ?? ''} onChange={(e) => update(c.uid, { paint: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Unpainted</option>
                    {paints.map((p) => <option key={p.id} value={p.id}>{p.name}{snap?.paints[String(p.id)] ? ` (${usd(snap.paints[String(p.id)].p)})` : ''}</option>)}
                  </select>
                )}
                {paint && <div className="hint row" style={{ gap: 6, marginTop: 4 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: `rgb(${paintColor(paint, config.team).join(',')})` }} />{paint.name} {paintCents != null ? `+ ${usd(paintCents)}` : ''}</div>}
              </div>
              <button className="btn ghost icon sm danger" aria-label={`Remove ${c.name}`} onClick={() => set({ ...config, cosmetics: config.cosmetics.filter((x) => x.uid !== c.uid) })}><Trash2 /></button>
            </div>
          ))}
          {config.cosmetics.length > 0 && (
            <div className="cart-total">
              <span>Estimated total</span>
              <strong>{usd(total)}</strong>
            </div>
          )}
          {unpriced > 0 && <p className="hint">{unpriced} item{unpriced === 1 ? ' is' : 's are'} not in the market snapshot (untradable, promo, or no current listings) and {unpriced === 1 ? 'is' : 'are'} not counted.</p>}
          {config.cosmetics.length > 3 && <Notice tone="warn">TF2 lets you wear 3 cosmetics at once. This preview shows {config.cosmetics.length}; in game you would need to pick 3.</Notice>}
          {clashes.map((m) => <div key={m} className="issue warning"><TriangleAlert />{m}. They cannot be equipped together in game.</div>)}
          <p className="hint" style={{ marginTop: 'auto' }}>
            {snap ? <>Lowest Steam Community Market listing for Unique quality, snapshot {new Date(snap.generatedAt).toLocaleDateString()} ({snap.currency}). Prices change constantly and other qualities (Strange, Unusual, Genuine, Vintage) cost more. Check the market before buying.</> : 'Price data is not available on this deployment.'}
            {' '}<Link to="/about">Not affiliated with Valve.</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}
