import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, FolderInput, Plus, X } from 'lucide-react';
import { listCharacters, getBlob } from '../lib/db';
import type { Character } from '../lib/types';
import { useApp } from '../state/app';
import { newCharacter, useEditor } from '../state/editor';
import { Notice, relTime } from '../components/ui';
import { typeAvailability } from '../lib/catalog';

function Thumb({ id }: { id?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    if (id) void getBlob(id).then((b) => { if (b) { u = URL.createObjectURL(b.blob); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <img src={url} alt="" /> : <span className="hint">No preview</span>;
}
export { Thumb };

export default function Dashboard() {
  const { settings, updateSettings, tf2, types, ready, hosted } = useApp();
  const [chars, setChars] = useState<Character[] | null>(null);
  const nav = useNavigate();
  const load = useEditor((s) => s.load);
  useEffect(() => { void listCharacters().then((c) => setChars(c.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))); }, []);
  const recent = (chars ?? []).filter((c) => !c.isTemplate).slice(0, 4);
  const start = (typeId: string, name: string) => { const c = newCharacter(typeId, settings.defaultTeam, `New ${name}`); load(c, { dirty: true }); nav(`/editor/${c.id}`); };
  const daysSinceBackup = settings.lastBackupAt ? (Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000 : Infinity;
  const needBackup = (chars?.length ?? 0) > 0 && settings.backupReminderDays > 0 && daysSinceBackup > settings.backupReminderDays;
  const classes = types.filter((t) => t.category === 'tf2-class');

  return (
    <div className="page stack" style={{ gap: 26 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">SFM Character Studio</div>
          <h1>Build TF2 characters once, reuse them in every film.</h1>
          <p>Pick a mercenary, dress them in any cosmetics from the full item catalog, write who they are, and export a render plus a machine-readable spec for your Source Filmmaker workflow.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/try">Try a loadout</Link>
          <Link className="btn" to="/characters">Library</Link>
          <Link className="btn primary" to="/editor"><Plus />New character</Link>
        </div>
      </div>

      {needBackup && (
        <Notice tone="warn"><strong>Back up your library.</strong> Your characters live only in this browser. {settings.lastBackupAt ? `Last backup ${relTime(settings.lastBackupAt)}.` : 'You have not made a backup yet.'} <Link to="/backups">Download a ZIP backup</Link></Notice>
      )}

      {!settings.introDismissed && (
        <section className="stack">
          <div className="row"><h2>How it works</h2><span className="spacer" /><button className="btn ghost sm" onClick={() => void updateSettings({ introDismissed: true })}><X />Hide guide</button></div>
          <div className="steps">
            {hosted
              ? <div className="step"><span className="n">01</span><h3>Pick a class</h3><p>All nine classes and their cosmetics load right here in 3D. Nothing to install or import.</p><Link to="/try">Try a loadout</Link></div>
              : <div className="step"><span className="n">01</span><h3>Link your game files</h3><p>Point the studio at your own Team Fortress 2 folder. Models load straight from your VPKs; nothing is uploaded.</p><Link to="/imports">Link TF2 folder</Link></div>}
            <div className="step"><span className="n">02</span><h3>Create and customise</h3><p>Choose a class, switch RED or BLU, then search the catalog and click items to equip, paint and restyle them.</p></div>
            <div className="step"><span className="n">03</span><h3>Describe and save</h3><p>Write personality, voice and animation notes. Saving keeps a version history in this browser.</p></div>
            <div className="step"><span className="n">04</span><h3>Export and back up</h3><p>Export a PNG, a JSON manifest, a Markdown spec or a ZIP bundle. Back up the whole library as one ZIP.</p></div>
          </div>
        </section>
      )}

      {ready && tf2 !== 'linked' && !hosted && (
        <Notice><strong>{tf2 === 'needs-permission' ? 'Reconnect your TF2 folder.' : 'No game files linked yet.'}</strong> TF2 models are not hosted here. {tf2 === 'needs-permission' ? 'Your browser needs your permission again to read the folder you linked before.' : 'Link your own installation to see real 3D models; the test mannequin works without it.'} <Link to="/imports">Go to Imports <ArrowRight size={12} style={{ verticalAlign: -1 }} /></Link></Notice>
      )}

      <section className="stack">
        <div className="row"><h2>Start from a class</h2><span className="spacer" /><Link to="/models" className="hint">All models</Link></div>
        <div className="type-grid">
          {classes.map((t) => (
            <button key={t.id} className="type-tile" onClick={() => start(t.id, t.name)}>
              <span className="t-name">{t.name}</span>
              <span className="hint">{typeAvailability(t) === 'ready' ? 'Ready in 3D' : 'Needs TF2 files'}</span>
            </button>
          ))}
          <button className="type-tile" onClick={() => start('demo.mannequin', 'Mannequin')}><span className="t-name">Test mannequin</span><span className="hint">Works without game files</span></button>
        </div>
      </section>

      <section className="stack">
        <div className="row"><h2>Recent characters</h2><span className="spacer" /><Link to="/characters" className="hint">View all</Link></div>
        {chars && !recent.length && <div className="card empty"><h3>No saved characters yet</h3><p>Characters you save appear here.</p></div>}
        <div className="char-grid">
          {recent.map((c) => (
            <Link key={c.id} to={`/editor/${c.id}`} className="card char-card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="char-thumb"><Thumb id={c.thumbnailId} /></div>
              <div className="char-info"><span className="name">{c.profile.name}</span><span className="meta">{types.find((t) => t.id === c.config.typeId)?.name ?? c.config.typeId} · {c.config.team.toUpperCase()} · {relTime(c.updatedAt)}</span></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid-2">
        <div className="card card-pad stack">
          <h3>Private by design</h3>
          <p className="hint">Characters, descriptions and imports are stored in this browser's IndexedDB and never sent to a server. Clearing site data, private windows and storage pressure can remove them, so keep ZIP backups.</p>
          <Link to="/privacy">Privacy details</Link>
        </div>
        <div className="card card-pad stack">
          <h3>Bring your own models</h3>
          <p className="hint">Import Saxton Hale, female variants or any Workshop model you are allowed to use, then link it to a catalog entry. Files are validated and stay local.</p>
          <Link to="/imports" className="row" style={{ gap: 6 }}><FolderInput size={14} />Import model files</Link>
        </div>
      </section>
    </div>
  );
}
