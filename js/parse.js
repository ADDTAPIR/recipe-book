// Turning free-form Notes text into structured recipes.
import { norm, uid } from './text.js';

export const MEAL_TYPES = ['breakfast', 'brunch', 'lunch', 'dinner', 'sandwich', 'snack', 'drink', 'baking', 'party'];
export const COURSES = ['amuse-bouche', 'starter', 'soup', 'salad', 'main', 'side', 'dessert', 'sauce', 'bread'];

const UNITS = [
  'teaspoons', 'teaspoon', 'tsp', 'tablespoons', 'tablespoon', 'tbsp', 'tbs', 'tbl',
  'cups', 'cup', 'c', 'ml', 'millilitres', 'milliliters', 'l', 'litres', 'liters', 'litre', 'liter', 'dl', 'cl',
  'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kilo', 'kilos', 'kilograms', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls', 'bunch', 'bunches', 'clove', 'cloves',
  'can', 'cans', 'tin', 'tins', 'jar', 'jars', 'packet', 'packets', 'pack', 'slice', 'slices', 'sprig', 'sprigs',
  'stick', 'sticks', 'piece', 'pieces', 'knob', 'drizzle', 'splash', 'glass', 'pint', 'pints', 'qt', 'quart',
  'fl oz', 'inch', 'cm', 'sheet', 'sheets', 'head', 'heads', 'stalk', 'stalks', 'leaf', 'leaves', 'cube', 'cubes',
];
const UNIT_RE = UNITS.slice().sort((a, b) => b.length - a.length).map(u => u.replace(' ', '\\s')).join('|');

const FRACTIONS = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅕': '1/5' };
const QTY_RE = new RegExp(
  '^((?:about|approx\\.?|approximately|~)\\s*)?' +
  '((?:\\d+\\s+)?\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?(?:\\s*(?:-|–|to)\\s*\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?)?|a few|a couple of|a|an|one|two|three|four|five|six|half(?: a)?)' +
  '\\s*(' + UNIT_RE + ')?\\.?\\b\\s*(?:of\\s+)?', 'i');

const BULLET_RE = /^\s*(?:[-*•·▪◦‣–—>]|\d+[.)]|\[[ x]?\]|☐|☑|✓|✔)\s*/i;

// Parse one ingredient line like "2 tbsp olive oil (or butter), optional".
export function parseIngredientLine(raw) {
  let line = raw.replace(BULLET_RE, '').trim();
  for (const [k, v] of Object.entries(FRACTIONS)) line = line.replace(new RegExp('(\\d)?' + k, 'g'), (m, d) => (d ? d + ' ' : '') + v);
  const ing = { name: '', qty: '', unit: '', optional: false, alternatives: [], note: '' };

  // Optional markers
  const optRe = /\(?\b(optional|if you like|if desired|to taste, optional|opt\.)\b\)?/i;
  if (optRe.test(line)) { ing.optional = true; line = line.replace(optRe, '').replace(/\s*,\s*$/, '').trim(); }

  // Quantity + unit at the start
  const m = line.match(QTY_RE);
  if (m && m[0].trim() && !(/^(a|an)$/i.test(m[2]) && !m[3])) {
    ing.qty = ((m[1] || '') + m[2]).trim();
    ing.unit = (m[3] || '').trim();
    line = line.slice(m[0].length).trim();
  }
  // Quantity at the end: "Parsley - 1 bunch" / "Salt: 1 tsp"
  if (!ing.qty) {
    const end = line.match(new RegExp('\\s*[-–:,]\\s*((?:\\d+\\s+)?\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?)\\s*(' + UNIT_RE + ')?\\.?$', 'i'));
    if (end) { ing.qty = end[1]; ing.unit = end[2] || ''; line = line.slice(0, end.index).trim(); }
  }

  // Alternatives in brackets: "(or coriander)"
  line = line.replace(/\((?:or|alternatively|alt\.?|substitute)\s+([^)]+)\)/gi, (_, alt) => {
    ing.alternatives.push(...alt.split(/\s*(?:,|\bor\b|\/)\s*/).filter(Boolean));
    return '';
  }).trim();

  // Other bracketed text becomes a note
  line = line.replace(/\(([^)]*)\)/g, (_, n) => { if (n.trim()) ing.note = (ing.note ? ing.note + '; ' : '') + n.trim(); return ''; }).trim();

  // "x, finely chopped" -> note
  const comma = line.indexOf(',');
  if (comma > 0) {
    const rest = line.slice(comma + 1).trim();
    if (rest) ing.note = (ing.note ? ing.note + '; ' : '') + rest;
    line = line.slice(0, comma).trim();
  }

  // "butter or margarine", "butter / ghee"
  const parts = line.split(/\s+or\s+|\s*\/\s*/i).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) { line = parts[0]; ing.alternatives.unshift(...parts.slice(1)); }

  if (/\bto taste\b/i.test(line)) { ing.note = (ing.note ? ing.note + '; ' : '') + 'to taste'; line = line.replace(/\s*\bto taste\b/i, ''); }
  ing.name = line.replace(/\s{2,}/g, ' ').replace(/^[-:,\s]+|[-:,.\s]+$/g, '');
  ing.alternatives = ing.alternatives.map(a => a.replace(/[.,;]+$/, '').trim()).filter(Boolean);
  return ing;
}

const ING_HEAD = /^\s*(ingredients?|you(?:'|’)?ll need|you will need|what you need|for the [\w\s]+)\s*:?\s*$/i;
const METHOD_HEAD = /^\s*(method|directions?|instructions?|steps?|preparation|prep|how to( make( it)?)?|to make|procedure|cooking|recipe)\s*:?\s*$/i;
const NOTES_HEAD = /^\s*(notes?|tips?|variations?|to serve|serving suggestions?)\s*:?\s*$/i;
const SERVES_RE = /\b(?:serves|servings|makes|yield|feeds|for)\s*:?\s*(\d+(?:\s*(?:-|–|to)\s*\d+)?)/i;

function looksLikeIngredient(line) {
  const l = line.replace(BULLET_RE, '').trim();
  if (!l || l.length > 70) return false;
  if (/[.!?]$/.test(l) && l.split(' ').length > 6) return false;
  if (/^(heat|add|mix|stir|cook|bake|boil|fry|place|put|serve|combine|preheat|chop|cut|pour|whisk|bring|remove|let|leave|season|garnish|in a|once|when|meanwhile|then|transfer|cover|simmer|roast|grill|blend|saute|sauté|drain|toss|spread|fold|beat)\b/i.test(l)) return false;
  return true;
}

// Split a whole pasted export into recipe blocks.
export function splitRecipes(text) {
  const t = text.replace(/\r\n?/g, '\n');
  // Explicit separators win.
  let blocks = t.split(/\n\s*(?:-{3,}|—{3,}|–{3,}|\*{3,}|_{3,}|={3,}|#{3,}|~{3,})\s*\n/);
  if (blocks.length === 1) blocks = t.split(/\n\s*\n\s*\n+/); // two or more blank lines
  if (blocks.length === 1) {
    // Fall back: start a new recipe at the title line before each "Ingredients" heading.
    const lines = t.split('\n');
    const starts = [];
    lines.forEach((l, i) => {
      if (ING_HEAD.test(l) && !/^for the/i.test(l.trim())) {
        let j = i - 1;
        while (j >= 0 && !lines[j].trim()) j--;
        // walk up past a "serves" line or short description
        if (j > 0 && SERVES_RE.test(lines[j])) { j--; while (j >= 0 && !lines[j].trim()) j--; }
        if (j >= 0) starts.push(j);
      }
    });
    if (starts.length > 1) {
      blocks = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join('\n'));
      if (starts[0] > 0) {
        const pre = lines.slice(0, starts[0]).join('\n');
        if (pre.trim()) blocks.unshift(pre);
      }
    }
  }
  return blocks.map(b => b.trim()).filter(b => b.length > 0);
}

// Parse one recipe block into a recipe object.
export function parseRecipe(block) {
  const lines = block.split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = (lines.shift() || 'Untitled recipe').replace(/^#+\s*/, '').replace(/[:\s]+$/, '').trim();
  const recipe = newRecipe({ title, source: block });

  let mode = null; // 'ing' | 'method' | 'notes' | null
  const pre = [], ingLines = [], methodLines = [], noteLines = [];
  let sawHeadings = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s) { if (mode === 'method' || mode === 'notes') (mode === 'method' ? methodLines : noteLines).push(''); continue; }
    const sv = s.match(SERVES_RE);
    if (sv && s.length < 40 && !recipe.serves) { recipe.serves = sv[1]; continue; }
    if (ING_HEAD.test(s)) { sawHeadings = true; mode = 'ing'; if (/^for the/i.test(s)) ingLines.push('## ' + s.replace(/:$/, '')); continue; }
    if (METHOD_HEAD.test(s)) { sawHeadings = true; mode = 'method'; continue; }
    if (NOTES_HEAD.test(s)) { sawHeadings = true; mode = 'notes'; continue; }
    if (mode === 'ing') {
      // A long prose sentence after ingredients usually means the method started without a heading.
      if (!looksLikeIngredient(s) && s.length > 60) { mode = 'method'; methodLines.push(s); }
      else ingLines.push(s);
    } else if (mode === 'method') methodLines.push(s);
    else if (mode === 'notes') noteLines.push(s);
    else pre.push(s);
  }

  if (!sawHeadings) {
    // No headings: leading short lines are ingredients, the rest is method.
    let i = 0;
    while (i < pre.length && looksLikeIngredient(pre[i])) i++;
    if (i === 0) { methodLines.push(...pre); }
    else { ingLines.push(...pre.slice(0, i)); methodLines.push(...pre.slice(i)); }
  } else if (pre.length) {
    recipe.description = pre.join('\n');
  }

  let group = '';
  for (const l of ingLines) {
    if (l.startsWith('## ')) { group = l.slice(3).replace(/^for the\s+/i, ''); continue; }
    // A line with commas but no quantities, like "salt, pepper, oregano" -> several ingredients
    const bare = l.replace(BULLET_RE, '');
    const pieces = (!/\d/.test(bare) && bare.split(',').length > 2 && bare.split(',').every(p => p.trim().split(' ').length <= 3))
      ? bare.split(',') : [l];
    for (const p of pieces) {
      const ing = parseIngredientLine(p);
      if (ing.name) { if (group) ing.group = group; recipe.ingredients.push(ing); }
    }
  }
  recipe.method = methodLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  recipe.notes = noteLines.join('\n').trim();
  const cat = categorize(recipe);
  recipe.mealTypes = cat.mealTypes;
  recipe.courses = cat.courses;
  recipe.reviewed = false;
  return recipe;
}

export function newRecipe(over = {}) {
  const now = Date.now();
  return {
    id: uid(), title: '', description: '', serves: '', ingredients: [], method: '', notes: '',
    mealTypes: [], courses: [], tags: [], reviewed: true, favourite: false, source: '',
    createdAt: now, updatedAt: now, deleted: false, ...over,
  };
}

// ---------- Automatic categorization ----------
// Each rule: keywords found in the title (weighted x3) or anywhere (x1).
const COURSE_RULES = {
  'soup': ['soup', 'broth', 'chowder', 'bisque', 'consomme', 'gazpacho', 'minestrone', 'rasam', 'potage', 'velouté', 'veloute', 'ramen', 'pho', 'stock'],
  'salad': ['salad', 'slaw', 'coleslaw', 'tabbouleh', 'tabouleh', 'fattoush', 'raita', 'caprese', 'kachumber'],
  'dessert': ['dessert', 'cake', 'pudding', 'mousse', 'ice cream', 'sorbet', 'brownie', 'cookie', 'biscuit', 'crumble', 'custard', 'cheesecake', 'tiramisu', 'panna cotta', 'meringue', 'pavlova', 'kheer', 'halwa', 'gulab', 'fudge', 'trifle', 'figs', 'souffle', 'crème brûlée', 'creme brulee', 'brulee', 'parfait', 'chocolate', 'caramel', 'compote', 'payesh', 'halva', 'biscotti', 'brittle', 'jello', 'lollipop'],
  'starter': ['starter', 'appetizer', 'appetiser', 'antipasto', 'bruschetta', 'crostini', 'dip', 'hummus', 'houmous', 'pate', 'pâté', 'terrine', 'canape', 'canapé', 'tapas', 'samosa', 'pakora', 'spring roll', 'croquette', 'carpaccio', 'ceviche', 'tartare', 'tartar', 'oysters', 'bone marrow', 'croquettes', 'mezze', 'fritter', 'skewer', 'satay'],
  'amuse-bouche': ['amuse', 'amuse-bouche', 'amuse bouche', 'shot', 'bite', 'bites', 'canape', 'canapé'],
  'side': ['side', 'mash', 'mashed', 'roast potatoes', 'gratin', 'pilaf', 'pilau', 'rice', 'chips', 'fries', 'slaw', 'greens', 'roasted vegetables', 'vegetables', 'veggies', 'eggplant', 'aubergine', 'okra', 'cauliflower', 'fennel', 'squash', 'potatoes', 'potato', 'cabbage', 'spinach', 'beans', 'corn', 'carrots', 'polenta', 'couscous', 'puree', 'purée', 'bitter gourd', 'chickpeas', 'chick peas'],
  'sauce': ['sauce', 'dressing', 'vinaigrette', 'pesto', 'chutney', 'salsa', 'gravy', 'mayo', 'mayonnaise', 'aioli', 'relish', 'marinade', 'glaze', 'jam', 'pickle', 'ketchup', 'coulis'],
  'bread': ['bread', 'loaf', 'focaccia', 'naan', 'roti', 'chapati', 'paratha', 'flatbread', 'bun', 'rolls', 'sourdough', 'brioche', 'scone'],
  'main': ['main', 'curry', 'stew', 'roast', 'casserole', 'pasta', 'spaghetti', 'lasagne', 'lasagna', 'risotto', 'pie', 'steak', 'chicken', 'beef', 'lamb', 'pork', 'fish', 'salmon', 'cod', 'prawn', 'shrimp', 'sausage', 'biryani', 'stir fry', 'stir-fry', 'tagine', 'burger', 'chilli', 'chili', 'paella', 'gnocchi', 'noodles', 'tacos', 'enchilada', 'meatballs', 'bake', 'pizza', 'dal', 'dhal', 'daal', 'korma', 'bhurji', 'khichdi', 'grostl', 'gröstl', 'stampot', 'stamppot', 'okonomiyaki', 'donburi', 'shepherds pie', 'pot pie', 'savory pie', 'savoury pie', 'meat pie', 'veggie pie', 'wellington', 'tofu', 'goulash', 'ragu', 'ragù', 'bolognese', 'carbonara', 'thai', 'grilled', 'quiche'],
};
const MEAL_RULES = {
  'breakfast': ['breakfast', 'pancake', 'waffle', 'porridge', 'oats', 'oatmeal', 'granola', 'muesli', 'omelette', 'omelet', 'scrambled', 'eggs', 'french toast', 'smoothie', 'shakshuka', 'frittata', 'poha', 'upma', 'idli', 'dosa', 'muffin', 'crepe', 'crêpe', 'bhurji', 'handvo', 'benedict'],
  'brunch': ['brunch', 'eggs benedict', 'shakshuka', 'hash', 'frittata', 'french toast'],
  'sandwich': ['sandwich', 'toastie', 'panini', 'wrap', 'sub', 'baguette', 'bagel', 'blt', 'club', 'burger', 'croque', 'pita', 'roll'],
  'snack': ['snack', 'dip', 'crisps', 'nuts', 'popcorn', 'energy ball', 'bar', 'bites', 'cracker', 'samosa', 'pakora', 'bhaji', 'hummus', 'toast', 'cookie', 'biscuit'],
  'drink': ['drink', 'cocktail', 'smoothie', 'juice', 'lassi', 'lemonade', 'tea', 'coffee', 'chai', 'punch', 'mocktail', 'shake', 'milkshake', 'sangria'],
  'baking': ['bake', 'baking', 'cake', 'bread', 'loaf', 'muffin', 'scone', 'cookie', 'biscuit', 'brownie', 'pastry', 'tart', 'pie', 'sourdough'],
  'lunch': ['lunch', 'salad', 'soup', 'sandwich', 'wrap', 'quiche', 'frittata', 'bowl'],
  'dinner': ['dinner', 'supper', 'curry', 'stew', 'roast', 'casserole', 'pasta', 'spaghetti', 'risotto', 'steak', 'biryani', 'lasagne', 'lasagna', 'tagine', 'paella', 'pie', 'chilli', 'chili'],
};

function scoreRules(rules, title, all) {
  const scores = {};
  for (const [cat, kws] of Object.entries(rules)) {
    let s = 0;
    for (const kw of kws) {
      const re = new RegExp('\\b' + norm(kw).replace(/\s+/g, '\\s+') + '(?:e?s)?\\b');
      if (re.test(title)) s += 3;
      else if (re.test(all)) s += 1;
    }
    if (s) scores[cat] = s;
  }
  return scores;
}

const TITLE_ONLY_COURSES = new Set(['sauce', 'bread', 'amuse-bouche', 'side']);
const PROTEIN = /\b(chicken|beef|lamb|pork|fish|salmon|cod|prawns?|shrimps?|lobster|duck|venison|veal|steak|mutton|tuna|scallops?|mackerel|octopus|squid|calamari|sausages?|tofu|paneer|ribs?|tenderloin|entrecote|ribeye|kheema|mince|meatballs?|liver|ham|chops|herring|oysters?|anchov(?:y|ies)|catfish|pomfret|rohu|monkfish|langoustines?|garnalen|bone marrow)\b/;

function categorizeRaw(recipe) {
  const title = norm(recipe.title);
  const all = norm([recipe.title, recipe.description, recipe.ingredients.map(i => i.name).join(' '), recipe.notes].join(' '));
  const cs = scoreRules(COURSE_RULES, title, all);
  const ms = scoreRules(MEAL_RULES, title, title); // meal type only from the title: body words like "tea" mislead

  for (const c of Object.keys(cs)) if (TITLE_ONLY_COURSES.has(c) && cs[c] < 3) delete cs[c];
  const courses = Object.entries(cs).sort((a, b) => b[1] - a[1]);
  const pickedC = [];
  const titleHits = courses.filter(([, s]) => s >= 3);
  if (titleHits.length) pickedC.push(...titleHits.slice(0, 2).map(([c]) => c));
  else if (PROTEIN.test(title)) pickedC.push('main');
  else if (courses.length && courses[0][1] >= 2) pickedC.push(courses[0][0]);
  const drop = c => { const i = pickedC.indexOf(c); if (i >= 0) pickedC.splice(i, 1); };
  const hasProtein = PROTEIN.test(title);
  if (hasProtein) { drop('dessert'); drop('bread'); if (!pickedC.length) pickedC.push('main'); }
  // "X with/in/on Y sauce" is a dish served with a sauce, not a sauce.
  if (/\b(with|in|on|w)\b/.test(title) || hasProtein) { drop('sauce'); if (!pickedC.length) pickedC.push(hasProtein ? 'main' : 'side'); }
  if (pickedC.includes('dessert')) { drop('main'); drop('side'); drop('sauce'); }
  if (hasProtein && pickedC.includes('side')) { drop('side'); if (!pickedC.includes('main')) pickedC.unshift('main'); }
  if (pickedC.includes('main')) drop('side');
  if (pickedC.includes('soup') || pickedC.includes('salad')) { const i = pickedC.indexOf('main'); if (i >= 0 && pickedC[0] !== 'main') pickedC.splice(i, 1); }

  const pickedM = Object.entries(ms).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => m);
  if (hasProtein || pickedC.includes('dessert') || pickedC.includes('main')) {
    const i = pickedM.indexOf('drink'); if (i >= 0) pickedM.splice(i, 1);
  }
  if (!pickedM.length) {
    if (pickedC.includes('main')) pickedM.push('dinner');
    else if (pickedC.includes('soup') || pickedC.includes('salad')) pickedM.push('lunch', 'dinner');
    else if (pickedC.includes('starter') || pickedC.includes('amuse-bouche')) pickedM.push('dinner');
  }
  if (!pickedC.length && pickedM.some(m => m === 'dinner' || m === 'lunch')) pickedC.push('main');
  if (pickedM.includes('breakfast') || pickedM.includes('brunch')) { if (pickedC.includes('side')) pickedC.splice(pickedC.indexOf('side'), 1, 'main'); }
  return { mealTypes: pickedM, courses: pickedC };
}

// ---------- Cuisine ----------
export const CUISINES = ['Indian', 'Japanese', 'Chinese', 'Thai', 'Mediterranean', 'French', 'Italian', 'Continental', 'American', 'Spanish', 'Middle Eastern', 'Asian', 'European', 'Quick'];
// Title words count 3, ingredients and method count 1 (each keyword once).
const CUISINE_RULES = {
  'Indian': ['indian', 'india', 'bengali', 'gujarati', 'maharashtrian', 'kolkata', 'baroda', 'mughlai', 'moglai', 'kheema', 'keema', 'biryani', 'paratha', 'naan', 'roti', 'chapati', 'dosa', 'idli', 'daal', 'dal', 'dhal', 'masala', 'tikka', 'korma', 'curry', 'paneer', 'payesh', 'kheer', 'halva', 'halwa', 'samosa', 'pakora', 'bhaji', 'bharta', 'bhurji', 'anda', 'khichdi', 'handvo', 'khaman', 'khandvi', 'poha', 'sabudana', 'lassi', 'raita', 'chutney', 'hariyali', 'nalli', 'karela', 'chingri', 'maach', 'sorse', 'kalia', 'aalu', 'aloo', 'gobi', 'sambar', 'garam masala', 'curry leaves', 'turmeric', 'ghee', 'asafoetida', 'hing', 'urad dal', 'chana dal', 'toor dal', 'mustard oil', 'kashmiri', 'aamchur', 'amchur', 'besan', 'chaat masala', 'panch phoron', 'nigella seeds', 'cardamom'],
  'Japanese': ['japanese', 'japan', 'sushi', 'donburi', 'okonomiyaki', 'teriyaki', 'miso', 'mirin', 'wasabi', 'nori', 'dashi', 'bonito', 'shiso', 'shisho', 'sake', 'yuzu', 'panko', 'tempura', 'ramen', 'udon', 'soba', 'hokkaido', 'sashimi', 'tamagoyaki'],
  'Chinese': ['chinese', 'china', 'sichuan', 'szechuan', 'kung pao', 'char siu', 'chinatown', 'bak choy', 'bok choy', 'pak choi', 'hoisin', 'oyster sauce', 'five spice', '5 spice', '5-spice', 'shaoxing', 'star anise', 'sichuan pepper', 'szechuan pepper', 'scallion pancake', 'fried rice', 'black bean sauce', 'doubanjiang', 'dark soy'],
  'Thai': ['thai', 'thailand', 'pad thai', 'larb', 'tom yum', 'green papaya', 'papaya salad', 'fish sauce', 'lemongrass', 'kaffir', 'lime leaves', 'galangal', 'thai basil', 'green curry', 'red curry paste', 'sweet chilli sauce'],
  'Mediterranean': ['mediterranean', 'greek', 'feta', 'haloumi', 'halloumi', 'olive', 'olives', 'tapenade', 'tzatziki', 'farinata', 'oregano', 'sun dried tomatoes'],
  'French': ['french', 'france', 'provencal', 'bourguignon', 'gratin', 'souffle', 'soufflé', 'creme brulee', 'crème brûlée', 'brulee', 'foie gras', 'fois gras', 'duxelles', 'wellington', 'bisque', 'veloute', 'consomme', 'bouillon', 'gruyere', 'comte', 'brie', 'camembert', 'creme fraiche', 'crème fraîche', 'tarragon', 'dijon', 'shallots', 'entrecote', 'entrecôte', 'mousse', 'puree', 'purée', 'confit', 'croque'],
  'Italian': ['italian', 'italia', 'italy', 'pasta', 'spaghetti', 'linguine', 'linguini', 'penne', 'fusilli', 'tagliatelle', 'macaroni', 'lasagna', 'lasagne', 'ravioli', 'raviolis', 'tortellini', 'cannelloni', 'cannoli', 'cannolis', 'gnocchi', 'risotto', 'polenta', 'pizza', 'calzone', 'calzones', 'bruschetta', 'focaccia', 'carpaccio', 'panna cotta', 'tiramisu', 'biscotti', 'pesto', 'parmesan', 'mozzarella', 'burrata', 'ricotta', 'mascarpone', 'prosciutto', 'pancetta', 'limoncello', 'prosecco', 'prosseco', 'alfredo', 'bolognese', 'carbonara', 'arborio'],
  'Continental': ['continental', 'roast', 'roasted', 'steak', 'steaks', 'entrecote', 'ribeye', 'tenderloin', 'venison', 'veal', 'lamb shank', 'rack of lamb', 'liver', 'tongue', 'bone marrow', 'mashed potatoes', 'mash', 'meatloaf', 'pie', 'casserole', 'stuffing', 'gravy', 'juniper', 'pigs in a blanket', 'shepherds pie', 'oysters', 'scotch'],
  'American': ['american', 'usa', 'southern', 'burger', 'burgers', 'hawaiian', 'mac and cheese', 'bbq', 'barbecue', 'lollipops', 'waffles', 'fried chicken', 'buttermilk', 'baby back', 'ribs', 'brownies', 'brownie', 'pancakes', 'nytimes', 'cheesecake', 'peanut brittle', 'maple syrup', 'tacos', 'hasselback', 'cookies', 'banoffe', 'milk punch'],
  'Spanish': ['spanish', 'spain', 'catalan', 'paella', 'tapas', 'chorizo', 'gazpacho', 'patatas', 'serrano', 'manchego', 'sangria', 'smoked paprika', 'espelette'],
  'Middle Eastern': ['middle eastern', 'arabic', 'turkish', 'lebanese', 'persian', 'moroccan', 'babaganouj', 'baba ganoush', 'hummus', 'tahini', 'zaatar', 'sumac', 'pita', 'falafel', 'shakshuka', 'tabbouleh', 'fattoush', 'labneh', 'harissa', 'ras el hanout', 'pomegranate', 'dates'],
  'Asian': ['asian', 'asianized', 'asia', 'korean', 'korea', 'bulgogi', 'kimchi', 'khimchi', 'gochujang', 'vietnamese', 'pho', 'banh mi', 'malaysian', 'indonesian', 'satay', 'rendang', 'lotus root', 'soy sauce', 'soy', 'sesame oil', 'rice vinegar', 'rice noodles', 'tofu', 'edamame', 'sriracha', 'chilli oil', 'peanut sauce', 'coconut milk', 'ginger'],
  'European': ['european', 'europe', 'dutch', 'hollandse', 'danish', 'scandinavian', 'swedish', 'norwegian', 'nordic', 'german', 'austrian', 'swiss', 'belgian', 'british', 'english', 'irish', 'polish', 'hungarian', 'goulash', 'stampot', 'stamppot', 'jagtschotel', 'pastijtje', 'bitterballen', 'grostl', 'gröstl', 'smorrebrod', 'smerbrod', 'herring', 'rye bread', 'sauerkraut', 'frantzen', 'easter', 'gouda', 'red cabbage', 'mustard soup'],
};
const CUISINE_RE = Object.fromEntries(Object.entries(CUISINE_RULES).map(([c, kws]) => [c, kws.map(k => new RegExp('\\b' + norm(k).replace(/\s+/g, '\\s+') + '\\b'))]));

function guessCuisinesRaw(recipe) {
  const title = norm(recipe.title);
  const ings = norm((recipe.ingredients || []).map(i => i.name).join(' , '));
  const body = norm([recipe.method, recipe.notes].join(' '));
  const scores = {};
  for (const [c, res] of Object.entries(CUISINE_RE)) {
    let s = 0, t = 0;
    for (const re of res) { if (re.test(title)) { s += 3; t++; } else if (re.test(ings) || re.test(body)) s += 1; }
    if (s) scores[c] = { s, t };
  }
  // A cuisine named in the title ("Thai green curry", "Indian meatloaf") wins; another cuisine is
  // added only if the title clearly shows it too ("Italian Anda Bhurji").
  const NAMED = { Indian: /\b(indian|india|bengali|gujarati|maharashtrian|kolkata)\b/, Japanese: /\bjapan(ese)?\b/, Chinese: /\bchin(ese|a)\b/, Thai: /\bthai\b/,
    Mediterranean: /\bmediterranean\b/, French: /\bfrench\b/, Italian: /\bital(ian|ia|y)\b/, American: /\bamerican\b/, Spanish: /\b(spanish|catalan)\b/,
    'Middle Eastern': /\b(arabic|turkish|lebanese|middle eastern)\b/, Asian: /\b(asian|asianized|korean)\b/, European: /\b(dutch|danish|scandinavian|german|european|hollandse)\b/ };
  const named = Object.keys(NAMED).filter(c => NAMED[c].test(title) && !(c === 'French' && /french toast/.test(title)));
  if (named.length) {
    const out = named.slice(0, 2);
    const extra = Object.entries(scores).filter(([c, v]) => !out.includes(c) && v.t >= 2 && c !== 'Continental' && c !== 'Asian').sort((a, b) => b[1].t - a[1].t)[0];
    if (extra && out.length < 2) out.push(extra[0]);
    return out;
  }
  // Generic "Asian" and "Continental" signals are weak: only win when nothing more specific does.
  const ranked = Object.entries(scores).sort((a, b) => b[1].s - a[1].s);
  const specific = ranked.filter(([c]) => c !== 'Asian' && c !== 'Continental');
  const out = [];
  for (const [c, v] of specific) {
    if (out.length >= 2) break;
    if (v.t || v.s >= 3) out.push(c);
  }
  if (!out.length && scores['Asian'] && (scores['Asian'].t || scores['Asian'].s >= 3)) out.push('Asian');
  if (!out.length && specific.length && specific[0][1].s >= 2) out.push(specific[0][0]);
  if (!out.length && scores['Continental']) out.push('Continental');
  if (!out.length && scores['Asian']) out.push('Asian');
  // A clearly Asian title ("asianized", "Asian style") adds Asian alongside a European base.
  if (scores['Asian']?.t && !out.includes('Asian') && out.length < 2) out.push('Asian');
  return out;
}

// ---------- Editable lists ----------
// The owner can add or remove choices (More > Meal, course and cuisine). The arrays above are
// updated in place so every screen sees the current lists; guesses never use a removed choice.
export const DEFAULT_LISTS = { mealTypes: [...MEAL_TYPES], courses: [...COURSES], cuisines: [...CUISINES] };
export function setLists(l) {
  for (const [k, arr] of [['mealTypes', MEAL_TYPES], ['courses', COURSES], ['cuisines', CUISINES]])
    if (Array.isArray(l?.[k])) arr.splice(0, arr.length, ...l[k]);
}
export function getLists() { return { mealTypes: [...MEAL_TYPES], courses: [...COURSES], cuisines: [...CUISINES] }; }
export function categorize(recipe) {
  const c = categorizeRaw(recipe);
  return { mealTypes: c.mealTypes.filter(x => MEAL_TYPES.includes(x)), courses: c.courses.filter(x => COURSES.includes(x)) };
}
export function guessCuisines(recipe) { return guessCuisinesRaw(recipe).filter(c => CUISINES.includes(c)); }
