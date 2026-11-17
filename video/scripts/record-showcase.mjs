// Records the narrated showcase: one desktop session (1920x1080 CSS at 2x pixels = 3840x2160 frames),
// segmented by narration line id. The editor crops 16:9 and 9:16 cuts from the same footage.
// Usage: node video/scripts/record-showcase.mjs [baseUrl]   (app must serve the hosted asset pack at /tf2/)
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173';
const DSF = Number(process.env.DSF ?? 2);
const out = join('video', 'raw', 'showcase');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'frames'), { recursive: true });
const viewport = { width: 1920, height: 1080 };
const ITEMS = JSON.parse(process.env.ITEMS ?? '["Breach and Bomb","Lone Survivor","General\'s Greatcoat"]');
const PAINT = process.env.PAINT ?? 'Australium Gold';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force-color-profile=srgb', `--force-device-scale-factor=${DSF}`] });
const ctx = await browser.newContext({ viewport, deviceScaleFactor: DSF, acceptDownloads: true });
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.6L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))', transition: 'transform 16ms linear' });
    document.body.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '.__ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ef7d40;pointer-events:none;z-index:2147483646;animation:__r .45s ease-out forwards}@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}';
    document.head.appendChild(st);
    addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 500); }, true);
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
const segments = [];
const seg = (id) => { segments.push({ id, t: Date.now() / 1000 }); console.log('·', id); };
const focuses = [];
/** Record where the action is (CSS px rect) so the 9:16 cut and punch-ins can frame it. */
async function focus(selector, zoom = 1) {
  const b = await page.locator(selector).first().boundingBox().catch(() => null);
  if (b) focuses.push({ t: Date.now() / 1000, x: b.x, y: b.y, w: b.width, h: b.height, zoom });
}
const wait = (ms) => page.waitForTimeout(ms);
let mouse = { x: 960, y: 540 };
async function moveTo(target, opts = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const x = b.x + b.width * (opts.fx ?? 0.5), y = b.y + b.height * (opts.fy ?? 0.5);
  await page.mouse.move(x, y, { steps: Math.max(10, Math.min(30, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 25))) });
  mouse = { x, y };
}
async function click(target, pause = 250) { await moveTo(target); await wait(90); await page.mouse.down(); await page.mouse.up(); await wait(pause); }
async function type(target, text, delay = 38) { await click(target, 80); await page.keyboard.press('Control+A'); await page.keyboard.type(text, { delay }); }
async function orbit(dx, dy, steps = 50) {
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(mouse.x + (dx * i) / steps, mouse.y + (dy * i) / steps); await wait(14); }
  mouse = { x: mouse.x + dx, y: mouse.y + dy };
  await page.mouse.up();
}
const navLink = (name) => page.getByRole('link', { name, exact: true }).first();
const viewer = () => page.locator('canvas.viewer-canvas').first();

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
await page.getByText('Models ready (hosted)').waitFor({ timeout: 30000 });
await wait(600);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: viewport.width * DSF, maxHeight: viewport.height * DSF, everyNthFrame: 1 });
await wait(300);

seg('intro');
await focus('main h1');
await moveTo('h1', { fx: 0.4 });
await wait(900);
await click(page.getByRole('link', { name: 'Try a loadout' }).first(), 600);
await viewer().waitFor();
await focus('.tryout-view');
await wait(1200);

seg('classes');
await focus('.tryout-view');
for (const c of ['Heavy', 'Spy', 'Pyro', 'Soldier']) { await click(page.getByRole('radio', { name: c }), c === 'Soldier' ? 1500 : 850); }

seg('search');
await focus('.tryout-list');
const search = page.getByLabel('Search cosmetics');
await type(search, ITEMS[0].slice(0, 12));
await wait(350);
await click(page.getByRole('option', { name: new RegExp(ITEMS[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first(), 900);
await type(search, ITEMS[1].slice(0, 14));
await wait(350);
await click(page.getByRole('option', { name: new RegExp(ITEMS[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first(), 900);

seg('prices');
await focus('.tryout-list', 1.25);
await type(search, ITEMS[2].slice(0, 12));
await wait(350);
const opt = page.getByRole('option', { name: new RegExp(ITEMS[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
await moveTo(opt.locator('.price-tag').first().or(opt));
await wait(500);
await click(opt, 1200);

seg('paint');
await focus('.tryout-view');
const paintSel = page.locator('.tryout-cart select').first();
await moveTo(paintSel);
await paintSel.selectOption({ label: await paintSel.locator('option', { hasText: PAINT }).first().innerText() });
await wait(700);
await click(page.getByRole('button', { name: 'BLU', exact: true }), 700);
await moveTo(viewer(), { fx: 0.45, fy: 0.5 });
await orbit(560, 0, 70);
await wait(200);

seg('total');
await focus('.tryout-cart', 1.35);
await moveTo(page.locator('.cart-total'));
await wait(2600);

seg('hook');
await focus('.tryout-view', 1.15);
await moveTo(viewer(), { fx: 0.4, fy: 0.55 });
await orbit(-420, 20, 55);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -140); await wait(70); }
await wait(500);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 140); await wait(70); }
await wait(400);

seg('editor');
await click(page.getByRole('button', { name: 'Open in editor' }), 1200);
await click(page.getByRole('tab', { name: 'Profile' }), 300);
await focus('.editor-right');
await type(page.getByLabel('Character name').last(), 'Sergeant Goldtop', 40);
await type(page.getByLabel('Personality and behaviour'), 'Loud, proud, and completely sure he outranks everyone.', 22);
await click(page.getByRole('button', { name: 'Save', exact: true }), 400);
await page.getByText(/Saved version/).waitFor({ timeout: 15000 });
await wait(700);

seg('export');
await click(navLink('Exports'), 900);
await focus('.exports-layout');
await click(page.getByRole('button', { name: /Export PNG/ }), 900);
await click(page.getByRole('button', { name: 'Manifest JSON' }), 600);
await click(navLink('Backups'), 700);
await click(page.getByRole('button', { name: 'Download ZIP backup' }), 300);
await page.getByText(/Backup downloaded/).waitFor({ timeout: 20000 });
await wait(800);

seg('library');
await click(navLink('Characters'), 900);
await focus('.char-card', 1.2);
await moveTo(page.locator('.char-card').first(), { fy: 0.35 });
await wait(1500);
await click(page.getByRole('link', { name: /Edit Sergeant Goldtop/ }), 1500);
await moveTo(viewer(), { fx: 0.5, fy: 0.5 });
await orbit(380, 0, 50);

seg('privacy');
await click(navLink('Privacy'), 300);
await focus('.prose');
await wait(1500);
await page.mouse.wheel(0, 300);
await wait(1500);

seg('END');
await cdp.send('Page.stopScreencast');
await wait(300);
writeFileSync(join(out, 'timeline.json'), JSON.stringify({ frames, segments, focuses, size: { w: viewport.width * DSF, h: viewport.height * DSF }, css: viewport }, null, 1));
const fps = frames.length / (frames.at(-1).t - frames[0].t);
console.log(`frames: ${frames.length}, duration: ${(frames.at(-1).t - frames[0].t).toFixed(1)}s, fps ${fps.toFixed(1)}`);
await browser.close();
