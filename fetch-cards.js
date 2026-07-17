/**
 * Cursed Realm — New Card Fetcher (ADD-ONLY)
 *
 * Pulls the card list from Sorcery's public API and APPENDS any cards whose
 * names we don't already have to cards.json. It NEVER modifies or removes
 * existing cards.
 *
 * Why add-only: Sorcery's API migrated its image-slug scheme (e.g. bet-… → 002-…,
 * got-… → 006-…) for every card. cards.json's slugs are matched 1:1 to the card
 * art in the R2 bucket, which still uses the old names — so a full re-sync would
 * silently repoint every image to a filename that doesn't exist and break all
 * card art on the site. Add-only sidesteps that entirely: existing cards (and
 * their working image slugs) are left exactly as they are.
 *
 * New cards come in with the API's current slug scheme, so after running this you
 * still need to upload each new card's art to the R2 bucket under the slug shown
 * in the "Added" list (see check-missing-images.js).
 *
 * Usage: node fetch-cards.js   (then review the Added list before committing)
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.sorcerytcg.com/api/cards';
const CARDS_FILE = path.join(__dirname, 'cards.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toStr(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return v == null ? '' : String(v);
}
function normalize(c) {
  return {
    name: c.name,
    guardian: c.guardian || {},
    elements: toStr(c.elements),
    subTypes: toStr(c.subTypes),
    sets: Array.isArray(c.sets) ? c.sets : [],
  };
}
function displaySlug(c) {
  const sets = c.sets || [];
  const chosen = sets.find(s => /beta/i.test(s.name || '')) || sets.find(s => /alpha/i.test(s.name || '')) || sets[0];
  if (chosen && chosen.variants && chosen.variants.length) {
    const v = chosen.variants.find(v => v.finish === 'Standard' && v.product === 'Booster') || chosen.variants[0];
    if (v && v.slug) return v.slug;
  }
  return String(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
  const existing = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
  const haveNames = new Set(existing.map(c => c.name));

  console.log(`Fetching ${API_URL} …`);
  const data = await fetchJson(API_URL);
  if (!Array.isArray(data)) {
    console.error('API did not return a card array — aborting without touching cards.json.');
    process.exit(1);
  }

  const additions = data
    .filter(c => c && c.name && c.guardian && !haveNames.has(c.name))
    .map(normalize);

  if (!additions.length) {
    console.log('No new cards — cards.json unchanged.');
    return;
  }

  // Append only; every existing card (and its image slug) is left untouched.
  const out = existing.concat(additions);
  fs.writeFileSync(CARDS_FILE, JSON.stringify(out));

  console.log(`Appended ${additions.length} new card(s) -> ${out.length} total.`);
  console.log('Upload art for these to the R2 bucket under the slug shown:');
  for (const c of additions) console.log(`  ${displaySlug(c)}.png   (${c.name})`);
  console.log('\nReview the diff, then commit cards.json.');
}

main().catch(e => { console.error(e); process.exit(1); });
