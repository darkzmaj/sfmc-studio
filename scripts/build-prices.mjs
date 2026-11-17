#!/usr/bin/env node
// Snapshot of lowest Steam Community Market prices (USD) for Unique-quality TF2 cosmetics and paints.
// Throttled; keeps previous prices for anything that could not be fetched this run.
// Usage: node scripts/build-prices.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/catalog/prices.json';
const UA = 'sfmc-studio-price-snapshot (+https://github.com/darkzmaj/sfmc-studio)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { items: {}, paints: {} };

async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    const wait = res.status === 429 ? 60000 * (i + 1) : 5000;
    console.warn(`HTTP ${res.status}, waiting ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`Failed: ${url}`);
}

const items = { ...prev.items };
const paints = { ...prev.paints };
function save() {
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(), currency: 'USD', quality: 'Unique',
    source: 'Steam Community Market lowest listing (search/render and priceoverview), snapshot',
    note: 'Estimates only. Prices change constantly and do not cover other qualities (Strange, Unusual, Vintage, Genuine).',
    counts: { items: Object.keys(items).length, paints: Object.keys(paints).length },
    items, paints,
  }));
}
const base = 'https://steamcommunity.com/market/search/render/?query=&search_descriptions=0&sort_column=name&sort_dir=asc&appid=440&norender=1&category_440_Quality%5B%5D=tag_Unique&category_440_Type%5B%5D=tag_misc';
let start = 0, total = Infinity, fetched = 0;
try {
  while (!process.argv.includes('--paints-only') && start < total) {
    const j = await get(`${base}&start=${start}&count=100`);
    total = j.total_count;
    if (!j.results?.length) break;
    for (const r of j.results) items[r.hash_name] = { p: r.sell_price, n: r.sell_listings };
    fetched += j.results.length;
    start += j.results.length;
    console.log(`${fetched}/${total}`);
    save();
    await sleep(3500);
  }
} catch (e) { console.warn(`\nStopped early: ${e.message}`); }
console.log();

for (const p of JSON.parse(readFileSync('public/catalog/paints.json', 'utf8'))) {
  try {
    // search/render is far less throttled than priceoverview; match the exact paint can name.
    const j = await get(`https://steamcommunity.com/market/search/render/?query=${encodeURIComponent(p.name)}&appid=440&norender=1&count=10`);
    const hit = (j.results ?? []).find((r) => r.hash_name === p.name);
    if (hit) paints[p.id] = { p: hit.sell_price, name: p.name };
    save();
  } catch (e) { console.warn(`${p.name}: ${e.message}`); }
  await sleep(3500);
}

save();
console.log(`prices: ${Object.keys(items).length} items, ${Object.keys(paints).length} paints -> ${OUT}`);
