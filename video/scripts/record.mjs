// Records real footage of the running app with Playwright + CDP screencast (high-quality JPEG frames).
// Usage: node video/scripts/record.mjs landscape|portrait [baseUrl]
// Needs: the app running (vite preview or dev), TF2_DIR pointing at a TF2 "tf" folder.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const mode = process.argv[2] ?? 'landscape';
const base = process.argv[3] ?? 'http://localhost:4173';
const TF = process.env.TF2_DIR ?? 'D:/SteamLibrary/steamapps/common/Team Fortress 2/tf';
const portrait = mode === 'portrait';
const out = join('video', 'raw', mode);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'frames'), { recursive: true });

const viewport = portrait ? { width: 432, height: 768 } : { width: 1920, height: 1080 };
const scale = portrait ? 2.5 : 1; // portrait frames come out at 1080x1920
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true, hasTouch: false, isMobile: false });

// Visible cursor + click ripple (the real pointer is invisible in headless captures).
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.6L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' });
    document.body.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '.__ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #ef7d40;pointer-events:none;z-index:2147483646;animation:__r .5s ease-out forwards}@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}';
    document.head.appendChild(st);
    addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  });
});

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const name = `${String(frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(join(out, 'frames', name), Buffer.from(data, 'base64'));
  frames.push({ name, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const markers = [];
const mark = (label) => { markers.push({ t: Date.now() / 1000, label }); console.log('·', label); };
const wait = (ms) => page.waitForTimeout(ms);
let mouse = { x: viewport.width / 2, y: viewport.height / 2 };

async function moveTo(target, opts = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const x = b.x + b.width * (opts.fx ?? 0.5), y = b.y + b.height * (opts.fy ?? 0.5);
  const dist = Math.hypot(x - mouse.x, y - mouse.y);
  await page.mouse.move(x, y, { steps: Math.max(12, Math.min(45, Math.round(dist / 18))) });
  mouse = { x, y };
  return { x, y };
}
async function click(target, pause = 350) { await moveTo(target); await wait(160); await page.mouse.down(); await page.mouse.up(); await wait(pause); }
async function type(target, text, delay = 55) { await click(target, 150); await page.keyboard.press('Control+A'); await page.keyboard.type(text, { delay }); }
async function drag(dx, dy, steps = 60, button = 'left') {
  await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) { await page.mouse.move(mouse.x + (dx * i) / steps, mouse.y + (dy * i) / steps); await wait(16); }
  mouse = { x: mouse.x + dx, y: mouse.y + dy };
  await page.mouse.up({ button });
}
async function nav(label) {
  if (portrait) { await click('button[aria-label="Open menu"]', 450); }
  await click(page.getByRole('link', { name: label, exact: true }).first(), 700);
}
async function scrollTo(target) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await wait(700);
}

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await wait(800);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width * scale, maxHeight: viewport.height * scale, everyNthFrame: 1 });
await wait(400);

// 1. Dashboard
mark('Open sfmc-studio.kori.my. No account, no sign-up.');
await moveTo('h1', { fx: 0.3 });
await wait(portrait ? 1800 : 2600);
if (portrait) { await page.mouse.wheel(0, 500); await wait(1200); await page.mouse.wheel(0, -500); await wait(600); }

// 2. Link TF2
mark('Link your own TF2 folder. Files are read in place, never uploaded.');
await nav('Imports');
await wait(900);
const vpkInput = page.locator('input[type=file][accept=".vpk"]');
await moveTo(page.getByText(/select \.vpk files/i).first());
await wait(500);
const files = readdirSync(TF).filter((f) => /^tf2_(misc|textures)_(dir|\d{3})\.vpk$/.test(f)).map((f) => join(TF, f));
await page.mouse.down(); await page.mouse.up();
await vpkInput.setInputFiles(files);
await page.getByText(/Linked 2 VPK sets/).waitFor({ timeout: 60000 });
await wait(1800);

// 3. Pick a class
mark('Pick a class to start a character.');
await nav('Character Editor');
await wait(700);
await moveTo(page.getByRole('button', { name: /^Soldier/ }).first());
await wait(300);
await click(page.getByRole('button', { name: /^Scout/ }).first(), 600);
await page.locator('canvas.viewer-canvas').waitFor();
await wait(2500);

// 4. Viewer interaction
mark('Real 3D: drag to orbit, scroll to zoom, right-drag to pan.');
const canvas = page.locator('canvas.viewer-canvas');
await moveTo(canvas, { fx: 0.5, fy: 0.5 });
await drag(portrait ? 260 : 520, 0, 90);
await wait(300);
await drag(portrait ? -130 : -260, portrait ? 40 : 60, 60);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -160); await wait(90); }
await wait(700);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 160); await wait(90); }
await wait(400);
await click(page.getByRole('button', { name: 'Front', exact: true }), 900);

// 5. Cosmetics
mark('Search the full TF2 cosmetic catalog and click to equip. No three-item limit.');
if (portrait) await scrollTo(page.getByRole('tab', { name: 'Cosmetics' }));
await click(page.getByRole('tab', { name: 'Cosmetics' }), 300);
for (const [q, name] of [['ballcap', 'Backwards Ballcap'], ['stereoscopic', 'Stereoscopic Shades'], ['cool cat', 'Cool Cat Cardigan'], ['ball-kicking', 'Ball-Kicking Boots']]) {
  if (portrait) await scrollTo(page.getByLabel('Search cosmetics'));
  await type(page.getByLabel('Search cosmetics'), q, 60);
  await wait(450);
  await click(page.getByRole('option', { name: new RegExp(name) }).first(), 500);
  if (portrait) { await scrollTo(page.locator('canvas.viewer-canvas')); await wait(900); }
}
await wait(1200);

// 6. Paint + style
mark('Paint, restyle, hide, reorder or nudge each item.');
if (portrait) await scrollTo(page.getByRole('tab', { name: /^Equipped/ }));
await click(page.getByRole('tab', { name: /^Equipped/ }), 400);
const capRow = page.locator('.equip', { hasText: 'Backwards Ballcap' });
await click(capRow.locator('button[aria-expanded]'), 500);
const paintSel = capRow.locator('select').filter({ has: page.locator('option', { hasText: 'Unpainted' }) });
await moveTo(paintSel);
await paintSel.selectOption({ label: 'Australium Gold' });
await wait(900);
if (portrait) { await scrollTo(page.locator('canvas.viewer-canvas')); await wait(1200); await scrollTo(capRow); }
const cardRow = page.locator('.equip', { hasText: 'Cool Cat Cardigan' });
await click(cardRow.locator('button[aria-expanded]'), 400);
const cardPaint = cardRow.locator('select').filter({ has: page.locator('option', { hasText: 'Unpainted' }) });
await moveTo(cardPaint);
await cardPaint.selectOption({ label: 'An Extraordinary Abundance of Tinge' });
await wait(1100);
if (portrait) { await scrollTo(page.locator('canvas.viewer-canvas')); await wait(1300); }

// 7. Team + pose
mark('Switch RED or BLU and choose a pose.');
if (portrait) await scrollTo(page.getByRole('tab', { name: 'Base model' }));
await click(page.getByRole('tab', { name: 'Base model' }), 300);
await click(page.getByRole('button', { name: 'BLU', exact: true }), 1100);
if (portrait) await scrollTo(page.getByRole('tab', { name: 'Appearance' }));
await click(page.getByRole('tab', { name: 'Appearance' }), 300);
const pose = page.getByLabel('Pose');
await moveTo(pose);
await pose.selectOption('presentation');
await wait(portrait ? 600 : 1400);
if (portrait) { await scrollTo(page.locator('canvas.viewer-canvas')); await wait(1500); }

// 8. Profile
mark('Describe the character: personality, voice, animation notes.');
if (portrait) await scrollTo(page.getByRole('tab', { name: 'Profile' }));
await click(page.getByRole('tab', { name: 'Profile' }), 300);
await type(page.getByLabel('Character name').last(), 'Kid Lightning', 70);
await type(page.getByLabel('Personality and behaviour'), 'Cocky, fast-talking, never stops moving.', 35);
await type(page.getByLabel('Voice and speaking style'), 'Rapid Boston accent, cracks jokes mid-fight.', 35);
await wait(600);

// 9. Save
mark('Save. Every save keeps a version in this browser.');
await click(page.getByRole('button', { name: 'Save', exact: true }), 400);
await page.getByText(/Saved version/).waitFor({ timeout: 15000 });
await wait(1500);

// 10. Exports
mark('Export a PNG render, a JSON manifest or a Markdown spec.');
await nav('Exports');
await wait(1600);
if (portrait) await scrollTo(page.getByRole('button', { name: /Export PNG/ }));
await click(page.getByRole('button', { name: /Export PNG/ }), 1600);
if (portrait) await scrollTo(page.getByRole('button', { name: 'Manifest JSON' }));
await click(page.getByRole('button', { name: 'Manifest JSON' }), 1000);
await moveTo(page.getByRole('button', { name: /Character bundle/ }));
await wait(900);

// 11. Backups
mark('Back up the whole library as one ZIP, and restore it anywhere.');
await nav('Backups');
await wait(900);
await click(page.getByRole('button', { name: 'Download ZIP backup' }), 400);
await page.getByText(/Backup downloaded/).waitFor({ timeout: 20000 });
await wait(1500);

// 12. Library
mark('Your library: search, favourite, duplicate, reopen any time.');
await nav('Characters');
await wait(800);
await moveTo(page.locator('.char-card').first(), { fy: 0.35 });
await wait(2400);
mark('END');
await wait(300);

await cdp.send('Page.stopScreencast');
await wait(300);
writeFileSync(join(out, 'timeline.json'), JSON.stringify({ mode, frames, markers, size: { w: viewport.width * scale, h: viewport.height * scale } }, null, 1));
console.log(`frames: ${frames.length}, duration: ${(frames.at(-1).t - frames[0].t).toFixed(1)}s`);
await browser.close();
