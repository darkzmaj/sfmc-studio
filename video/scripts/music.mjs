// Original ambient music bed, synthesised from scratch (no samples, no third-party audio).
// Usage: node video/scripts/music.mjs <seconds> <out.wav>
import { writeFileSync } from 'node:fs';

const seconds = Number(process.argv[2] ?? 90);
const out = process.argv[3] ?? 'music.wav';
const SR = 48000;
const N = Math.ceil(seconds * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Am9 -> Fmaj7 -> Cmaj9 -> G6, 8 s per chord, 2 s raised-cosine crossfades.
const chords = [[45, 52, 55, 59, 60], [41, 48, 52, 57, 64], [48, 55, 59, 62, 64], [43, 50, 52, 59, 62]];
const CH = 8, XF = 2;
const env = (t, start) => {
  const a = t - start;
  if (a < 0 || a > CH + XF) return 0;
  if (a < XF) return 0.5 - 0.5 * Math.cos((Math.PI * a) / XF);
  if (a > CH) return 0.5 + 0.5 * Math.cos((Math.PI * (a - CH)) / XF);
  return 1;
};

for (let i = 0; i < N; i++) {
  const t = i / SR;
  let l = 0, r = 0;
  const k0 = Math.max(0, Math.floor((t - XF) / CH));
  for (let k = k0; k <= k0 + 1; k++) {
    const e = env(t, k * CH - XF / 2);
    if (!e) continue;
    const notes = chords[k % chords.length];
    notes.forEach((m, v) => {
      const f = hz(m);
      const lfo = 0.75 + 0.25 * Math.sin(2 * Math.PI * (0.07 + v * 0.013) * t + v);
      const det = 1.0035;
      const s = Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * det * t + 1.3) + 0.12 * Math.sin(4 * Math.PI * f * t);
      const amp = (v === 0 ? 0.16 : 0.085) * lfo * e;
      const pan = 0.5 + 0.35 * Math.sin(v * 1.7);
      l += s * amp * (1 - pan) * 2;
      r += s * amp * pan * 2;
    });
  }
  // Soft high "glint" every 4 s for movement.
  const g = t % 4;
  if (g < 1.6) {
    const notes = chords[Math.floor(t / CH) % chords.length];
    const f = hz(notes[(Math.floor(t / 4) % (notes.length - 1)) + 1] + 12);
    const ge = Math.exp(-g * 2.4) * (1 - Math.exp(-g * 40));
    const s = Math.sin(2 * Math.PI * f * t) * ge * 0.05;
    l += s * 0.8; r += s * 1.2;
  }
  L[i] = l; R[i] = r;
}

// One-pole low-pass, then a small stereo feedback-delay "room".
let pl = 0, pr = 0;
const a = Math.exp((-2 * Math.PI * 2600) / SR);
for (let i = 0; i < N; i++) { pl = (1 - a) * L[i] + a * pl; pr = (1 - a) * R[i] + a * pr; L[i] = pl; R[i] = pr; }
for (const [d, fb] of [[Math.round(0.083 * SR), 0.32], [Math.round(0.131 * SR), 0.26]]) {
  for (let i = d; i < N; i++) { L[i] += R[i - d] * fb; R[i] += L[i - d] * fb; }
}

// Fades and peak normalisation to -3 dBFS.
const fin = 3 * SR, fout = 4 * SR;
let peak = 0;
for (let i = 0; i < N; i++) {
  const f = Math.min(1, i / fin, (N - i) / fout);
  L[i] *= f; R[i] *= f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.707 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * gain * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * gain * 32767))), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`music: ${seconds}s -> ${out}`);
