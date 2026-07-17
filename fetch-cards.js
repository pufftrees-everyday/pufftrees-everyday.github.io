/**
 * Cursed Realm — Card Data Fetcher
 *
 * Pulls the full card list from Sorcery's public API and writes cards.json,
 * which every page on the site reads for card names, types, thresholds, rules
 * text, sets, and printing slugs. cards.json used to be a hand-refreshed
 * snapshot, so new releases (e.g. Dust-store sites) never appeared until someone
 * rebuilt it. This keeps it current automatically.
 *
 * Safety: refuses to overwrite cards.json if the API returns fewer cards than we
 * already have (guards against a broken/partial response blanking the site).
 *
 * Usage: node fetch-cards.js
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.sorcerytcg.com/api/cards';
const OUTPUT_FILE = path.join(__dirname, 'cards.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The site stores elements/subTypes as comma-joined strings; the API may hand
// them back as arrays. Normalise so cards.json keeps one consistent shape.
function toStr(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return v == null ? '' : String(v);
}

// Keep exactly the top-level shape the site expects (name, guardian, elements,
// subTypes, sets) — nested guardian/sets/variants are preserved as-is.
function normalize(c) {
  return {
    name: c.name,
    guardian: c.guardian || {},
    elements: toStr(c.elements),
    subTypes: toStr(c.subTypes),
    sets: Array.isArray(c.sets) ? c.sets : [],
  };
}

async function fetchJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CursedRealmCardBot)' } });
      if (res.ok) return await res.json();
      console.warn(`  HTTP ${res.status} (try ${i}/${tries})`);
    } catch (e) {
      console.warn(`  fetch failed (try ${i}/${tries}): ${e.message}`);
    }
    if (i < tries) await sleep(2000 * i);
  }
  return null;
}

async function main() {
  // Existing cards (for the safety floor + an added/removed summary).
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch (e) { /* first run */ }
  const existingNames = new Set(existing.map(c => c.name));

  console.log(`Fetching ${API_URL} …`);
  const data = await fetchJson(API_URL);
  if (!Array.isArray(data)) {
    console.error('API did not return a card array — aborting without touching cards.json.');
    process.exit(1);
  }

  const cards = data
    .filter(c => c && c.name && c.guardian)
    .map(normalize)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Safety floor: never clobber a healthy file with a short/broken response.
  const floor = Math.max(1000, existing.length - 30);
  if (cards.length < floor) {
    console.error(`Only ${cards.length} cards returned (have ${existing.length}, floor ${floor}) — aborting.`);
    process.exit(1);
  }

  const newNames = new Set(cards.map(c => c.name));
  const added = cards.map(c => c.name).filter(n => !existingNames.has(n));
  const removed = [...existingNames].filter(n => !newNames.has(n));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cards));

  console.log(`Wrote ${OUTPUT_FILE}: ${cards.length} cards (was ${existing.length}).`);
  if (added.length)   console.log(`Added (${added.length}): ${added.join(', ')}`);
  if (removed.length) console.log(`Removed (${removed.length}): ${removed.join(', ')}`);
  if (!added.length && !removed.length) console.log('No card additions or removals.');
}

main().catch(e => { console.error(e); process.exit(1); });
