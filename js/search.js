// Ranked, typo-tolerant, synonym-aware recipe search.
import { norm, words, editDistance, allowedTypos } from './text.js';

export const DEFAULT_SYNONYMS = [
  ['bell pepper', 'capsicum', 'sweet pepper', 'red pepper', 'green pepper', 'yellow pepper'],
  ['courgette', 'zucchini'],
  ['aubergine', 'eggplant', 'brinjal', 'baingan'],
  ['coriander leaves', 'cilantro', 'fresh coriander', 'dhania'],
  ['spring onion', 'scallion', 'green onion'],
  ['rocket', 'arugula'],
  ['prawn', 'shrimp'],
  ['minced beef', 'ground beef', 'beef mince', 'mince', 'hamburger meat'],
  ['chickpea', 'garbanzo', 'chana', 'chole'],
  ['icing sugar', 'powdered sugar', 'confectioners sugar'],
  ['caster sugar', 'superfine sugar'],
  ['cornflour', 'cornstarch', 'corn starch'],
  ['plain flour', 'all purpose flour', 'maida'],
  ['wholemeal flour', 'whole wheat flour', 'atta'],
  ['double cream', 'heavy cream', 'whipping cream'],
  ['single cream', 'light cream'],
  ['beetroot', 'beet'],
  ['swede', 'rutabaga'],
  ['mangetout', 'snow pea', 'sugar snap'],
  ['broad bean', 'fava bean'],
  ['bicarbonate of soda', 'baking soda', 'bicarb'],
  ['okra', 'lady finger', 'bhindi'],
  ['yogurt', 'yoghurt', 'curd', 'dahi'],
  ['cottage cheese', 'paneer'],
  ['chilli', 'chili', 'chile', 'mirch'],
  ['chilli flakes', 'red pepper flakes', 'crushed red pepper'],
  ['spaghetti', 'pasta'],
  ['penne', 'pasta'],
  ['fusilli', 'pasta'],
  ['linguine', 'pasta'],
  ['tagliatelle', 'pasta'],
  ['potato', 'aloo'],
  ['cauliflower', 'gobi'],
  ['spinach', 'palak'],
  ['peas', 'matar'],
  ['lentil', 'dal', 'dhal'],
  ['cumin', 'jeera'],
  ['turmeric', 'haldi'],
  ['fenugreek', 'methi'],
  ['ginger', 'adrak'],
  ['garlic', 'lahsun'],
  ['sausage', 'chorizo', 'salami'],
  ['bacon', 'pancetta', 'lardons'],
  ['parmesan', 'parmigiano', 'grana padano'],
  ['scampi', 'langoustine'],
  ['squid', 'calamari'],
  ['cooking chocolate', 'baking chocolate', 'dark chocolate'],
  ['stock', 'broth', 'bouillon'],
  ['sultana', 'raisin'],
  ['shallot', 'eschalot'],
  ['jacket potato', 'baked potato'],
  ['biscuit', 'cookie'],
  ['chips', 'french fries', 'fries'],
  ['crisps', 'potato chips'],
  ['jam', 'jelly', 'preserve'],
  ['candy floss', 'cotton candy'],
  ['starter', 'appetizer', 'appetiser', 'entree', 'hors d oeuvre'],
  ['dessert', 'pudding', 'sweet', 'afters'],
  ['amuse bouche', 'amuse', 'amuse gueule'],
  ['main', 'main course'],
  ['saute', 'pan fry', 'shallow fry'],
];

// Words that carry no meaning in a search like "a recipe with spaghetti and parsley".
const STOP = new Set(['a', 'an', 'the', 'and', 'with', 'or', 'of', 'recipe', 'recipes', 'some', 'for', 'in', 'to', 'using', 'containing', 'contain', 'dish', 'something', 'i', 'have', 'want']);

const matchCache = new Map();
// Does query word q match recipe word w, allowing typos and prefix typing?
export function wordMatch(q, w) {
  if (q === w) return 1;
  const key = q + '|' + w;
  if (matchCache.has(key)) return matchCache.get(key);
  let r = 0;
  if (q.length >= 4 && w.startsWith(q)) r = 0.9;
  else if (w.length >= 5 && q.startsWith(w) && q.length - w.length <= 2) r = 0.9;
  else {
    const t = allowedTypos(Math.min(q.length, w.length));
    if (t > 0) {
      const d = editDistance(q, w, t);
      if (d <= t) r = 1 - d * 0.12;
    }
  }
  if (matchCache.size > 50000) matchCache.clear();
  matchCache.set(key, r);
  return r;
}

// Does every word of phrase (array) appear among target words? Returns strength 0..1.
function phraseIn(phrase, target) {
  let total = 0;
  for (const p of phrase) {
    let best = 0;
    for (const t of target) { const m = wordMatch(p, t); if (m > best) { best = m; if (m === 1) break; } }
    if (!best) return 0;
    total += best;
  }
  return total / phrase.length;
}

// Phrase must appear as consecutive words (for long text like the method).
function phraseSeq(phrase, target) {
  if (phrase.length === 1) return phraseIn(phrase, target);
  let best = 0;
  for (let i = 0; i + phrase.length <= target.length; i++) {
    let tot = 0, ok = true;
    for (let j = 0; j < phrase.length; j++) { const m = wordMatch(phrase[j], target[i + j]); if (!m) { ok = false; break; } tot += m; }
    if (ok) { best = Math.max(best, tot / phrase.length); if (best === 1) break; }
  }
  return best;
}

export class SearchIndex {
  constructor(recipes, synonymGroups) {
    this.groups = synonymGroups.map(g => g.map(p => words(p)).filter(p => p.length));
    this.vocab = new Set(); // multi-word phrases for joining query words
    for (const g of this.groups) for (const p of g) if (p.length > 1) this.vocab.add(p.join(' '));
    this.docs = recipes.filter(r => !r.deleted).map(r => {
      const ings = r.ingredients.map(i => {
        const w = words(i.name);
        if (w.length > 1 && w.length <= 3) this.vocab.add(w.join(' '));
        return { ing: i, w, alts: (i.alternatives || []).map(a => words(a)) };
      });
      return {
        r, ings,
        title: words(r.title),
        cats: words([...(r.mealTypes || []), ...(r.courses || []), ...(r.tags || [])].join(' ')),
        body: words([r.description, r.method, r.notes].join(' ')),
      };
    });
  }

  // Split a query into terms: commas / "and" split explicitly; otherwise join known phrases.
  terms(query) {
    const chunks = query.split(/[,;+&]|\band\b|\bwith\b/i).filter(c => norm(c));
    const out = [];
    for (const c of chunks) {
      const ws = words(c).filter(w => !STOP.has(w));
      if (!ws.length) continue;
      if (chunks.length > 1 && ws.length <= 3) { out.push(ws); continue; }
      // Greedy longest known phrase
      let i = 0;
      while (i < ws.length) {
        let took = 1;
        for (let n = Math.min(3, ws.length - i); n > 1; n--) {
          const ph = ws.slice(i, i + n).join(' ');
          if (this.vocab.has(ph)) { took = n; break; }
        }
        out.push(ws.slice(i, i + took));
        i += took;
      }
    }
    return out;
  }

  // All the ways to say this term (itself + synonym group members).
  variants(term) {
    const vs = [{ p: term, w: 1 }];
    for (const g of this.groups) {
      if (g.some(p => p.length === term.length && phraseIn(term, p) >= 0.75)) {
        for (const p of g) if (p.join(' ') !== term.join(' ')) vs.push({ p, w: 0.95 });
      }
    }
    return vs;
  }

  search(query, filters = {}) {
    const terms = query.trim() ? this.terms(query) : [];
    const termVariants = terms.map(t => this.variants(t));
    const results = [];
    for (const d of this.docs) {
      const r = d.r;
      if (filters.mealType && !(r.mealTypes || []).includes(filters.mealType)) continue;
      if (filters.course && !(r.courses || []).includes(filters.course)) continue;
      if (filters.favourite && !r.favourite) continue;
      if (filters.needsReview && r.reviewed) continue;
      if (filters.needsAmounts && !r.ingredients.some(i => !i.qty)) continue;
      if (!terms.length) { results.push({ r, score: 0, matched: [], missing: [] }); continue; }

      let score = 0;
      const matched = [], missing = [], hitIngs = new Set();
      terms.forEach((t, k) => {
        let best = 0, where = '', ingIdx = -1;
        for (const v of termVariants[k]) {
          d.ings.forEach((x, idx) => {
            let s = phraseIn(v.p, x.w) * v.w;
            for (const a of x.alts) s = Math.max(s, phraseIn(v.p, a) * v.w * 0.9);
            if (x.ing.optional) s *= 0.9;
            if (s > best) { best = s; where = 'ingredient'; ingIdx = idx; }
          });
          const ts = phraseSeq(v.p, d.title) * v.w * 0.95;
          if (ts > best) { best = ts; where = 'title'; ingIdx = -1; }
          const cs = phraseIn(v.p, d.cats) * v.w;
          if (cs > best) { best = cs; where = 'category'; ingIdx = -1; }
          const bs = phraseSeq(v.p, d.body) * v.w * 0.4;
          if (bs > best) { best = bs; where = 'method'; ingIdx = -1; }
        }
        const label = t.join(' ');
        if (best >= 0.3 && where !== 'title' && termVariants[k].some(v => phraseSeq(v.p, d.title) >= 0.75)) best += 0.5; // also in the name
        if (best >= 0.3) { score += best; matched.push({ term: label, where }); if (ingIdx >= 0) hitIngs.add(ingIdx); }
        else missing.push(label);
      });
      if (!matched.length) continue;
      // Rank: share of terms found first, then strength, then fewer extra ingredients (closer match).
      const coverage = matched.reduce((a, m) => a + (m.where === 'method' ? 0.6 : 1), 0) / terms.length;
      const extra = d.ings.length ? (d.ings.length - hitIngs.size) / d.ings.length : 0;
      results.push({ r, score: coverage * 10 + score / terms.length * 2 - extra * 0.5 + (r.favourite ? 0.1 : 0), matched, missing, hitIngs });
    }
    if (!terms.length) results.sort((a, b) => norm(a.r.title).localeCompare(norm(b.r.title)));
    else results.sort((a, b) => b.score - a.score);
    return { terms: terms.map(t => t.join(' ')), results };
  }
}
