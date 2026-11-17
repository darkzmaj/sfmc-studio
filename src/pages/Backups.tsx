import { useEffect, useState } from 'react';
import { Archive, Upload, ShieldCheck, TriangleAlert } from 'lucide-react';
import { applyRestore, createBackup, estimateBackup, readBackup, type ConflictStrategy, type RestorePlan } from '../lib/backup';
import { download } from '../lib/exporters';
import { mountImports } from '../lib/tf2files';
import { useApp } from '../state/app';
import { Notice, fmtBytes, fmtDate } from '../components/ui';

export default function Backups() {
  const { settings, toast, refreshTypes, updateSettings } = useApp();
  const [est, setEst] = useState<Awaited<ReturnType<typeof estimateBackup>> | null>(null);
  const [includeImports, setIncludeImports] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both');
  const [restoreSettings, setRestoreSettings] = useState(false);
  useEffect(() => { void estimateBackup().then(setEst); }, []);

  const backup = async () => {
    setBusy('Preparing');
    try {
      const blob = await createBackup({ includeImportedFiles: includeImports }, setBusy);
      download(blob, `sfmc-backup-${new Date().toISOString().slice(0, 10)}.zip`);
      await updateSettings({ lastBackupAt: new Date().toISOString() });
      toast(`Backup downloaded (${fmtBytes(blob.size)})`, 'success');
    } catch (e) { toast(`Backup failed: ${(e as Error).message}`, 'error'); }
    finally { setBusy(null); }
  };
  const read = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Reading backup');
    try { setPlan(await readBackup(f)); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const restore = async () => {
    if (!plan) return;
    setBusy('Restoring');
    try {
      const r = await applyRestore(plan, strategy, { restoreSettings });
      await mountImports(); await refreshTypes();
      toast(`Restored: ${r.added} added, ${r.replaced} replaced, ${r.skipped} skipped`, 'success');
      setPlan(null);
      setEst(await estimateBackup());
    } catch (e) { toast(`Restore failed: ${(e as Error).message}`, 'error'); }
    finally { setBusy(null); }
  };
  const conflicts = plan?.characters.filter((c) => c.existing).length ?? 0;

  return (
    <div className="page stack" style={{ gap: 22 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Safety</div><h1>Backups</h1><p>Your library lives only in this browser. A ZIP backup is the only copy that survives clearing site data, switching browsers or a reinstall.</p></div>
      </div>
      <Notice tone="warn"><strong>Browser storage is not permanent.</strong> Private or incognito windows, “clear browsing data”, storage eviction on low disk space and uninstalling the browser can delete everything here. Browser storage is separated by browser profile and website, not by person: anyone using this same unlocked browser profile can open your characters.</Notice>
      <section className="card card-pad stack">
        <div className="row"><h2>Create backup</h2><span className="spacer" /><span className="hint">Last backup: {fmtDate(settings.lastBackupAt)}</span></div>
        {est && <p className="hint">{est.characters} characters · {fmtBytes(est.userBytes)} of thumbnails and reference images{est.importedCount ? ` · ${est.importedCount} imported model files (${fmtBytes(est.importedBytes)})` : ''}.</p>}
        <label className="check"><input type="checkbox" checked={includeImports} onChange={(e) => setIncludeImports(e.target.checked)} disabled={!est?.importedCount} />Include imported model files{est?.importedCount ? ` (${fmtBytes(est.importedBytes)})` : ''}. Keep such backups private if the files are not yours to share.</label>
        <p className="hint">Contents: every character, its version history, thumbnails, reference images, custom model types, model links, settings, and a manifest with SHA-256 checksums for integrity checks. Linked TF2 game files are never included.</p>
        <div className="row"><button className="btn primary" disabled={!!busy} onClick={() => void backup()}><Archive />{busy && !plan ? `${busy}…` : 'Download ZIP backup'}</button></div>
        <label className="field" style={{ maxWidth: 320 }}><span>Remind me to back up after</span>
          <select className="select" value={settings.backupReminderDays} onChange={(e) => void updateSettings({ backupReminderDays: Number(e.target.value) })}>
            <option value={0}>Never remind me</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
          </select></label>
      </section>
      <section className="card card-pad stack">
        <h2>Restore from backup</h2>
        <p className="hint">Restoring adds to what is already here. You choose what happens when a character with the same ID exists.</p>
        <label className="btn" style={{ justifySelf: 'start' }}><Upload />Choose backup ZIP<input type="file" accept=".zip" hidden onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {plan && (
          <div className="stack">
            <div className="row wrap">
              {plan.integrity.ok ? <span className="badge ok"><ShieldCheck size={12} />Integrity verified</span> : <span className="badge err"><TriangleAlert size={12} />{plan.integrity.problems.length} integrity problems</span>}
              <span className="badge">Created {fmtDate(plan.manifest.createdAt)}</span>
              <span className="badge">App {plan.manifest.app.version}</span>
              <span className="badge">{plan.characters.length} characters</span>
              {plan.manifest.includesImportedFiles && <span className="badge">Includes imported files</span>}
            </div>
            {!plan.integrity.ok && <details><summary className="hint">Show problems</summary><ul className="hint">{plan.integrity.problems.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}</ul></details>}
            {conflicts > 0 ? (
              <label className="field" style={{ maxWidth: 420 }}><span>{conflicts} character{conflicts === 1 ? '' : 's'} already exist here</span>
                <select className="select" value={strategy} onChange={(e) => setStrategy(e.target.value as ConflictStrategy)}>
                  <option value="keep-both">Keep both (restored copies get new IDs)</option>
                  <option value="overwrite">Overwrite the existing ones</option>
                  <option value="skip">Skip them</option>
                </select></label>
            ) : <p className="hint">No conflicts with characters in this browser.</p>}
            <label className="check"><input type="checkbox" checked={restoreSettings} onChange={(e) => setRestoreSettings(e.target.checked)} />Also restore settings</label>
            <div className="row"><button className="btn" onClick={() => setPlan(null)}>Cancel</button><button className="btn primary" disabled={!!busy} onClick={() => void restore()}>{strategy === 'overwrite' && conflicts ? `Restore and overwrite ${conflicts}` : 'Restore'}</button></div>
          </div>
        )}
      </section>
    </div>
  );
}
