import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Expand, Grid3x3, Box, Square, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Viewer } from '../viewer/Viewer';
import type { RigStatus } from '../viewer/rig';
import { setActiveViewer } from '../viewer/active';
import { useEditor } from '../state/editor';
import { useApp } from '../state/app';
import type { CharacterConfig } from '../lib/types';

export function useRigStatus() {
  const [s, set] = useState<RigStatus>({ base: 'empty', cosmetics: {} });
  return [s, set] as const;
}

export default function ViewerPane({ onStatus, onViewer, config: configProp }: { onStatus: (s: RigStatus) => void; onViewer?: (v: Viewer | null) => void; config?: CharacterConfig }) {
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<RigStatus>({ base: 'empty', cosmetics: {} });
  const [opts, setOpts] = useState({ grid: true, ortho: false });
  const [glError, setGlError] = useState<string | null>(null);
  const editorConfig = useEditor((s) => s.character?.config);
  const config = configProp ?? editorConfig;
  const types = useApp((s) => s.types);
  const assetsVersion = useApp((s) => s.assetsVersion);
  const type = types.find((t) => t.id === config?.typeId);

  useEffect(() => {
    if (!host.current) return;
    let v: Viewer;
    try { v = new Viewer(host.current); } catch (e) { setGlError(String((e as Error).message || e)); return; }
    viewer.current = v;
    setActiveViewer(v);
    onViewer?.(v);
    v.rig.onStatus = (s) => { setStatus(s); onStatus(s); };
    return () => { setActiveViewer(null); onViewer?.(null); v.dispose(); viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply on any config/type/asset change. The rig coalesces rapid updates.
  useEffect(() => {
    if (viewer.current && type && config) void viewer.current.rig.apply(type, config);
  }, [config, type]);

  // Rebuild base model when linked files change (e.g. TF2 linked after opening the editor).
  const lastAssets = useRef(assetsVersion);
  useEffect(() => {
    if (lastAssets.current !== assetsVersion && viewer.current && type && config) {
      lastAssets.current = assetsVersion;
      viewer.current.rig.dispose();
      void viewer.current.rig.apply(type, config);
    }
  }, [assetsVersion, type, config]);

  const toggle = (k: 'grid' | 'ortho') => {
    const next = { ...opts, [k]: !opts[k] };
    setOpts(next);
    viewer.current?.setOptions(k === 'grid' ? { grid: next.grid, floor: next.grid } : { ortho: next.ortho });
  };
  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = viewer.current;
      if (!v) return;
      const map: Record<string, () => void> = {
        '1': () => v.view('front'), '2': () => v.view('back'), '3': () => v.view('left'), '4': () => v.view('right'), '5': () => v.view('top'),
        '0': () => v.view('three-quarter'), r: () => v.reset(), f: fullscreen, g: () => toggle('grid'), o: () => toggle('ortho'),
        '=': () => v.zoom(0.85), '+': () => v.zoom(0.85), '-': () => v.zoom(1.18),
      };
      const fn = map[e.key.toLowerCase()];
      if (fn) { fn(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const loadingCosmetics = Object.values(status.cosmetics).filter((c) => c.state === 'loading').length;

  return (
    <div className="editor-center" ref={wrap}>
      <div className="viewer-host" ref={host} />
      {glError && <div className="viewer-state"><div className="card"><h3>WebGL is not available</h3><p className="hint" style={{ marginTop: 8 }}>{glError}. The 3D preview needs WebGL; your characters and exports still work.</p></div></div>}
      <div className="viewer-tools" role="toolbar" aria-label="Viewer">
        <button className="btn icon sm ghost" title="Zoom in (+)" aria-label="Zoom in" onClick={() => viewer.current?.zoom(0.85)}><ZoomIn /></button>
        <button className="btn icon sm ghost" title="Zoom out (-)" aria-label="Zoom out" onClick={() => viewer.current?.zoom(1.18)}><ZoomOut /></button>
        <button className="btn icon sm ghost" title="Reset view (R)" aria-label="Reset view" onClick={() => viewer.current?.reset()}><RotateCcw /></button>
        <button className={`btn icon sm ghost ${opts.grid ? 'on' : ''}`} title="Grid and floor (G)" aria-label="Toggle grid" aria-pressed={opts.grid} onClick={() => toggle('grid')}><Grid3x3 /></button>
        <button className={`btn icon sm ghost ${opts.ortho ? 'on' : ''}`} title={opts.ortho ? 'Orthographic (O)' : 'Perspective (O)'} aria-label="Toggle orthographic camera" aria-pressed={opts.ortho} onClick={() => toggle('ortho')}>{opts.ortho ? <Square /> : <Box />}</button>
        <button className="btn icon sm ghost" title="Fullscreen (F)" aria-label="Fullscreen" onClick={fullscreen}><Expand /></button>
      </div>
      {(status.base === 'loading' || loadingCosmetics > 0) && (
        <div className="viewer-overlay"><span className="badge"><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />{status.base === 'loading' ? 'Loading model' : `Loading ${loadingCosmetics} item${loadingCosmetics > 1 ? 's' : ''}`}</span></div>
      )}
      {(status.base === 'missing' || status.base === 'error') && (
        <div className="viewer-state">
          <div className="card">
            <h3>{status.base === 'missing' ? 'Model files needed' : 'Model could not be loaded'}</h3>
            <p className="hint" style={{ margin: '8px 0 14px' }}>{status.message}</p>
            {status.base === 'missing' && <Link className="btn primary" to="/imports">{type?.source.kind === 'tf2-vpk' ? 'Link TF2 folder' : 'Import model files'}</Link>}
          </div>
        </div>
      )}
      <div className="viewer-hint">Drag to orbit · Right-drag to pan · Scroll to zoom · <span className="kbd">1</span>-<span className="kbd">5</span> views</div>
    </div>
  );
}
