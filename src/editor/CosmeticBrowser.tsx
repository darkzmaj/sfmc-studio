import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Check, Paintbrush, Box } from 'lucide-react';
import type { CatalogItem, Tf2Class } from '../lib/types';
import { TF2_CLASSES } from '../lib/types';
import { cosmeticModelPath, itemFitsClass, loadCosmetics } from '../lib/catalog';
import { modelAvailable } from '../lib/source/paths';
import { ItemIcon } from '../components/ui';
import { useApp } from '../state/app';

export type SortKey = 'name' | 'newest' | 'oldest' | 'id';

export function useCosmetics() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadCosmetics().then(setItems, (e) => setError(String(e.message ?? e))); }, []);
  return { items, error };
}

const regionLabel = (r: string) => r.replace(/_/g, ' ');

export default function CosmeticBrowser({ cls, onPick, equipped, selectedId, compact, autoFocus, extra, lockClass }: {
  cls?: Tf2Class; onPick: (item: CatalogItem) => void; equipped?: Set<number>; selectedId?: number; compact?: boolean; autoFocus?: boolean;
  /** Extra content at the end of each row (e.g. a price). */ extra?: (item: CatalogItem) => ReactNode; lockClass?: boolean;
}) {
  const { items, error } = useCosmetics();
  const assetsVersion = useApp((s) => s.assetsVersion);
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState<string>(cls ?? 'any');
  const [region, setRegion] = useState('any');
  const [only3d, setOnly3d] = useState(false);
  const [paintable, setPaintable] = useState(false);
  const [sort, setSort] = useState<SortKey>('name');
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => { setClassFilter(cls ?? 'any'); }, [cls]);

  const regions = useMemo(() => [...new Set((items ?? []).flatMap((i) => i.regions))].sort(), [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const tokens = needle.split(/\s+/).filter(Boolean);
    const asNumber = /^#?\d+$/.test(needle) ? Number(needle.replace('#', '')) : null;
    const c = classFilter === 'any' ? undefined : (classFilter as Tf2Class);
    let out = items.filter((i) => {
      if (asNumber !== null) return i.id === asNumber;
      if (tokens.length) { const hay = `${i.name} ${i.internal}`.toLowerCase(); if (!tokens.every((t) => hay.includes(t))) return false; }
      if (c && !itemFitsClass(i, c)) return false;
      if (region !== 'any' && !i.regions.includes(region)) return false;
      if (paintable && !i.paintable) return false;
      if (only3d) { const p = cosmeticModelPath(i, undefined, c ?? cls); if (!p || !modelAvailable(p)) return false; }
      return true;
    });
    if (sort === 'newest') out = [...out].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.id - a.id);
    else if (sort === 'oldest') out = [...out].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id - b.id);
    else if (sort === 'id') out = [...out].sort((a, b) => a.id - b.id);
    return out;
    // assetsVersion: availability changes when files are linked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, classFilter, region, only3d, paintable, sort, cls, assetsVersion]);

  const rv = useVirtualizer({ count: filtered.length, getScrollElement: () => parent.current, estimateSize: () => 54, overscan: 10 });

  return (
    <div className="pane-flush">
      <div style={{ padding: '12px 12px 8px', display: 'grid', gap: 8 }}>
        <label className="search" style={{ maxWidth: 'none' }}>
          <Search aria-hidden="true" />
          <input className="input" type="search" placeholder="Search cosmetics or #defindex" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cosmetics" autoFocus={autoFocus} data-hotkey="search" />
        </label>
        <div className={compact ? 'grid-2' : 'row wrap'}>
          <select className="select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Class" hidden={lockClass}>
            <option value="any">All classes</option>
            {TF2_CLASSES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}{c === cls ? ' (current)' : ''}</option>)}
          </select>
          <select className="select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Equip region">
            <option value="any">Any region</option>
            {regions.map((r) => <option key={r} value={r}>{regionLabel(r)}</option>)}
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="name">Name A-Z</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="id">Defindex</option>
          </select>
          <div className="row" style={{ gap: 12 }}>
            <label className="check"><input type="checkbox" checked={only3d} onChange={(e) => setOnly3d(e.target.checked)} />3D available</label>
            <label className="check"><input type="checkbox" checked={paintable} onChange={(e) => setPaintable(e.target.checked)} />Paintable</label>
          </div>
        </div>
        <div className="hint" aria-live="polite">{items ? `${filtered.length.toLocaleString()} of ${items.length.toLocaleString()} items` : error ? `Catalog failed to load: ${error}` : 'Loading catalog…'}</div>
      </div>
      <div ref={parent} style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px', minHeight: 200 }} role="listbox" aria-label="Cosmetics">
        <div style={{ height: rv.getTotalSize(), position: 'relative' }}>
          {rv.getVirtualItems().map((vi) => {
            const it = filtered[vi.index];
            const isOn = equipped?.has(it.id);
            const path = cosmeticModelPath(it, undefined, (classFilter === 'any' ? cls : classFilter) as Tf2Class | undefined);
            const has3d = !!path && modelAvailable(path);
            return (
              <div key={it.id} className="item-row" role="option" aria-selected={selectedId === it.id || isOn} tabIndex={0}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)`, height: 50 }}
                onClick={() => onPick(it)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(it); } }}>
                <ItemIcon path={it.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="name">{it.name}</div>
                  <div className="meta">#{it.id} · {it.regions.map(regionLabel).join(', ') || it.slot}{it.classes[0] === 'all' ? ' · all-class' : ''}</div>
                </div>
                <div className="row" style={{ gap: 4, color: 'var(--muted)' }}>
                  {it.paintable && <Paintbrush size={13} aria-label="Paintable" />}
                  {has3d && <Box size={13} aria-label="3D model available" style={{ color: 'var(--ok)' }} />}
                  {extra?.(it)}
                  {isOn && <Check size={15} aria-label="Equipped" style={{ color: 'var(--accent-hi)' }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
