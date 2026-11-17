import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, Info, Package, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../state/app';
import { assets } from '../lib/source/assets';
import { decodeVtf } from '../lib/source/vtf';
import { db } from '../lib/db';

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  // Original mark: a figure silhouette inside a camera frame.
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#1f1d1b" stroke="#3b3734" />
      <path d="M7 10V7h3M22 7h3v3M25 22v3h-3M10 25H7v-3" fill="none" stroke="#dd6a2e" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="12" r="3.2" fill="#ece6df" />
      <path d="M10.5 23.5c.6-4.2 2.8-6.6 5.5-6.6s4.9 2.4 5.5 6.6" fill="#ece6df" />
    </svg>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="btn ghost icon sm" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X /></button>
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer }: { open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose} aria-label={title}>
      {open && (
        <>
          <div className="modal-body"><h2>{title}</h2>{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Confirmation dialog hook. Usage: const [confirm, el] = useConfirm(); await confirm({...}) */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; action: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = (o: { title: string; body: ReactNode; action: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const el = (
    <Modal open={!!state} title={state?.title ?? ''} onClose={() => close(false)} footer={<>
      <button className="btn" onClick={() => close(false)}>Cancel</button>
      <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{state?.action}</button>
    </>}>
      <div style={{ color: 'var(--text-2)' }}>{state?.body}</div>
    </Modal>
  );
  return [confirm, el] as const;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'err'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : tone === 'warn' ? TriangleAlert : CircleAlert;
  return <div className={`notice ${tone === 'info' ? '' : tone}`}><Icon /><div>{children}</div></div>;
}

// --- Item icons decoded from the visitor's own VPK files, cached in IndexedDB ---
const iconMem = new Map<string, Promise<string | null>>();
async function vtfToPngBlob(path: string): Promise<Blob | null> {
  const buf = await assets.read(`materials/${path}.vtf`);
  if (!buf) return null;
  const d = decodeVtf(buf, 128);
  const canvas = document.createElement('canvas');
  canvas.width = d.width; canvas.height = d.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(d.data.buffer as ArrayBuffer, d.data.byteOffset, d.data.byteLength), d.width, d.height), 0, 0);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}
export function iconUrl(path: string): Promise<string | null> {
  let p = iconMem.get(path);
  if (!p) {
    p = (async () => {
      const store = await db();
      let blob = await store.get('icons', path);
      if (!blob) {
        if (!assets.has(`materials/${path}.vtf`)) return null;
        blob = (await vtfToPngBlob(path).catch(() => null)) ?? undefined;
        if (blob) await store.put('icons', blob, path);
      }
      return blob ? URL.createObjectURL(blob) : null;
    })();
    iconMem.set(path, p);
    p.then((v) => { if (!v) iconMem.delete(path); });
  }
  return p;
}

export function ItemIcon({ path, size, alt = '' }: { path?: string; size?: 'lg'; alt?: string }) {
  const version = useApp((s) => s.assetsVersion);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) void iconUrl(path).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path, version]);
  return <div className={`item-icon ${size ?? ''}`}>{url ? <img src={url} alt={alt} loading="lazy" /> : <Package aria-hidden="true" />}</div>;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
