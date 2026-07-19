// ─────────────────────────────────────────────────────────────
// Cursed Realm — shared site navigation (header + mobile menu)
// One source of truth for the top nav that used to be copy-pasted into every
// page. Include it near the top of <body>:
//
//   <script>window.CRNav = { active: 'vault' };</script>
//   <div id="cr-nav-mount"></div>
//   <script src="site-nav.js?v=3"></script>
//
// Config (window.CRNav):
//   active : which item is the current page — one of
//            vault | workshop | archive | newdeck | videos | artists | tokens |
//            tracker | rulebook | cardfaq | eventguide | about
//            (omit / 'home' = none)
//   guard  : true on the deckbuilder — the "My Workshop" / "New Deck" buttons
//            call navGuard(url) (unsaved-changes prompt) instead of navigating
//            directly.
//
// The script must be a normal (synchronous) <script> so the header is injected
// while parsing is blocked — no flash, no layout shift. It reuses each page's
// existing header/nav CSS (classes are unchanged), and marks the active item
// with an inline colour so the highlight works regardless of whether a given
// page defines the .active rules. The auth bar (#auth-bar / #mobile-auth) is
// still populated by each page's own cr-auth init, exactly as before.
// ─────────────────────────────────────────────────────────────
(function () {
  var cfg = window.CRNav || {};
  var active = cfg.active || '';
  var guard = !!cfg.guard;
  var noAuth = cfg.auth === false; // videos.html has no cr-auth / auth bar

  // Primary items live directly in the header bar.
  var PRIMARY = [
    { key: 'vault',    label: 'My Vault',     href: 'collection.html', kind: 'link' },
    { key: 'workshop', label: 'My Workshop',  href: 'decks.html',      kind: 'ghost' },
    { key: 'archive',  label: 'The Archive',  href: 'archive.html',    kind: 'link' },
    { key: 'newdeck',  label: 'New Deck',     href: 'deckbuilder.html', kind: 'primary' },
  ];
  // Secondary items live under the "More ▾" dropdown (desktop) / lower list (mobile).
  var MORE = [
    { key: 'videos',     label: 'Videos',          href: 'videos.html' },
    { key: 'artists',    label: 'Artists',         href: 'artists.html' },
    { key: 'tokens',     label: 'Tokens',          href: 'tokens.html' },
    { key: 'tracker',    label: 'Life Tracker',    href: 'tracker.html' },
    { key: 'rulebook',   label: 'Rulebook',        href: 'rulebook.html' },
    { key: 'cardfaq',    label: 'Card FAQ',        href: 'card-faq.html' },
    { key: 'eventguide', label: 'Event Guide',     href: 'event-guide.html' },
    { key: 'about',      label: 'About',           href: 'about.html' },
    { key: 'play',       label: 'Play Network',    href: 'https://play.sorcerytcg.com/', ext: true },
    { key: 'sorcery',    label: 'Sorcery TCG',     href: 'https://sorcerytcg.com/', ext: true },
    { key: 'discord',    label: 'Join our Discord', href: 'https://discord.gg/6xjEQtsDu', ext: true, discord: true },
  ];

  // Active highlight, applied inline so it never depends on a page's CSS:
  //   header links → arcane, dropdown items → gold, mobile links → arcane.
  function actLink(key)  { return key === active ? ' active" style="color:var(--arcane)' : ''; }
  function actMore(key)  { return key === active ? ' active" style="color:var(--gold)'   : ''; }
  function aria(key)     { return key === active ? ' aria-current="page"' : ''; }
  function navTo(href)   { return guard ? "navGuard('" + href + "')" : "window.location.href='" + href + "'"; }

  function primaryDesktop(it) {
    if (it.kind === 'link') {
      return '<a href="' + it.href + '" class="header-link nav-collapsible' + actLink(it.key) + '"' + aria(it.key) + '>' + it.label + '</a>';
    }
    var cls = it.kind === 'primary' ? 'btn btn-primary' : 'btn btn-ghost';
    return '<button class="' + cls + ' nav-collapsible" onclick="' + navTo(it.href) + '">' + it.label + '</button>';
  }
  function moreDesktop(it) {
    var ext = it.ext ? ' target="_blank" rel="noopener"' : '';
    var extra = it.discord ? ' more-discord' : '';
    return '<a href="' + it.href + '" class="more-item' + extra + actMore(it.key) + '"' + ext + aria(it.key) + '>' + it.label + '</a>';
  }
  function mobileItem(it) {
    var ext = it.ext ? ' target="_blank"' + (it.discord ? ' rel="noopener"' : '') : '';
    var extra = it.discord ? ' mobile-discord' : '';
    return '<a href="' + it.href + '" class="header-link' + extra + actLink(it.key) + '"' + ext + aria(it.key) + '>' + it.label + '</a>';
  }

  var headerHTML =
    '<header>' +
    '<div class="header-main" style="display:flex;align-items:center;gap:16px;">' +
    '<div class="logo"><a href="index.html" style="color:var(--gold);text-decoration:none;font-family:\'Cinzel Decorative\',serif;font-weight:700;letter-spacing:0.04em;display:flex;align-items:center;gap:9px;"><img src="icon-192.png" alt="" style="width:30px;height:30px;border-radius:6px;display:block;">Cursed Realm</a></div>' +
    PRIMARY.map(primaryDesktop).join('') +
    '<div class="more-menu">' +
    '<button class="more-trigger header-link nav-collapsible" onclick="toggleMoreMenu(event)">More <span style="font-size:0.6rem;">&#9662;</span></button>' +
    '<div class="more-dropdown" id="more-dropdown">' + MORE.map(moreDesktop).join('') + '</div>' +
    '</div>' +
    '</div>' +
    (noAuth ? '' : '<div class="header-nav nav-collapsible" id="auth-bar"></div>') +
    '<button class="hamburger" onclick="toggleMobileNav()" aria-label="Menu">&#9776;</button>' +
    '</header>';

  var mobileHTML =
    '<div class="mobile-nav" id="mobile-nav">' +
    (noAuth ? '' : '<div class="mobile-auth" id="mobile-auth"></div><div class="mobile-nav-divider"></div>') +
    PRIMARY.map(mobileItem).join('') +
    '<div class="mobile-nav-divider"></div>' +
    MORE.map(mobileItem).join('') +
    '</div>';

  // Inject where the mount sits (falls back to the running script tag), then
  // drop the mount so the final DOM is `body > header` + `body > .mobile-nav`,
  // identical to the old hand-written markup.
  var mount = document.getElementById('cr-nav-mount') || document.currentScript;
  if (mount && mount.parentNode) {
    mount.insertAdjacentHTML('beforebegin', headerHTML + mobileHTML);
    if (mount.id === 'cr-nav-mount') mount.parentNode.removeChild(mount);
  }

  // ── Nav helpers (were duplicated inline on every page) ──
  window.toggleMobileNav = function () {
    var m = document.getElementById('mobile-nav');
    if (m) m.classList.toggle('open');
  };
  window.toggleMoreMenu = function (e) {
    if (e) e.stopPropagation();
    var d = document.getElementById('more-dropdown'); if (!d) return;
    var open = d.classList.toggle('open');
    if (open) { setTimeout(function () { document.addEventListener('click', moreMenuOutside); }, 0); }
    else { document.removeEventListener('click', moreMenuOutside); }
  };
  window.moreMenuOutside = function (e) {
    var d = document.getElementById('more-dropdown');
    if (d && !d.classList.contains('open')) return;
    if (d && !e.target.closest('.more-menu')) { d.classList.remove('open'); document.removeEventListener('click', moreMenuOutside); }
  };
})();
