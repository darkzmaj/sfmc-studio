// Edits recorded footage into the final tutorial MP4s (H.264 + AAC).
// Usage: node video/scripts/build.mjs landscape|portrait
// Inputs: video/raw/<mode>/{frames,timeline.json}. Output: video/out/sfmc-studio-tutorial-<mode>.mp4
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2] ?? 'landscape';
const portrait = mode === 'portrait';
const raw = resolve('video', 'raw', mode);
const work = resolve('video', 'work', mode);
const outDir = resolve('video', 'out');
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });
const tl = JSON.parse(readFileSync(join(raw, 'timeline.json'), 'utf8'));
const W = tl.size.w, H = tl.size.h, FPS = 30;
const t0 = tl.frames[0].t;
const T = tl.frames.at(-1).t - t0 + 0.5;
const INTRO = 3.5, OUTRO = 5, XF1 = 0.6, XF2 = 0.8;
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// 1. Variable-rate screencast frames -> constant 30 fps.
const list = tl.frames.map((f, i) => {
  const next = tl.frames[i + 1];
  const d = next ? Math.max(0.001, next.t - f.t) : 0.5;
  return `file '${join(raw, 'frames', f.name).replace(/\\/g, '/')}'\nduration ${d.toFixed(4)}`;
}).join('\n') + `\nfile '${join(raw, 'frames', tl.frames.at(-1).name).replace(/\\/g, '/')}'\n`;
writeFileSync(join(work, 'frames.txt'), list);
ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'), '-vf', `fps=${FPS},scale=${W}:${H}:flags=lanczos:in_range=full:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', join(work, 'main.mp4')]);

// 2. Captions and title cards rendered with the site's own fonts.
// Fonts are inlined as data URIs: pages created with setContent cannot load file:// fonts.
const dataFont = (p) => `data:font/woff2;base64,${readFileSync(resolve(p)).toString('base64')}`;
const font = dataFont('node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2');
const mono = dataFont('node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2');
const mark = `<svg viewBox="0 0 32 32" width="__S__" height="__S__"><rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#1f1d1b" stroke="#3b3734"/><path d="M7 10V7h3M22 7h3v3M25 22v3h-3M10 25H7v-3" fill="none" stroke="#dd6a2e" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="12" r="3.2" fill="#ece6df"/><path d="M10.5 23.5c.6-4.2 2.8-6.6 5.5-6.6s4.9 2.4 5.5 6.6" fill="#ece6df"/></svg>`;
const css = `@font-face{font-family:A;src:url(${font})}@font-face{font-family:M;src:url(${mono})}*{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;background:transparent;font-family:A,sans-serif;color:#ece6df;-webkit-font-smoothing:antialiased}`;
const steps = tl.markers.filter((m) => m.label !== 'END');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
async function png(html, file, transparent = true) {
  await page.setContent(`<style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
}
const caps = [];
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  const start = s.t - t0 + 0.2;
  const end = (tl.markers[tl.markers.indexOf(s) + 1]?.t ?? tl.frames.at(-1).t) - t0 - 0.1;
  const n = `${String(i + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
  const pos = portrait ? 'top:150px;left:50%;transform:translateX(-50%);width:960px' : 'bottom:118px;left:50%;transform:translateX(-50%);max-width:1360px';
  const size = portrait ? 50 : 36;
  await png(`<div style="position:absolute;${pos};background:rgba(18,17,16,.9);border:1px solid #3b3734;border-radius:${portrait ? 22 : 14}px;padding:${portrait ? '26px 34px' : '18px 30px'};box-shadow:0 20px 50px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:${portrait ? 12 : 8}px">
    <span style="font-family:M;font-size:${portrait ? 26 : 19}px;color:#ef7d40;letter-spacing:.06em">${n}</span>
    <span style="font-size:${size}px;font-weight:620;line-height:1.22;letter-spacing:-.01em">${s.label}</span></div>`, join(work, `cap${i}.png`));
  caps.push({ file: join(work, `cap${i}.png`), start, end });
}
const cardBase = `position:absolute;inset:0;background:#121110;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${portrait ? 34 : 26}px;padding:80px`;
const grid = `background-image:linear-gradient(#1c1b19 1px,transparent 1px),linear-gradient(90deg,#1c1b19 1px,transparent 1px);background-size:64px 64px`;
await png(`<div style="${cardBase};${grid}">${mark.replace(/__S__/g, portrait ? 200 : 150)}
  <div style="font-size:${portrait ? 96 : 92}px;font-weight:700;letter-spacing:-.02em;line-height:1.02">SFM Character Studio</div>
  <div style="font-size:${portrait ? 44 : 38}px;color:#b9b0a6;max-width:${portrait ? 900 : 1300}px;line-height:1.3">Build TF2 characters once. Reuse them in every film.</div>
  <div style="font-family:M;font-size:${portrait ? 28 : 22}px;color:#ef7d40;letter-spacing:.08em">OPEN SOURCE · RUNS IN YOUR BROWSER · PRIVATE</div></div>`, join(work, 'intro.png'), false);
await png(`<div style="${cardBase};${grid}">${mark.replace(/__S__/g, portrait ? 170 : 120)}
  <div style="font-size:${portrait ? 46 : 40}px;color:#b9b0a6">Try it now, free</div>
  <div style="font-size:${portrait ? 92 : 104}px;font-weight:700;letter-spacing:-.02em;color:#ef7d40">sfmc-studio.kori.my</div>
  <div style="font-size:${portrait ? 34 : 30}px;color:#ece6df;line-height:1.4">Open source on GitHub<br><span style="font-family:M;color:#b9b0a6;font-size:${portrait ? 28 : 26}px">github.com/darkzmaj/sfmc-studio</span></div>
  <div style="font-size:${portrait ? 24 : 20}px;color:#8a8279;max-width:${portrait ? 900 : 1400}px;line-height:1.5;margin-top:20px">© 2026 Maj Kovačič · darkzmaj.eu · KORI Network<br>Not affiliated with or endorsed by Valve Corporation. TF2 assets shown are loaded from the creator's own game install.</div></div>`, join(work, 'outro.png'), false);
await browser.close();

// 3. Music bed (original, synthesised).
const total = INTRO + T + OUTRO - XF1 - XF2;
execFileSync('node', [resolve('video/scripts/music.mjs'), String(Math.ceil(total + 1)), join(work, 'music.wav')], { stdio: 'inherit' });

// 4. Composite: captions over footage, intro/outro crossfades, gentle zoom on cards.
const inputs = ['-i', join(work, 'main.mp4')];
caps.forEach((c) => inputs.push('-loop', '1', '-t', T.toFixed(2), '-i', c.file));
const iIntro = caps.length + 1, iOutro = caps.length + 2, iMusic = caps.length + 3;
inputs.push('-loop', '1', '-t', String(INTRO), '-i', join(work, 'intro.png'), '-loop', '1', '-t', String(OUTRO), '-i', join(work, 'outro.png'), '-i', join(work, 'music.wav'));
let g = `[0:v]setsar=1,fps=${FPS}[v0];`;
caps.forEach((c, i) => {
  g += `[${i + 1}:v]format=rgba,fade=t=in:st=${c.start.toFixed(2)}:d=0.3:alpha=1,fade=t=out:st=${Math.max(c.start + 0.3, c.end - 0.3).toFixed(2)}:d=0.3:alpha=1[c${i}];`;
  g += `[v${i}][c${i}]overlay=0:0:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[v${i + 1}];`;
});
const zoom = (idx, dur, lbl) => `[${idx}:v]scale=${W * 2}:${H * 2},zoompan=z='1+0.035*on/${Math.round(dur * FPS)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},trim=duration=${dur},setsar=1,scale=out_range=tv,format=yuv420p[${lbl}];`;
g += zoom(iIntro, INTRO, 'in') + zoom(iOutro, OUTRO, 'out');
g += `[v${caps.length}]scale=out_range=tv,format=yuv420p[main];`;
g += `[in][main]xfade=transition=fade:duration=${XF1}:offset=${(INTRO - XF1).toFixed(2)}[a];`;
g += `[a][out]xfade=transition=fade:duration=${XF2}:offset=${(INTRO + T - XF1 - XF2).toFixed(2)}[vout];`;
g += `[${iMusic}:a]atrim=0:${total.toFixed(2)},loudnorm=I=-19:TP=-2:LRA=7,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[aout]`;
writeFileSync(join(work, 'graph.txt'), g);
const out = join(outDir, `sfmc-studio-tutorial-${mode === 'portrait' ? 'vertical-1080x1920' : 'youtube-1920x1080'}.mp4`);
ff([...inputs, '-/filter_complex', join(work, 'graph.txt'), '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-metadata', 'title=SFM Character Studio tutorial',
  '-metadata', 'artist=Maj Kovačič', '-t', total.toFixed(2), out]);
console.log(`${out}  (${total.toFixed(1)} s)`);
