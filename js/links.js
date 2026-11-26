// Links between recipes: "serve with wilted fennel (see above)" -> link to the "Wilted fennel" recipe.
import { words } from './text.js';
import { wordMatch } from './search.js';

// "(see above)", "see below", "(above)", "(see earlier)", "(recipe below)"
const STRICT_CUE = /\((?:see\s+(?:recipe\s+)?)?(?:above|below|earlier|later)(?:\s+recipe)?\)|\bsee\s+(?:recipe\s+)?(?:above|below|earlier|later)\b/gi;
const SKIP = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'of', 'in', 'on', 'to', 'for', 'serve', 'served', 'make', 'cook', 'use', 'add', 'one', 'some', 'like', 'as', 'it', 'top', 'topped', 'mix', 'place', 'fried', 'grilled', 'roasted', 'extra', 'little', 'more', 'bed', 'slice', 'slices', 'alternate', 'optionally', 'fresh', 'dry']);

// Find every cue in a text, with the few words just before it (which usually name the other dish).
export function findCues(text) {
  const out = [];
  let m; STRICT_CUE.lastIndex = 0;
  while ((m = STRICT_CUE.exec(text || ''))) {
    const dir = /above|earlier/i.test(m[0]) ? -1 : 1;
    const before = text.slice(Math.max(0, m.index - 70), m.index).split(/[.;:!?\n]/).pop();
    out.push({ cue: m[0], index: m.index, dir, before });
  }
  return out;
}

function titleScore(beforeText, title) {
  const bw = words(beforeText).filter(w => !SKIP.has(w) && !/^\d/.test(w));
  const tw = words(title).filter(w => !SKIP.has(w));
  if (!bw.length || !tw.length) return 0;
  // The words right before the cue name the other dish ("... wilted fennel (see above)").
  const near = bw.slice(-3);
  const nearHits = near.filter(b => tw.some(t => wordMatch(b, t) >= 0.85)).length;
  if (!nearHits) return 0;
  const titleHits = tw.filter(t => bw.some(b => wordMatch(b, t) >= 0.85)).length;
  return 0.7 * nearHits / near.length + 0.3 * titleHits / tw.length;
}

// recipes: in their original order (as written in Notes). Adds r.links for cues it can resolve.
export function autoLink(recipes) {
  let made = 0;
  recipes.forEach((r, i) => {
    const text = [r.method, r.notes].filter(Boolean).join('\n');
    findCues(text).forEach((c, k) => {
      let best = null;
      const range = c.dir < 0 ? recipes.slice(0, i).reverse() : recipes.slice(i + 1);
      range.forEach((t, dist) => {
        const s = titleScore(c.before, t.title) - Math.min(dist, 100) * 0.001; // prefer the nearest
        if (s > 0.25 && (!best || s > best.s)) best = { s, t };
      });
      if (!best) return;
      r.links = r.links || [];
      if (!r.links.some(l => l.id === best.t.id)) { r.links.push({ id: best.t.id, cue: c.cue, cueIndex: k, auto: true }); made++; }
    });
  });
  return made;
}
