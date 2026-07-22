#!/usr/bin/env node
/**
 * generate-sitemap.js — build sitemap.xml from the static page list + cards.json
 *
 * Dev/CI only; never shipped to the browser. Run it after adding a page or
 * after fetch-cards.js pulls in a new set:
 *
 *     node generate-sitemap.js
 *
 * Why this exists: artist.html and avatar.html are real, distinct pages behind
 * a query string (?a=<name>). Crawlers only find a query-string URL if
 * something links to it, and the artist index is itself several clicks deep, so
 * most of those pages were invisible to search. Listing them explicitly is the
 * cheapest way to get ~87 genuinely unique pages indexed.
 *
 * Deliberately EXCLUDED:
 *   - noindex pages (gallery, reset-password, testdeck, testdraw)
 *   - personal pages that render empty for a logged-out crawler
 *     (collection, decks, profile) — thin content dilutes the rest
 *   - deck.html?d=<code> — user content, and public decks change constantly;
 *     the Archive links them, which is enough for discovery
 */

const fs = require('fs');

const ORIGIN = 'https://cursedrealm.org';

// Static pages worth indexing, with a rough priority. lastmod comes from the
// file's own mtime so a page that hasn't changed doesn't claim it has.
const PAGES = [
  ['index.html',       '1.0', 'daily'],
  ['archive.html',     '0.9', 'daily'],
  ['deckbuilder.html', '0.9', 'weekly'],
  ['card-faq.html',    '0.8', 'weekly'],
  ['rulebook.html',    '0.8', 'monthly'],
  ['event-guide.html', '0.7', 'monthly'],
  ['tokens.html',      '0.7', 'monthly'],
  ['artists.html',     '0.7', 'monthly'],
  ['videos.html',      '0.6', 'daily'],
  ['tracker.html',     '0.6', 'monthly'],
  ['about.html',       '0.5', 'yearly'],
];

function iso(file) {
  try { return fs.statSync(file).mtime.toISOString().slice(0, 10); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function url(loc, lastmod, changefreq, priority) {
  return `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const cards = JSON.parse(fs.readFileSync('cards.json', 'utf8'));
const cardsMod = iso('cards.json');

// Every artist credited on any printing, and every Avatar card.
const artists = new Set();
const avatars = new Set();
for (const c of cards) {
  for (const set of c.sets || []) {
    for (const v of set.variants || []) {
      if (v.artist) artists.add(v.artist.trim());
    }
  }
  if (c.guardian && c.guardian.type === 'Avatar') avatars.add(c.name);
}

const entries = [];
for (const [page, priority, freq] of PAGES) {
  const loc = page === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${page}`;
  entries.push(url(loc, iso(page), freq, priority));
}
for (const a of [...artists].sort()) {
  entries.push(url(`${ORIGIN}/artist.html?a=${encodeURIComponent(a)}`, cardsMod, 'monthly', '0.6'));
}
for (const a of [...avatars].sort()) {
  entries.push(url(`${ORIGIN}/avatar.html?a=${encodeURIComponent(a)}`, cardsMod, 'monthly', '0.6'));
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

fs.writeFileSync('sitemap.xml', xml);
console.log(`sitemap.xml — ${entries.length} URLs (${PAGES.length} pages, ${artists.size} artists, ${avatars.size} avatars)`);
