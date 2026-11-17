import { useEffect, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { db, requestPersistence, storageEstimate, wipeAll } from '../lib/db';
import { useApp } from '../state/app';
import { Notice, fmtBytes, useConfirm } from '../components/ui';

export default function Settings() {
  const { settings, updateSettings, toast } = useApp();
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const refresh = () => storageEstimate().then(setEst);
  useEffect(() => { void refresh(); }, []);
  return (
    <div className="page stack" style={{ gap: 22 }}>
      {confirmEl}
      <div className="page-head" style={{ marginBottom: 0 }}><div><div className="eyebrow">Preferences</div><h1>Settings</h1><p>Settings are stored in this browser along with your library.</p></div></div>
      <section className="card card-pad stack" style={{ maxWidth: 720 }}>
        <h2>Editor</h2>
        <div className="grid-2">
          <label className="field"><span>Default team for new characters</span>
            <select className="select" value={settings.defaultTeam} onChange={(e) => void updateSettings({ defaultTeam: e.target.value as 'red' | 'blu' })}><option value="red">RED</option><option value="blu">BLU</option></select></label>
          <label className="field"><span>Texture quality</span>
            <select className="select" value={settings.textureQuality} onChange={(e) => { void updateSettings({ textureQuality: Number(e.target.value) as 512 | 1024 | 2048 }); toast('Applies to models loaded from now on'); }}>
              <option value={2048}>High (up to 2048 px)</option><option value={1024}>Medium (1024 px)</option><option value={512}>Low (512 px, saves memory)</option></select></label>
        </div>
        <label className="check"><input type="checkbox" checked={settings.matureConfirmed} onChange={(e) => void updateSettings({ matureConfirmed: e.target.checked })} />Show 18+ models (I confirm I am 18 or older)</label>
        <label className="check"><input type="checkbox" checked={!settings.introDismissed} onChange={(e) => void updateSettings({ introDismissed: !e.target.checked })} />Show the getting-started guide on the dashboard</label>
      </section>
      <section className="card card-pad stack" style={{ maxWidth: 720 }}>
        <h2>Storage</h2>
        {est && <p><HardDrive size={14} style={{ verticalAlign: -2 }} /> Using {fmtBytes(est.usage)} of about {fmtBytes(est.quota)} available to this site. Persistent storage: <strong>{est.persisted ? 'granted' : 'not granted'}</strong>.</p>}
        <p className="hint">Persistent storage asks the browser not to evict your library under disk pressure. Browsers may still refuse, and clearing site data always removes it.</p>
        <div className="row wrap">
          <button className="btn" disabled={est?.persisted} onClick={async () => { const ok = await requestPersistence(); toast(ok ? 'Persistent storage granted' : 'The browser declined persistent storage', ok ? 'success' : 'error'); void refresh(); }}>Request persistent storage</button>
          <button className="btn" onClick={async () => { await (await db()).clear('icons'); toast('Icon cache cleared'); void refresh(); }}>Clear icon cache</button>
        </div>
      </section>
      <section className="card card-pad stack" style={{ maxWidth: 720 }}>
        <h2>Danger zone</h2>
        <Notice tone="err">Deleting all data removes every character, version, image, import and setting from this browser. Download a backup first.</Notice>
        <button className="btn danger" style={{ justifySelf: 'start' }} onClick={async () => {
          if (await confirm({ title: 'Delete all local data?', body: 'Everything SFMC Studio stored in this browser will be removed permanently. This cannot be undone.', action: 'Delete everything', danger: true })) {
            await wipeAll();
            localStorage.clear();
            location.assign('/');
          }
        }}><Trash2 />Delete all local data</button>
      </section>
    </div>
  );
}
