/**
 * Cursed Realm — Card FAQ fetcher
 *
 * Pulls the official per-card FAQs from Curiosa and writes faqs.json.
 *
 * Curiosa's /faqs page is a Next.js page that ships the whole FAQ dataset as
 * JSON inside its __NEXT_DATA__ script tag, so one request gets everything —
 * no scraping of rendered markup. The questions/answers are Sanity Portable
 * Text (rich blocks), which we flatten to a small, safe subset of HTML here so
 * the browser never has to know about Portable Text.
 *
 * Usage:
 *   node fetch-faqs.js
 *
 * Commit the generated faqs.json alongside cards.json.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://curiosa.io/faqs';
const OUTPUT_FILE = path.join(__dirname, 'faqs.json');
const CARDS_FILE = path.join(__dirname, 'cards.json');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Answers cross-reference other cards as [[Card Name]]. Link the ones that have
// their own FAQs; the rest just get highlighted, since there'd be nothing to
// link them to.
function linkCardRefs(html, faqCards) {
  return html.replace(/\[\[([^\]]+)\]\]/g, (m, raw) => {
    const name = raw.trim();
    const label = esc(name);
    return faqCards.has(name)
      ? `<a class="fq-ref" href="card-faq.html?card=${encodeURIComponent(name)}">${label}</a>`
      : `<span class="fq-ref">${label}</span>`;
  });
}

function spanToHtml(child) {
  let html = esc(child.text || '');
  const marks = child.marks || [];
  if (marks.includes('em')) html = `<em>${html}</em>`;
  if (marks.includes('strong')) html = `<strong>${html}</strong>`;
  return html;
}

// A damageGrid is a little board diagram (rows of cells), used by a couple of
// cards to show which squares an ability hits.
function gridToHtml(block) {
  const rows = (block.grid && block.grid.rows) || [];
  if (!rows.length) return '';
  const body = rows.map(r =>
    '<tr>' + (r.cells || []).map(c => `<td>${esc(c)}</td>`).join('') + '</tr>'
  ).join('');
  return `<table class="fq-grid"><tbody>${body}</tbody></table>`;
}

// Portable Text → HTML. The dataset only ever uses: normal blocks, bullet list
// items at levels 1–2, em/strong marks, and damageGrid. No markDefs, no other
// styles — verified against all 739 entries. Anything unexpected is skipped
// rather than rendered raw.
function toHtml(blocks, faqCards) {
  const out = [];
  let depth = 0;              // how many <ul> are currently open
  const liOpen = [];          // liOpen[d] — is the <li> at depth d still unclosed?

  // A deeper list nests *inside* the enclosing <li>, so an open <li> is only
  // closed once its child list has been closed.
  const closeTo = target => {
    while (depth > target) {
      if (liOpen[depth]) { out.push('</li>'); liOpen[depth] = false; }
      out.push('</ul>');
      depth--;
      if (liOpen[depth]) { out.push('</li>'); liOpen[depth] = false; }
    }
  };

  for (const block of blocks || []) {
    if (block._type === 'damageGrid') {
      closeTo(0);
      out.push(gridToHtml(block));
      continue;
    }
    if (block._type !== 'block') continue;

    const inner = linkCardRefs((block.children || []).map(spanToHtml).join(''), faqCards);
    if (!inner.trim()) continue;

    if (block.listItem === 'bullet') {
      const level = block.level || 1;
      while (depth < level) { out.push('<ul>'); depth++; liOpen[depth] = false; }
      closeTo(level);
      if (liOpen[depth]) out.push('</li>');
      out.push(`<li>${inner}`);
      liOpen[depth] = true;
    } else {
      closeTo(0);
      out.push(`<p>${inner}</p>`);
    }
  }
  closeTo(0);
  return out.join('');
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    console.error(`Failed to fetch FAQs: HTTP ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    console.error('Could not find __NEXT_DATA__ on the page — Curiosa may have changed its build.');
    process.exit(1);
  }

  let faqs;
  try {
    faqs = JSON.parse(match[1]).props.pageProps.faqs;
  } catch (e) {
    console.error('Could not read faqs out of __NEXT_DATA__: ' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(faqs) || !faqs.length) {
    console.error('__NEXT_DATA__ had no faqs array — aborting rather than writing an empty file.');
    process.exit(1);
  }
  console.log(`Found ${faqs.length} FAQ entries.`);

  // Every card that has at least one FAQ — needed before rendering so [[refs]]
  // know which names are linkable.
  const faqCards = new Set();
  faqs.forEach(f => (f.cardNames || []).forEach(n => faqCards.add(n)));

  // An entry tagged to several cards is listed under each of them.
  const byCard = {};
  for (const f of faqs) {
    const q = toHtml(f.question, faqCards);
    const a = toHtml(f.answer, faqCards);
    if (!q && !a) continue;
    for (const name of f.cardNames || []) {
      (byCard[name] = byCard[name] || []).push({ q, a });
    }
  }

  const cards = {};
  for (const name of Object.keys(byCard).sort((a, b) => a.localeCompare(b))) {
    cards[name] = byCard[name];
  }

  // Sanity check against our own card list — a spike in unknown names means
  // Curiosa renamed something and our popup links would silently miss.
  let unknown = [];
  try {
    const known = new Set(JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8')).map(c => c.name));
    unknown = Object.keys(cards).filter(n => !known.has(n));
  } catch (e) { /* cards.json missing → skip the check */ }

  const out = {
    updated: new Date().toISOString(),
    source: SOURCE_URL,
    entries: faqs.length,
    cards,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 1));

  console.log(`Cards with FAQs: ${Object.keys(cards).length}`);
  if (unknown.length) console.log(`Not in cards.json (${unknown.length}): ${unknown.join(', ')}`);
  console.log(`Wrote ${OUTPUT_FILE} (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
