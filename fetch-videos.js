/**
 * Cursed Realm — Video Feed Fetcher
 *
 * Fetches the newest upload for each community channel from YouTube's public
 * RSS feed (server-side — no CORS, no API key, no proxy) and writes videos.json,
 * which videos.html reads same-origin. This replaces the old runtime CORS-proxy
 * "upgrade to latest" call, which failed silently and left the page stuck on a
 * stale hardcoded video.
 *
 * A channel whose feed fails keeps its previous entry, so a transient error
 * never blanks the section.
 *
 * Usage: node fetch-videos.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'videos.json');

// Mirror the channels in videos.html — channelId is the join key.
const CHANNELS = [
  { name: 'The Assorted Animals',    channelId: 'UCaO-qqRZVlaGvF5AE0EmbNg' },
  { name: "Winning On Death's Door", channelId: 'UCRXYlCNyqqEW7NiHBwiiSBw' },
  { name: 'SorceryTCG (Official)',   channelId: 'UCqmv-SKT0_SO5FbP3vGZ_uQ' },
];

const FEED = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

async function fetchText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CursedRealmVideoBot)' } });
      if (res.ok) return await res.text();
      console.warn(`  HTTP ${res.status} (try ${i}/${tries})`);
    } catch (e) {
      console.warn(`  fetch failed (try ${i}/${tries}): ${e.message}`);
    }
    if (i < tries) await sleep(1500 * i);
  }
  return null;
}

// Pull the newest upload (first <entry>) from a YouTube channel RSS feed.
function parseLatest(xml) {
  if (!xml) return null;
  const start = xml.indexOf('<entry>');
  if (start === -1) return null;
  const end = xml.indexOf('</entry>', start);
  const entry = xml.slice(start, end === -1 ? xml.length : end);
  const idM = entry.match(/<yt:videoId>([\w-]{6,})<\/yt:videoId>/);
  if (!idM) return null;
  const titleM = entry.match(/<title>([\s\S]*?)<\/title>/);
  const pubM = entry.match(/<published>([\s\S]*?)<\/published>/);
  return {
    latest: idM[1],
    title: titleM ? decodeEntities(titleM[1].trim()) : '',
    published: pubM ? pubM[1].trim() : '',
  };
}

async function main() {
  // Preserve prior entries so a transient feed failure never blanks a channel.
  let prev = {};
  try { prev = (JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')).channels) || {}; } catch (e) { /* first run */ }

  const channels = {};
  for (const ch of CHANNELS) {
    process.stdout.write(`Fetching ${ch.name}… `);
    const parsed = parseLatest(await fetchText(FEED(ch.channelId)));
    if (parsed) {
      channels[ch.channelId] = { name: ch.name, ...parsed };
      console.log(`✓ ${parsed.latest} — ${parsed.title}`);
    } else if (prev[ch.channelId]) {
      channels[ch.channelId] = prev[ch.channelId];
      console.log(`kept previous (${prev[ch.channelId].latest})`);
    } else {
      console.log('no data');
    }
    await sleep(500);
  }

  const out = { generated: new Date().toISOString(), channels };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${OUTPUT_FILE} (${Object.keys(channels).length} channels).`);
}

main().catch(e => { console.error(e); process.exit(1); });
