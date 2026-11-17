import { useState } from 'react';
import { Link } from 'react-router';
import { Image as ImageIcon, FileJson, FileText, Package, Box, FileCode } from 'lucide-react';
import { useEditor } from '../state/editor';
import { useApp } from '../state/app';
import ViewerPane from '../editor/ViewerPane';
import { activeViewer } from '../viewer/active';
import type { RigStatus } from '../viewer/rig';
import type { ViewPreset } from '../viewer/Viewer';
import { buildBundle, buildManifest, download, manifestToMarkdown, safeName } from '../lib/exporters';
import { exportGlb } from '../lib/glb';
import { Notice } from '../components/ui';

const SIZES = [
  { label: 'Square 1024', w: 1024, h: 1024 }, { label: 'Square 2048', w: 2048, h: 2048 }, { label: 'Square 4096', w: 4096, h: 4096 },
  { label: 'Full HD 1920×1080', w: 1920, h: 1080 }, { label: '4K 3840×2160', w: 3840, h: 2160 }, { label: 'Portrait 1080×1920', w: 1080, h: 1920 },
];

export default function Exports() {
  const character = useEditor((s) => s.character);
  const types = useApp((s) => s.types);
  const toast = useApp((s) => s.toast);
  const [size, setSize] = useState(1);
  const [custom, setCustom] = useState({ w: 2560, h: 1440 });
  const [transparent, setTransparent] = useState(true);
  const [bg, setBg] = useState('#1b1a19');
  const [includeOwned, setIncludeOwned] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<RigStatus>({ base: 'empty', cosmetics: {} });

  if (!character) {
    return (
      <div className="page">
        <div className="page-head"><div><div className="eyebrow">Exports</div><h1>Export a character</h1><p>Open a character in the editor first. Exports are generated in your browser.</p></div></div>
        <div className="card empty"><h3>No character open</h3><p><Link to="/characters">Open one from your library</Link> or <Link to="/editor">create a new one</Link>.</p></div>
        <Formats />
      </div>
    );
  }
  const type = types.find((t) => t.id === character.config.typeId);
  const base = safeName(character.profile.name);
  const dims = size === SIZES.length ? custom : SIZES[size];
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast(`${label} failed: ${(e as Error).message}`, 'error'); } finally { setBusy(null); }
  };
  const png = () => run('PNG', async () => {
    const v = activeViewer(); if (!v) throw new Error('Viewer not ready');
    const blob = await v.capture({ width: dims.w, height: dims.h, transparent, background: bg });
    download(blob, `${base}-${dims.w}x${dims.h}.png`);
  });
  const view = (p: ViewPreset) => activeViewer()?.view(p);
  const max = activeViewer()?.maxCaptureSize ?? 4096;

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Exports</div><h1>{character.profile.name}</h1><p>Frame the shot below, then export. Everything is generated locally; nothing is uploaded.</p></div>
        <Link className="btn" to={`/editor/${character.id}`}>Back to editor</Link>
      </div>
      {useEditor.getState().dirty && <Notice tone="warn">This character has unsaved changes. Exports use the current state, including unsaved edits.</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16 }} className="exports-layout">
        <div className="card" style={{ position: 'relative', aspectRatio: `${dims.w} / ${dims.h}`, maxHeight: '70vh', overflow: 'hidden', background: transparent ? 'repeating-conic-gradient(#222 0 25%, #1a1a1a 0 50%) 50% / 20px 20px' : bg }}>
          <ViewerPane onStatus={setStatus} />
        </div>
        <div className="stack">
          <section className="card card-pad stack">
            <h2>PNG render</h2>
            <label className="field"><span>Resolution</span>
              <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {SIZES.map((s, i) => <option key={s.label} value={i} disabled={Math.max(s.w, s.h) > max}>{s.label}</option>)}
                <option value={SIZES.length}>Custom</option>
              </select></label>
            {size === SIZES.length && <div className="grid-2">
              <label className="field"><span>Width</span><input className="input" type="number" min={64} max={max} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Math.min(max, Math.max(64, Number(e.target.value))) })} /></label>
              <label className="field"><span>Height</span><input className="input" type="number" min={64} max={max} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Math.min(max, Math.max(64, Number(e.target.value))) })} /></label>
            </div>}
            <div className="field"><span>Camera angle</span><div className="seg" role="group" aria-label="Camera angle">{(['front', 'three-quarter', 'left', 'right', 'back', 'top'] as const).map((p) => <button key={p} onClick={() => view(p)}>{p === 'three-quarter' ? '3/4' : p[0].toUpperCase() + p.slice(1)}</button>)}</div></div>
            <div className="row"><label className="check"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />Transparent background</label><span className="spacer" />{!transparent && <input type="color" aria-label="Background colour" value={bg} onChange={(e) => setBg(e.target.value)} />}</div>
            <p className="hint">Maximum on this GPU: {max}px. Drag in the preview to set the angle; the grid is hidden in renders.</p>
            <button className="btn primary" disabled={!!busy || status.base !== 'ready'} onClick={() => void png()}><ImageIcon />{busy === 'PNG' ? 'Rendering…' : `Export PNG ${dims.w}×${dims.h}`}</button>
          </section>
          <section className="card card-pad stack">
            <h2>Specification and bundle</h2>
            <div className="row wrap">
              <button className="btn" disabled={!!busy} onClick={() => void run('Manifest', async () => download(new Blob([JSON.stringify(await buildManifest(character, type), null, 2)], { type: 'application/json' }), `${base}.manifest.json`))}><FileJson />Manifest JSON</button>
              <button className="btn" disabled={!!busy} onClick={() => void run('Markdown', async () => download(new Blob([manifestToMarkdown(await buildManifest(character, type))], { type: 'text/markdown' }), `${base}.md`))}><FileText />Markdown spec</button>
              <button className="btn" disabled={!!busy} onClick={() => void run('Character file', async () => download(new Blob([JSON.stringify(character, null, 2)], { type: 'application/json' }), `${base}.sfmc-character.json`))}><FileCode />Character file</button>
            </div>
            <label className="check"><input type="checkbox" checked={includeOwned} onChange={(e) => setIncludeOwned(e.target.checked)} />Include imported files marked as redistributable</label>
            <button className="btn" disabled={!!busy} onClick={() => void run('Bundle', async () => {
              const v = activeViewer();
              const render = v && status.base === 'ready' ? await v.capture({ width: 1024, height: 1024, transparent, background: bg }) : null;
              const { zip, included, excluded } = await buildBundle(character, type, { render, includeRedistributable: includeOwned });
              download(zip, `${base}.sfmc.zip`);
              toast(`Bundle: ${included.length} asset files included, ${excluded.length} referenced only`, 'success');
            })}><Package />Character bundle (ZIP)</button>
            <p className="hint">Bundles always contain the manifest, Markdown, character file, render and your reference images. TF2 and Workshop files are listed as references, never copied in.</p>
          </section>
          <section className="card card-pad stack">
            <h2>GLB conversion</h2>
            <p className="hint">Exports the rendered character as glTF binary with source paths and checksums in <code>extras</code>. Useful for previews in other tools. The original asset licences still apply.</p>
            <button className="btn" disabled={!!busy || status.base !== 'ready'} onClick={() => void run('GLB', async () => { const v = activeViewer(); if (!v) throw new Error('Viewer not ready'); download(await exportGlb(v, await buildManifest(character, type)), `${base}.glb`); })}><Box />Export GLB</button>
          </section>
        </div>
      </div>
      <style>{'@media (max-width: 960px) { .exports-layout { grid-template-columns: 1fr !important; } }'}</style>
      <Formats />
    </div>
  );
}

function Formats() {
  return (
    <section className="card card-pad stack" style={{ marginTop: 20 }}>
      <h2>Interchange format</h2>
      <p className="hint">Manifests use the versioned <code>sfmc.character.manifest</code> v1 format, designed so a future SFM MCP server can load a preset, resolve model dependencies, spawn the model, apply skins and bodygroups, attach cosmetics and read the personality and animation notes. No live MCP connection exists yet; exports are standalone files.</p>
      <div className="row wrap"><a className="btn" href="/schema/sfmc-character-manifest.v1.schema.json" download>JSON Schema</a><a className="btn ghost" href="https://github.com/darkzmaj/sfmc-studio/blob/main/docs/interchange-format.md" rel="noopener">Format documentation</a></div>
    </section>
  );
}
