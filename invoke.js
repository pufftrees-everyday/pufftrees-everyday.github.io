// ─────────────────────────────────────────────────────────────
// Cursed Realm — "Invoke" advanced-search query engine (shared)
// Used by the index Explorer, the deckbuilder left explorer, and the
// collection Vault card search. Exposes window.Invoke.
//
// Query syntax (all terms AND together unless you use OR):
//   e:water            element is water        (aliases: element:, color:)
//   e:water,fire       water OR fire
//   t:minion           type is Minion          (type:)
//   sub:beast          subtype contains beast  (subtype:)
//   o:banish           rules text contains "banish"  (text:, oracle:, rules:)
//   c>=2  c<4          cost                    (cost:, cmc:, mv:)
//   pow>=4  def<=2     power/attack, defence   (atk:, power:; defense:, tou:)
//   life=1             life
//   water>=1 fire=2    thresholds (also earth, air; or wt/ft/et/at)
//   r:unique           rarity                  (rarity:)
//   s:beta             set name                (set:)
//   a:"hiekkala"       artist                  (artist:, art:, illus:)
//   -t:site            NOT a site
//   e:water OR e:fire  either
//   banish             a BARE word searches the card's name, rules text,
//                      subtypes and type (quote for an exact phrase: "sea serpent")
//
// Works on the normalized card shape shared by all three pages:
//   { name, type, rarity, cost, attack, defence, life, thresholds:{water,fire,earth,air},
//     rules_text, element, subTypes, set, artist? }
// ─────────────────────────────────────────────────────────────
(function () {
  // Field aliases → canonical
  const FIELDS = {
    e: 'element', element: 'element', color: 'element',
    t: 'type', type: 'type',
    sub: 'subtype', subtype: 'subtype',
    c: 'cost', cost: 'cost', cmc: 'cost', mv: 'cost',
    pow: 'attack', power: 'attack', atk: 'attack', attack: 'attack',
    def: 'defence', defence: 'defence', defense: 'defence', tou: 'defence', toughness: 'defence',
    life: 'life',
    r: 'rarity', rarity: 'rarity',
    s: 'set', set: 'set', e_set: 'set',
    o: 'text', text: 'text', oracle: 'text', rules: 'text',
    a: 'artist', artist: 'artist', art: 'artist', illus: 'artist', illustrator: 'artist',
    // thresholds
    water: 'th_water', wt: 'th_water',
    fire: 'th_fire', ft: 'th_fire',
    earth: 'th_earth', et: 'th_earth',
    air: 'th_air', at: 'th_air',
  };
  const NUMERIC = new Set(['cost', 'attack', 'defence', 'life', 'th_water', 'th_fire', 'th_earth', 'th_air']);

  // Tokenize: split on spaces but keep quoted strings together
  function tokenize(str) {
    const tokens = []; let i = 0;
    while (i < str.length) {
      while (i < str.length && str[i] === ' ') i++;
      if (i >= str.length) break;
      let tok = ''; let inQuote = false;
      // capture leading -, field:, operator, then value (which may be quoted)
      while (i < str.length && (str[i] !== ' ' || inQuote)) {
        const ch = str[i];
        if (ch === '"') { inQuote = !inQuote; i++; continue; }
        tok += ch; i++;
      }
      if (tok) tokens.push(tok);
    }
    return tokens;
  }

  // Parse one token into a predicate object
  function parseToken(raw) {
    let negate = false;
    let tok = raw;
    if (tok.startsWith('-')) { negate = true; tok = tok.slice(1); }

    // find field + operator
    const m = tok.match(/^([a-z_]+)\s*(>=|<=|!=|=|:|>|<)\s*(.*)$/i);
    if (!m) {
      // bare word → search name + rules text + subtypes + type
      return { field: 'any', op: ':', value: tok.toLowerCase(), negate };
    }
    const rawField = m[1].toLowerCase();
    let op = m[2];
    const value = m[3];
    const field = FIELDS[rawField];
    if (!field) {
      // unknown field → treat the whole thing as a broad text search
      return { field: 'any', op: ':', value: tok.toLowerCase(), negate };
    }
    if (op === ':') op = (NUMERIC.has(field)) ? '=' : ':';
    return { field, op, value: value.toLowerCase(), negate };
  }

  // Parse full query string into OR-groups of AND-predicates.
  // Returns null on an empty/blank query. Never throws.
  function parse(str) {
    try {
      const tokens = tokenize(String(str || '').trim());
      if (!tokens.length) return null;
      const orGroups = [[]];
      for (const t of tokens) {
        if (t.toLowerCase() === 'or') { orGroups.push([]); continue; }
        if (t.toLowerCase() === 'and') continue; // implicit
        orGroups[orGroups.length - 1].push(parseToken(t));
      }
      const groups = orGroups.filter(g => g.length);
      return groups.length ? groups : null;
    } catch (e) { return null; }
  }

  function cardValue(card, field) {
    switch (field) {
      // bare-word search — name, rules text, subtypes and type together
      case 'any': return ((card.name || '') + ' ' + (card.rules_text || '') + ' ' + (card.subTypes || '') + ' ' + (card.type || '')).toLowerCase();
      case 'name': return (card.name || '').toLowerCase();
      case 'element': return (card.element || '').toLowerCase();
      case 'type': return (card.type || '').toLowerCase();
      case 'subtype': return (card.subTypes || '').toLowerCase();
      case 'rarity': return (card.rarity || '').toLowerCase();
      case 'set': return (card.set || '').toLowerCase();
      case 'artist': return (card.artist || '').toLowerCase();
      case 'text': return (card.rules_text || '').toLowerCase();
      case 'cost': return card.cost;
      case 'attack': return card.attack;
      case 'defence': return card.defence;
      case 'life': return card.life;
      case 'th_water': return (card.thresholds || {}).water || 0;
      case 'th_fire': return (card.thresholds || {}).fire || 0;
      case 'th_earth': return (card.thresholds || {}).earth || 0;
      case 'th_air': return (card.thresholds || {}).air || 0;
      default: return null;
    }
  }

  function matchPredicate(card, pred) {
    const cv = cardValue(card, pred.field);
    let result;
    if (NUMERIC.has(pred.field)) {
      if (pred.value === 'x') {
        // Variable cost/stat: match cards whose value is literally "X"
        result = ((cv == null ? '' : String(cv)).trim().toLowerCase() === 'x');
      } else {
        const target = parseFloat(pred.value);
        const num = (cv == null ? null : Number(cv));
        if (isNaN(target)) result = false;
        else if (num == null) result = false;
        else switch (pred.op) {
          case '>': result = num > target; break;
          case '<': result = num < target; break;
          case '>=': result = num >= target; break;
          case '<=': result = num <= target; break;
          case '!=': result = num !== target; break;
          default: result = num === target;
        }
      }
    } else {
      const text = cv || '';
      if (pred.field === 'element' && pred.value.includes(',')) {
        // comma = OR list for elements
        const opts = pred.value.split(',').map(s => s.trim()).filter(Boolean);
        result = opts.some(o => text.includes(o));
      } else if (pred.op === '=') {
        result = text === pred.value;
      } else {
        result = text.includes(pred.value);
      }
    }
    return pred.negate ? !result : result;
  }

  // ast = array of OR-groups; each group = AND of predicates
  function match(card, ast) {
    if (!ast) return true;
    return ast.some(group => group.every(p => matchPredicate(card, p)));
  }

  window.Invoke = { parse, match, matchPredicate, cardValue, FIELDS, NUMERIC };
})();
