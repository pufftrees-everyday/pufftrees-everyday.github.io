/**
 * Cursed Realm — Missing Card Image Checker
 *
 * For every card in cards.json, works out the image slug the site actually
 * requests (same logic the pages use), then HEAD-checks it against the R2 image
 * bucket and reports which ones are missing (404). Use this after new cards land
 * in cards.json (e.g. new Dust-store sites) to see exactly which <slug>.png files
 * you still need to grab and upload to the bucket.
 *
 * r2.dev public URLs are heavily rate-limited by Cloudflare, so a fast scan of
 * ~1000 images trips the limit and later requests come back looking like 404s.
 * To avoid false "missing" reports, this runs two passes: a quick pre-filter,
 * then a slow, retrying re-verify (after a cooldown) of anything that didn't
 * clearly pass. Only images that calmly 404 twice are reported missing.
 *
 * Usage:
 *   node check-missing-images.js               # every card's displayed image
 *   node check-missing-images.js --all         # every printing/variant slug too
 *   node check-missing-images.js --filter court  # only cards whose name contains "court"
 *
 * The --filter form is best for small, instant checks (e.g. just new cards) —
 * few requests, no rate limit. Writes the confirmed list to missing-images.txt.
 */

const fs = require('fs');
const path = require('path');

const IMAGE_BASE = 'https://pub-5999238092ad418ca60e7a9ad641cf57.r2.dev/';
const CARDS_FILE = path.join(__dirname, 'cards.json');
const OUT_FILE = path.join(__dirname, 'missing-images.txt');
const ALL = process.argv.includes('--all');
const CONCURRENCY = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// One request → 'present' (2xx/3xx), 'absent' (real 404), or 'blocked'
// (403/429/5xx/network — inconclusive, almost always the r2.dev rate limit).
async function probe(slug) {
  const url = IMAGE_BASE + slug + '.png';
  try {
    let res = await fetch(url, { method: 'HEAD' });
    if (res.status === 405) res = await fetch(url, { headers: { Range: 'bytes=0-0' } }); // host disallows HEAD
    if (res.status >= 200 && res.status < 400) return 'present';
    if (res.status === 404) return 'absent';
    return 'blocked';
  } catch (e) { return 'blocked'; }
}

// Calm, retrying re-check for pass 2. r2.dev rate-limits aggressively and can
// even answer 404 while throttling, so we back off and re-confirm before ever
// calling something missing.
async function verify(slug) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await probe(slug);
    if (r === 'present') return 'present';
    if (r === 'absent') {
      await sleep(500);
      if (await probe(slug) === 'present') return 'present';
      return 'absent';           // 404 twice, calmly → genuinely not there
    }
    await sleep(1000 * (attempt + 1)); // 'blocked' → let the rate-limit window reset
  }
  return 'unknown';
}

async function main() {
  const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
  const fi = process.argv.indexOf('--filter');
  const filter = fi >= 0 ? (process.argv[fi + 1] || '').toLowerCase() : null;

  // Build the work list: { slug, name } — de-duped by slug.
  const bySlug = new Map();
  for (const c of cards) {
    if (filter && !(c.name || '').toLowerCase().includes(filter)) continue;
    const slugs = ALL ? allSlugs(c) : [displaySlug(c)];
    for (const slug of slugs) if (!bySlug.has(slug)) bySlug.set(slug, c.name);
  }
  const items = [...bySlug.entries()].map(([slug, name]) => ({ slug, name }));
  if (!items.length) { console.log('No cards matched.'); return; }
  console.log(`Pass 1: scanning ${items.length} image${ALL ? ' (all variants)' : ''}s against ${IMAGE_BASE} …`);

  // PASS 1 — fast pre-filter. Only 'present' is trusted; everything else is a
  // candidate to re-verify slowly (a rate-limited 404 is indistinguishable here).
  const status = new Array(items.length);
  let i = 0;
  async function w1() {
    while (i < items.length) { const k = i++; status[k] = await probe(items[k].slug); if ((i % 100) === 0) process.stdout.write(`  …${i}/${items.length}\r`); }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, w1));
  const candidates = items.filter((_, k) => status[k] !== 'present');
  console.log(`\nPass 1: ${items.length - candidates.length} present, ${candidates.length} to re-verify.`);
  if (!candidates.length) { console.log('\nAll images present — nothing to upload.'); fs.writeFileSync(OUT_FILE, ''); return; }

  // A long contiguous tail of failures is the rate-limit signature, not a gap.
  const firstBad = status.findIndex(s => s !== 'present');
  const tailAllBad = firstBad >= 0 && status.slice(firstBad).every(s => s !== 'present');
  if (tailAllBad && candidates.length > 30) {
    console.log(`(Those failed in one solid block from #${firstBad} — that's the r2.dev rate limit, not real 404s. Cooling down, then re-checking each slowly.)`);
    await sleep(30000); // let the rate-limit window reset before the careful pass
  }

  // PASS 2 — slow, sequential, retrying. This is the trustworthy result.
  const missing = [], unknown = [];
  for (let k = 0; k < candidates.length; k++) {
    const v = await verify(candidates[k].slug);
    if (v === 'absent') missing.push(candidates[k]);
    else if (v === 'unknown') unknown.push(candidates[k]);
    process.stdout.write(`  verifying ${k + 1}/${candidates.length}\r`);
    await sleep(250);
  }

  missing.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\n\nConfirmed missing: ${missing.length}`);
  const lines = missing.map(m => `${m.slug}.png   (${m.name})`);
  lines.forEach(l => console.log('  ' + l));
  if (unknown.length) console.log(`\n${unknown.length} still couldn't be confirmed (bucket kept throttling) — re-run to re-check just those.`);

  fs.writeFileSync(OUT_FILE, lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(`\nWrote the list to ${OUT_FILE}.${missing.length ? ' Grab these from the Drive folder and upload them to the R2 bucket.' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
