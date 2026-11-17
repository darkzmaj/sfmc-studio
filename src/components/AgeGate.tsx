import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useApp } from '../state/app';
import { Modal } from './ui';

/** Age confirmation for 18+ model entries. Stored only in this browser; can be revoked in Settings. */
export function AgeGate() {
  const [open, setOpen] = useState(false);
  const update = useApp((s) => s.updateSettings);
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row"><ShieldAlert size={16} color="var(--warn)" /><strong style={{ fontWeight: 600 }}>Adult content hidden</strong></div>
      <p className="hint">This site offers models marked as 18+. They stay hidden until you confirm you are an adult.</p>
      <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>I am 18 or older</button>
      <Modal open={open} title="Confirm your age" onClose={() => setOpen(false)} footer={<>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" onClick={() => { void update({ matureConfirmed: true }); setOpen(false); }}>I am 18+, show them</button>
      </>}>
        <p>18+ models may contain nudity or sexual themes. By continuing you confirm that you are at least 18 years old and that viewing such content is legal where you are.</p>
        <p className="hint">This choice is saved in this browser only. You can hide 18+ models again in Settings.</p>
      </Modal>
    </div>
  );
}
