// Edits the narrated showcase into a 16:9 YouTube cut and a 9:16 TikTok/Shorts cut.
// Usage: node video/scripts/build-showcase.mjs landscape|vertical
// Inputs: video/raw/showcase/{frames,timeline.json}, video/tts/out/*.wav (+durations.json)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const mode = process.argv[2] ?? 'vertical';
const V = mode === 'vertical';
const raw = resolve('video/raw/showcase');
const work = resolve('video/work/showcase', mode);
mkdirSync(work, { recursive: true });
mkdirSync(resolve('video/out'), { recursive: true });
const tl = JSON.parse(readFileSync(join(raw, 'timeline.json'), 'utf8'));
const vo = JSON.parse(readFileSync(resolve('video/tts/out/durations.json'), 'utf8')).durations;
const lines = Object.fromEntries(JSON.parse(readFileSync(resolve('video/tts/lines.json'), 'utf8')).lines.map((l) => [l.id, l.text]));
const OW = V ? 1080 : 1920, OH = V ? 1920 : 1080, FPS = 30;
const SW = tl.size.w, SH = tl.size.h, S = SW / tl.css.width; // source px per CSS px
const ORDER = V
  ? ['hook', 'intro', 'classes', 'search', 'prices', 'paint', 'total', 'editor', 'export', 'outro']
  : ['hook', 'intro', 'classes', 'search', 'prices', 'paint', 'total', 'editor', 'export', 'library', 'privacy', 'outro'];
const GAP = 0.18; // breath after each line
const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// Recorded segment windows.
const segs = tl.segments;
const win = (id) => { const i = segs.findIndex((s) => s.id === id); return i < 0 ? null : { a: segs[i].t, b: segs[i + 1].t }; };
const focusFor = (id) => { const w = win(id); const f = tl.focuses.filter((x) => x.t >= w.a - 0.05 && x.t < w.b); return f.at(-1) ?? f[0]; };

// Variable-rate frames -> one constant-rate master (source resolution) for trimming.
const list = tl.frames.map((f, i) => `file '${join(raw, 'frames', f.name).replace(/\\/g, '/')}'\nduration ${Math.max(0.001, (tl.frames[i + 1]?.t ?? f.t + 0.1) - f.t).toFixed(4)}`).join('\n');
writeFileSync(join(work, 'frames.txt'), `${list}\nfile '${join(raw, 'frames', tl.frames.at(-1).name).replace(/\\/g, '/')}'\n`);
const master = resolve('video/work/showcase/master.mp4');
try { readFileSync(master, { flag: 'r' }); } catch {
  ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'), '-vf', `fps=${FPS},scale=in_range=full:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', master]);
}
const t0 = tl.frames[0].t;

// Crop window for a segment.
function crop(id) {
  const f = focusFor(id);
  let zoom = f?.zoom ?? 1;
  if (!V && !['prices', 'total', 'hook'].includes(id)) zoom = 1;
  let ch = SH / (V ? Math.max(1, zoom) : zoom), cw = V ? ch * 9 / 16 : ch * 16 / 9;
  cw = Math.min(cw, SW); ch = Math.min(ch, SH);
  const cx = f ? (f.x + f.w / 2) * S : SW / 2, cy = f ? (f.y + f.h / 2) * S : SH / 2;
  const x = Math.round(Math.min(SW - cw, Math.max(0, cx - cw / 2)) / 2) * 2;
  const y = Math.round(Math.min(SH - ch, Math.max(0, cy - ch / 2)) / 2) * 2;
  return { x, y, w: Math.round(cw / 2) * 2, h: Math.round(ch / 2) * 2 };
}

// 1. Cut each segment to its narration length (speed-ramped for pace).
const clips = [];
let cursor = 0;
for (const id of ORDER) {
  const target = vo[id] + GAP + (id === 'hook' ? 0.25 : 0);
  if (id === 'outro') { clips.push({ id, start: cursor, dur: target + 0.9, card: true }); cursor += target + 0.9; continue; }
  const w = win(id);
  const src = w.b - w.a;
  const speed = Math.min(3.2, Math.max(0.75, src / target));
  const c = crop(id);
  const file = join(work, `clip-${id}.mp4`);
  ff(['-ss', (w.a - t0).toFixed(3), '-t', (Math.min(src, target * speed)).toFixed(3), '-i', master,
    '-vf', `setpts=PTS/${speed.toFixed(4)},crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${OW}:${OH}:flags=lanczos,fps=${FPS},tpad=stop_mode=clone:stop_duration=2,trim=duration=${target.toFixed(3)},setsar=1,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', file]);
  clips.push({ id, start: cursor, dur: target, file });
  cursor += target;
}
const TOTAL = cursor;

// 2. Overlays rendered with the site's fonts: TikTok-style caption chunks, hook title, end card.
const dataFont = (p) => `data:font/woff2;base64,${readFileSync(resolve(p)).toString('base64')}`;
const css = `@font-face{font-family:A;src:url(${dataFont('node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2')})}@font-face{font-family:M;src:url(${dataFont('node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2')})}*{margin:0;box-sizing:border-box}html,body{width:${OW}px;height:${OH}px;background:transparent;font-family:A,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: OW, height: OH } });
const png = async (html, file, transparent = true) => { await page.setContent(`<style>${css}</style>${html}`); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: file, omitBackground: transparent }); return file; };
const ACCENT = /^(free|3d|price|steam|market|blu|nine|every|before|costs|cent\??|save|export|library|sfmc|tf2)/i;
const overlays = [];
for (const c of clips) {
  if (c.card) continue;
  const words = lines[c.id].split(/\s+/);
  const per = V ? 3 : 5;
  const chunks = [];
  for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per));
  const chars = chunks.map((ch) => ch.join(' ').length + 4);
  const sum = chars.reduce((a, b) => a + b, 0);
  let t = c.start + 0.05;
  for (let k = 0; k < chunks.length; k++) {
    const d = (vo[c.id] * chars[k]) / sum;
    const html = chunks[k].map((w) => `<span style="color:${ACCENT.test(w) ? '#ffb36b' : '#fff'}">${w.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join(' ');
    const style = V
      ? `position:absolute;left:60px;right:60px;top:1240px;text-align:center;font-size:92px;font-weight:800;line-height:1.05;letter-spacing:-.01em;-webkit-text-stroke:14px #000;paint-order:stroke fill;text-transform:uppercase;text-shadow:0 8px 24px rgba(0,0,0,.6)`
      : `position:absolute;left:160px;right:160px;bottom:96px;text-align:center;font-size:58px;font-weight:780;line-height:1.1;-webkit-text-stroke:9px #000;paint-order:stroke fill;text-shadow:0 6px 18px rgba(0,0,0,.55)`;
    overlays.push({ file: await png(`<div style="${style}">${html}</div>`, join(work, `cap-${c.id}-${k}.png`)), a: t, b: t + d });
    t += d;
  }
}
// Hook title (top), shown during the hook.
const hookTitle = V
  ? `<div style="position:absolute;top:150px;left:50px;right:50px;text-align:center"><div style="display:inline-block;background:#dd6a2e;color:#1a0e07;font-weight:800;font-size:64px;line-height:1.08;padding:22px 34px;border-radius:24px;transform:rotate(-1.5deg);box-shadow:0 14px 40px rgba(0,0,0,.5)">TRY TF2 COSMETICS<br>BEFORE YOU BUY</div></div>`
  : `<div style="position:absolute;top:64px;left:0;right:0;text-align:center"><div style="display:inline-block;background:#dd6a2e;color:#1a0e07;font-weight:800;font-size:56px;padding:16px 34px;border-radius:18px">Try TF2 cosmetics before you buy</div></div>`;
overlays.push({ file: await png(hookTitle, join(work, 'hook-title.png')), a: 0, b: clips[0].dur });
// Persistent brand tag (vertical, after the hook).
if (V) overlays.push({ file: await png(`<div style="position:absolute;top:70px;left:0;right:0;text-align:center"><span style="font-family:M;font-size:30px;letter-spacing:.08em;color:#fff;background:rgba(18,17,16,.82);padding:10px 20px;border-radius:12px;border:1px solid #3b3734">SFMC-STUDIO.KORI.MY</span></div>`, join(work, 'tag.png')), a: clips[0].dur, b: clips.at(-1).start });
const mark = (s) => `<svg viewBox="0 0 32 32" width="${s}" height="${s}"><rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#1f1d1b" stroke="#3b3734"/><path d="M7 10V7h3M22 7h3v3M25 22v3h-3M10 25H7v-3" fill="none" stroke="#dd6a2e" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="12" r="3.2" fill="#ece6df"/><path d="M10.5 23.5c.6-4.2 2.8-6.6 5.5-6.6s4.9 2.4 5.5 6.6" fill="#ece6df"/></svg>`;
const card = await png(`<div style="position:absolute;inset:0;background:#121110;background-image:linear-gradient(#1c1b19 1px,transparent 1px),linear-gradient(90deg,#1c1b19 1px,transparent 1px);background-size:64px 64px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${V ? 40 : 26}px;padding:70px;color:#ece6df">
  ${mark(V ? 190 : 130)}
  <div style="font-size:${V ? 86 : 84}px;font-weight:760;letter-spacing:-.02em;line-height:1.02">SFM Character Studio</div>
  <div style="font-size:${V ? 82 : 96}px;font-weight:800;color:#ef7d40;letter-spacing:-.02em">sfmc-studio.kori.my</div>
  <div style="font-size:${V ? 40 : 34}px;color:#b9b0a6">Free · Open source · Runs in your browser</div>
  <div style="font-size:${V ? 24 : 20}px;color:#8a8279;max-width:${V ? 900 : 1400}px;line-height:1.5;margin-top:24px">© 2026 Maj Kovačič · darkzmaj.eu · KORI Network<br>Not affiliated with or endorsed by Valve Corporation. Prices are Steam Community Market estimates.</div></div>`, join(work, 'card.png'), false);
await browser.close();

// 3. Concatenate clips + end card, overlay text, mix narration over music.
const outro = clips.at(-1);
ff(['-loop', '1', '-t', outro.dur.toFixed(3), '-i', card, '-vf', `scale=${OW * 2}:${OH * 2},zoompan=z='1+0.04*on/${Math.round(outro.dur * FPS)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OW}x${OH}:fps=${FPS},trim=duration=${outro.dur.toFixed(3)},setsar=1,scale=out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', join(work, 'clip-outro.mp4')]);
outro.file = join(work, 'clip-outro.mp4');
writeFileSync(join(work, 'concat.txt'), clips.map((c) => `file '${c.file.replace(/\\/g, '/')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'concat.txt'), '-c', 'copy', join(work, 'video.mp4')]);
execFileSync('node', [resolve('video/scripts/music.mjs'), String(Math.ceil(TOTAL + 1)), join(work, 'music.wav'), '--beat'], { stdio: 'inherit' });

const inputs = ['-i', join(work, 'video.mp4')];
overlays.forEach((o) => inputs.push('-loop', '1', '-t', TOTAL.toFixed(2), '-i', o.file));
const vo0 = overlays.length + 1;
const used = clips.filter((c) => vo[c.id]);
used.forEach((c) => inputs.push('-i', resolve(`video/tts/out/${c.id}.wav`)));
const iMusic = vo0 + used.length;
inputs.push('-i', join(work, 'music.wav'));
let g = '[0:v]setsar=1[v0];';
overlays.forEach((o, i) => {
  const fade = 0.08;
  g += `[${i + 1}:v]format=rgba,fade=t=in:st=${o.a.toFixed(3)}:d=${fade}:alpha=1,fade=t=out:st=${Math.max(o.a, o.b - fade).toFixed(3)}:d=${fade}:alpha=1[o${i}];`;
  g += `[v${i}][o${i}]overlay=0:0:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})'[v${i + 1}];`;
});
g += `[v${overlays.length}]scale=out_range=tv,format=yuv420p[vout];`;
used.forEach((c, k) => { const ms = Math.round((c.start + 0.05) * 1000); g += `[${vo0 + k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[n${k}];`; });
g += `${used.map((_, k) => `[n${k}]`).join('')}amix=inputs=${used.length}:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=8[voice];`;
g += `[${iMusic}:a]atrim=0:${TOTAL.toFixed(2)},volume=0.16,afade=t=out:st=${(TOTAL - 1.5).toFixed(2)}:d=1.5[bed];`;
g += `[bed][voice]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=300[ducked];[ducked][voice]amix=inputs=2:normalize=0,alimiter=limit=0.89[aout]`;
// sidechaincompress consumes the voice stream, so split it first.
g = g.replace('[voice];', '[voice0];[voice0]asplit=2[voice][voicesc];').replace('[bed][voice]sidechaincompress', '[bed][voicesc]sidechaincompress');
writeFileSync(join(work, 'graph.txt'), g);
const out = resolve('video/out', V ? 'sfmc-studio-showcase-tiktok-1080x1920.mp4' : 'sfmc-studio-showcase-youtube-1920x1080.mp4');
ff([...inputs, '-/filter_complex', join(work, 'graph.txt'), '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-metadata', 'title=SFM Character Studio', '-metadata', 'artist=Maj Kovačič', '-t', TOTAL.toFixed(2), out]);
console.log(`${out}  (${TOTAL.toFixed(1)} s)`);
