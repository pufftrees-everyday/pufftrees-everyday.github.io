/**
 * Cursed Realm — Missing Card Image Checker
 *
 * For every card in cards.json, works out the image slug the site actually
 * requests (same logic the pages use), then HEAD-checks it against the R2 image
 * bucket and reports which ones are missing (404). Use this after new cards land
 * in cards.json (e.g. new Dust-store sites) to see exactly which <slug>.png files
 * you still need to grab and upload to the bucket.
 *
 * Usage:
 *   node check-missing-images.js          # check each card's displayed image
 *   node check-missing-images.js --all    # check EVERY printing/variant slug too
 *
 * Writes the missing list to missing-images.txt as well as printing it.
 */

const fs = require('fs');
const path = require('path');

const IMAGE_BASE = 'https://pub-5999238092ad418ca60e7a9ad641cf57.r2.dev/';
const CARDS_FILE = path.join(__dirname, 'cards.json');
const OUT_FILE = path.join(__dirname, 'missing-images.txt');
const ALL = process.argv.includes('--all');
const CONCURRENCY = 8;

// Mirror the site's imgUrl(): prefer the Beta printing, then Alpha, then the
// first set; within a set prefer the Standard Booster variant. Fall back to a
// name-derived slug when a card has no variant slug at all.
function nameSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function displaySlug(c) {
  const sets = c.sets || [];
  const chosen = sets.find(s => /beta/i.test(s.name || ''))
    || sets.find(s => /alpha/i.test(s.name || ''))
    || sets[0];
  if (c.slug) return c.slug;
  if (chosen && chosen.variants && chosen.variants.length) {
    const v = chosen.variants.find(v => v.finish === 'Standard' && v.product === 'Booster') || chosen.variants[0];
    if (v && v.slug) return v.slug;
  }
  return nameSlug(c.name);
}
// Every distinct slug across all sets/variants (for --all).
function allSlugs(c) {
  const out = new Set();
  (c.sets || []).forEach(s => (s.variants || []).forEach(v => { if (v && v.slug) out.add(v.slug); }));
  if (!out.size) out.add(nameSlug(c.name));
  return [...out];
}

async function exists(slug) {
  const url = IMAGE_BASE + slug + '.png';
  try {
    let res = await fetch(url, { method: 'HEAD' });
    // Some hosts don't allow HEAD — fall back to a tiny ranged GET.
    if (res.status === 405) res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return res.status >= 200 && res.status < 400;
  } catch (e) {
    return null; // network error — unknown, report separately
  }
}

async function main() {
  const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

  // Build the work list: { slug, name } — de-duped by slug.
  const bySlug = new Map();
  for (const c of cards) {
    const slugs = ALL ? allSlugs(c) : [displaySlug(c)];
    for (const slug of slugs) if (!bySlug.has(slug)) bySlug.set(slug, c.name);
  }
  const items = [...bySlug.entries()].map(([slug, name]) => ({ slug, name }));
  console.log(`Checking ${items.length} image${ALL ? ' (all variants)' : ''}s against ${IMAGE_BASE} …\n`);

  const missing = [], errored = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      const ok = await exists(item.slug);
      if (ok === false) missing.push(item);
      else if (ok === null) errored.push(item);
      if ((i % 100) === 0) process.stdout.write(`  …${i}/${items.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  missing.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\nMissing images: ${missing.length}`);
  const lines = missing.map(m => `${m.slug}.png   (${m.name})`);
  lines.forEach(l => console.log('  ' + l));
  if (errored.length) console.log(`\n${errored.length} could not be checked (network errors).`);

  fs.writeFileSync(OUT_FILE, lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(`\nWrote the list to ${OUT_FILE}. Grab these files from the Drive folder and upload them to the R2 bucket.`);
}

main().catch(e => { console.error(e); process.exit(1); });
