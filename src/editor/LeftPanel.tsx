import { useState } from 'react';
import { AgeGate } from '../components/AgeGate';
import type { CatalogItem, CharacterType } from '../lib/types';
import { typeAvailability } from '../lib/catalog';
import { useApp } from '../state/app';
import { makeCosmetic, useEditor } from '../state/editor';
import CosmeticBrowser from './CosmeticBrowser';

const GROUPS: { key: CharacterType['category'][]; label: string }[] = [
  { key: ['tf2-class'], label: 'TF2 classes' },
  { key: ['female-variant'], label: 'Female variants' },
  { key: ['boss'], label: 'Bosses' },
  { key: ['custom', 'workshop'], label: 'Custom and imported' },
  { key: ['demo'], label: 'Test model' },
];

/** Types visible to this visitor: mature (18+) entries only after age confirmation. */
export function useVisibleTypes() {
  const types = useApp((s) => s.types);
  const ok = useApp((s) => s.settings.matureConfirmed);
  return types.filter((t) => !t.mature || ok);
}

export function availabilityBadge(t: CharacterType) {
  const a = typeAvailability(t);
  if (a === 'ready') return <span className="badge ok">Ready</span>;
  if (a === 'demo') return <span className="badge">Built-in</span>;
  if (a === 'needs-tf2') return <span className="badge warn">Needs TF2 files</span>;
  return <span className="badge warn">Needs import</span>;
}

export function TypePicker({ value, onPick }: { value?: string; onPick: (t: CharacterType) => void }) {
  const types = useVisibleTypes();
  const anyMature = useApp((s) => s.types.some((t) => t.mature));
  const matureOk = useApp((s) => s.settings.matureConfirmed);
  useApp((s) => s.assetsVersion);
  return (
    <div className="stack">
      {GROUPS.map((g) => {
        const list = types.filter((t) => g.key.includes(t.category) && !t.mature);
        if (!list.length) return null;
        return (
          <section key={g.label} className="stack" style={{ gap: 8 }}>
            <div className="panel-title">{g.label}</div>
            <div className="type-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {list.map((t) => (
                <button key={t.id} className="type-tile" aria-pressed={value === t.id} onClick={() => onPick(t)} title={t.notes}>
                  <span className="t-name">{t.name}</span>
                  {availabilityBadge(t)}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {anyMature && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="panel-title">18+ models</div>
          {matureOk ? (
            <div className="type-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
              {types.filter((t) => t.mature).map((t) => (
                <button key={t.id} className="type-tile" aria-pressed={value === t.id} onClick={() => onPick(t)} title={t.notes}>
                  <span className="t-name">{t.name}</span>{availabilityBadge(t)}
                </button>
              ))}
            </div>
          ) : <AgeGate />}
        </section>
      )}
    </div>
  );
}

export default function LeftPanel() {
  const [tab, setTab] = useState<'model' | 'cosmetics'>('cosmetics');
  const character = useEditor((s) => s.character);
  const setConfig = useEditor((s) => s.setConfig);
  const edit = useEditor((s) => s.edit);
  const types = useApp((s) => s.types);
  const toast = useApp((s) => s.toast);
  if (!character) return null;
  const type = types.find((t) => t.id === character.config.typeId);
  const equipped = new Set(character.config.cosmetics.map((c) => c.defindex).filter((x): x is number => x !== undefined));

  const pick = (item: CatalogItem) => {
    const existing = character.config.cosmetics.find((c) => c.defindex === item.id);
    if (existing) {
      edit((s) => ({ ...s, config: { ...s.config, cosmetics: s.config.cosmetics.filter((c) => c.uid !== existing.uid) } }));
      toast(`Removed ${item.name}`);
      return;
    }
    edit((s) => ({ ...s, config: { ...s.config, cosmetics: [...s.config.cosmetics, makeCosmetic({ defindex: item.id, name: item.name, style: item.styles?.[0]?.id })] } }));
  };

  return (
    <aside className="editor-left" aria-label="Character and cosmetics">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'model'} onClick={() => setTab('model')}>Base model</button>
        <button className="tab" role="tab" aria-selected={tab === 'cosmetics'} onClick={() => setTab('cosmetics')}>Cosmetics</button>
      </div>
      {tab === 'model' ? (
        <div className="pane">
          <div className="field">
            <span>Team</span>
            <div className="seg" role="group" aria-label="Team">
              <button className="team-red" aria-pressed={character.config.team === 'red'} onClick={() => setConfig({ team: 'red', skin: undefined })}>RED</button>
              <button className="team-blu" aria-pressed={character.config.team === 'blu'} onClick={() => setConfig({ team: 'blu', skin: undefined })}>BLU</button>
            </div>
          </div>
          <TypePicker value={character.config.typeId} onPick={(t) => setConfig({ typeId: t.id, bodygroups: {}, skin: undefined })} />
          {type && <p className="hint">{type.notes}</p>}
        </div>
      ) : (
        <CosmeticBrowser cls={type?.cosmeticClass} equipped={equipped} onPick={pick} compact />
      )}
    </aside>
  );
}
