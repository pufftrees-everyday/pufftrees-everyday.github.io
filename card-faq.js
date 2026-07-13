// ─────────────────────────────────────────────────────────────
// Cursed Realm — shared "this card has rulings" link for card popups
// Used by every page with a card modal (index, collection, deckbuilder, deck,
// artist, tokens) and by the avatar card page.
//
// Usage:  CRCardFAQ.mount(cardName, targetElOrId)
//   Shows a link through to card-faq.html?card=<name> when that card has FAQ
//   entries, and hides the target element when it doesn't — most cards have no
//   rulings, so the link must not leave an empty gap behind.
//
// faqs.json is fetched once and shared by every popup on the page. Stale loads
// are ignored, so opening card B while card A is still loading can't leave B's
// popup showing A's link. Unlike .pc-* (price chart), the styles here are
// injected by the script, so a page only needs the <script> tag and the call.
// ─────────────────────────────────────────────────────────────
(function () {
  const CSS = `
    .cfq-link { display: flex; align-items: center; justify-content: space-between; gap: 10px;
      margin-top: 14px; padding: 10px 12px;
      background: rgba(200,169,110,0.07); border: 1px solid rgba(200,169,110,0.3); border-radius: 8px;
      color: var(--gold); text-decoration: none; transition: background .16s ease, border-color .16s ease; }
    .cfq-link:hover { background: rgba(200,169,110,0.14); border-color: var(--gold); color: var(--gold); }
    .cfq-link .cfq-label { font-family: 'Cinzel', serif; font-size: 0.76rem; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase; }
    .cfq-link .cfq-count { font-size: 0.82rem; color: var(--shimmer); font-style: italic; }
    .cfq-link .cfq-arrow { color: var(--gold); font-size: 0.9rem; }
  `;

  let styled = false;
  function injectCSS() {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  let faqPromise = null;
  function loadFAQ() {
    if (!faqPromise) {
      faqPromise = fetch('faqs.json?v=1')
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null); // offline / missing file → no link, no error
    }
    return faqPromise;
  }

  let token = 0; // guards against an older mount finishing after a newer one

  async function mount(cardName, target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    injectCSS();

    const mine = ++token;
    el.style.display = 'none';
    el.innerHTML = '';

    const data = await loadFAQ();
    if (mine !== token) return; // a newer popup opened; this result is stale

    const entries = data && data.cards && data.cards[cardName];
    if (!entries || !entries.length) return; // most cards have no rulings

    el.innerHTML =
      '<a class="cfq-link" href="card-faq.html?card=' + encodeURIComponent(cardName) + '">' +
        '<span class="cfq-label">Card FAQ</span>' +
        '<span class="cfq-count">' + entries.length + (entries.length === 1 ? ' ruling' : ' rulings') + '</span>' +
        '<span class="cfq-arrow">→</span>' +
      '</a>';
    el.style.display = '';
  }

  window.CRCardFAQ = { mount };
})();
