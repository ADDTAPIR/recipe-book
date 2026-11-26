// Known ingredients, used to find ingredients mentioned inside free-text recipes
// (many of Andy's Notes recipes are written as prose, not lists).
// Longer names are matched first, so "red chilli flakes" wins over "chilli".
import { norm } from './text.js';

const RAW = `
anchovy, anchovies, apple, apple cider vinegar, apricot, arborio rice, artichoke, asparagus, aubergine, eggplant, avocado,
baby corn, bacon, bacon bits, bak choy, bok choy, pak choi, balsamic vinegar, balsamic, bamboo shoots, banana, banana leaf, barley, barramundi, basil, thai basil, basmati rice, bay leaf, bay leaves,
bean sprouts, beans, black beans, broad beans, butter beans, cannellini beans, green beans, kidney beans, white beans, beef, beef mince, minced beef, ground beef, beef stock, beef tenderloin, beef tongue, beer, beetroot, beets, bell pepper, red pepper, green pepper, yellow pepper, besan, gram flour, chickpea flour,
bitter gourd, karela, black garlic, black pepper, blue cheese, blueberries, bottle gourd, lauki, bouillon, bread, bread crumbs, breadcrumbs, panko, brie, broccoli, brown sugar, brussels sprouts, buckwheat, bulgur, burrata, butter, buttermilk, butternut squash,
cabbage, red cabbage, purple cabbage, white cabbage, savoy cabbage, calamari, squid, capers, cardamom, carrot, carrots, cashews, catfish, cauliflower, cayenne, celery, celeriac, chana dal, chard, cheddar, cheese, cream cheese, goat cheese, feta, haloumi, halloumi, gruyere, comte, emmental, gouda, parmesan, pecorino, mozzarella, ricotta, mascarpone, paneer, monterey jack, cottage cheese,
cherries, cherry tomatoes, chestnuts, chicken, chicken breast, chicken thighs, chicken wings, chicken drumsticks, chicken stock, chicken broth, chickpeas, chick peas, chicory, endive, belgian endive, chilli, chili, chillies, chilies, green chilli, green chillies, red chilli, red chillies, chilli flakes, red chilli flakes, chilli powder, red chilli powder, chilli oil, chilli sauce, sweet chilli sauce, chipotle,
chives, chocolate, dark chocolate, white chocolate, cocoa, chorizo, cilantro, coriander, coriander leaves, coriander seeds, coriander powder, ground coriander, cinnamon, cinnamon sticks, clams, cloves, coconut, coconut milk, coconut cream, desiccated coconut, cod, coffee, espresso, condensed milk, corn, sweetcorn, cornflour, cornstarch, couscous, crab, crab roe, crackers, cranberries, dried cranberries, cream, heavy cream, whipping cream, double cream, sour cream, creme fraiche, cucumber, cumin, cumin seeds, ground cumin, curry leaves, curry powder, custard,
daikon, radish, dates, digestives, dill, duck, duck breast, edamame, soy beans, egg, eggs, egg yolks, egg whites, quail eggs, espelette,
fennel, fennel root, fennel bulb, fennel seeds, fenugreek, methi, figs, dried figs, fish, white fish, fish sauce, fish fillets, five spice, 5 spice, five spice powder, flour, all purpose flour, plain flour, wholewheat flour, rice flour, self raising flour, foie gras, fois gras,
garam masala, garlic, garlic cloves, ghee, gelatine, gelatin, agar agar, ginger, ginger powder, ginger paste, ginger jam, ginger garlic paste, gnocchi, gochujang, grapes, grape jelly, grapefruit, greek yoghurt, greek yogurt, green onions, scallions, spring onions, green papaya, papaya, guava,
ham, hazelnuts, herring, hoisin sauce, honey, horseradish, hummus, ice cream, vanilla ice cream, jaggery, jalapeno, jam, juniper berries,
kale, kimchi, khimchi, kidney, ketchup, lamb, lamb shank, leg of lamb, rack of lamb, lamb mince, minced lamb, langoustine, leeks, leek, lemon, lemon juice, lemon zest, lemongrass, lentils, red lentils, lettuce, lime, lime juice, lime leaves, kaffir lime leaves, liver, chicken liver, lobster, lotus root,
macadamia nuts, mackerel, maple syrup, mango, mangoes, mango pulp, dry mango powder, amchur, aamchur, marmalade, orange marmalade, mayonnaise, mayo, melon, watermelon, milk, coconut water, mint, mint leaves, mirin, miso, molasses, monkfish, mushrooms, button mushrooms, shiitake, mussels, mustard, dijon mustard, mustard oil, mustard seeds, mutton,
naan, noodles, rice noodles, egg noodles, udon, soba, nori, nutmeg, nuts, oats, oatmeal, octopus, okra, olive oil, extra virgin olive oil, olives, onion, onions, red onion, red onions, white onion, white onions, shallots, orange, orange juice, orange peel, oregano, oyster sauce, oysters,
pancetta, panko, paprika, smoked paprika, parsley, parsnip, pasta, spaghetti, linguine, linguini, penne, fusilli, tagliatelle, macaroni, lasagne sheets, ravioli, tortellini, cannelloni, pastry, puff pastry, peaches, peanut butter, peanuts, peanut sauce, pear, pears, peas, green peas, snow peas, pea sprouts, pecans, pepper, peppercorns, sichuan pepper, szechuan pepper, pesto, pickles, pine nuts, pineapple, pistachios, pita, pita bread, pomegranate, pomfret, pork, pork belly, pork ribs, pork tenderloin, pork cheeks, pork knuckles, pork mince, minced pork, ground pork, potato, potatoes, sweet potato, sweet potatoes, prawns, shrimp, shrimps, prosciutto, pumpkin, chinese pumpkin, quinoa,
radicchio, raisins, raita, ramen, raspberries, red wine, red wine vinegar, rhubarb, rice, sushi rice, wild rice, rice vinegar, ricotta, rocket, arugula, rooibos, rosemary, rum, rye bread,
saffron, sage, sago, sabudana, tapioca, salmon, smoked salmon, salt, sea salt, sambar powder, sardines, satay sauce, sauerkraut, sausage, sausages, scallops, sea bass, sesame oil, sesame seeds, black sesame seeds, shallot, sherry, shisho, shiso, sourdough, soy sauce, light soy sauce, dark soy sauce, soy, spinach, sriracha, star anise, steak, ribeye, entrecote, strawberries, stock, sugar, sultanas, sumac, sunflower seeds, sushi,
tabasco, tahini, tamarind, tamarind paste, tarragon, tea, earl grey, earl grey tea, teriyaki sauce, thyme, tofu, tom yum paste, tomato, tomatoes, cherry tomatoes, vine tomatoes, canned tomatoes, tomato paste, tomato puree, tomato sauce, tortilla, tortillas, trout, truffle, tuna, turkey, turmeric, turnip,
urad dal, daal, dal, vanilla, vanilla extract, veal, venison, vinegar, white wine vinegar, walnuts, wasabi, water chestnuts, white wine, wine, worcestershire sauce, yeast, yoghurt, yogurt, curd, zucchini, courgette, zucchini flowers, courgette flowers, whiskey, whisky, vodka, gin, brandy, cognac, port, sake, lager, ale, cider, egg noodles, semolina, suji, rava, poha, flattened rice, idli rice, dosa batter, mustard greens, spring roll sheets, wonton wrappers, filo pastry, phyllo, shortcrust pastry, biscuits, cookies, sponge, lady fingers, dates syrup, golden syrup, treacle, icing sugar, caster sugar, baking powder, baking soda, bicarbonate of soda, cream of tartar, almond, almonds, ground almonds, almond flour, blue cheese, gorgonzola, roquefort, stilton, camembert, labneh, kefir, lard, suet, bone marrow, oxtail, pork chops, lamb chops, chicken legs, whole chicken, turkey breast, quail, pigeon, rabbit, goose, pheasant, halibut, haddock, hake, sole, plaice, tilapia, rohu, hilsa, carp, tilapia, swordfish, eel, caviar, roe, lotus seeds, makhana, jackfruit, plantain, yam, taro, cassava, okra, drumsticks, ash gourd, snake gourd, ridge gourd, ivy gourd, tindora, raw mango, kokum, asafoetida, hing, nigella seeds, kalonji, carom seeds, ajwain, poppy seeds, panch phoron, kasuri methi, garam masala, chaat masala, kashmiri chilli, mace, allspice, cloves, black cardamom, bay leaves, curry paste, green curry paste, red curry paste, coconut oil, vegetable oil, sunflower oil, peanut oil, rapeseed oil, avocado oil, truffle oil, butter beans, lima beans, black eyed peas, lentil, mung beans, moong dal, toor dal, masoor dal, kidney beans, rajma, baked beans, polenta, cornmeal, farro, spelt, rye, millet, brown rice, jasmine rice, glutinous rice, risotto rice, vermicelli, glass noodles, bread rolls, baguette, ciabatta, focaccia, brioche, croissant, bagel, english muffin, crumpet, rusks, tortilla chips, crisps, popcorn, marshmallows, caramel, dulce de leche, nutella, maple syrup, agave, stevia, coffee beans, matcha, green tea, chai, cardamom pods, saffron threads, rose water, kewra, orange blossom water, lemon curd, quince, plums, prunes, apricots, mango chutney, tomato chutney, coriander chutney, mint chutney, tamarind chutney, pickle, achar, chilli pickle, kimchi, gherkins, cornichons, capers, olives, sun dried tomatoes, artichoke hearts, roasted peppers, pimientos, jalapenos, harissa, ras el hanout, zaatar, dukkah, berbere, cajun, jerk seasoning, old bay, herbes de provence, italian herbs, mixed herbs, dried herbs, fresh herbs, herbs, microgreens, watercress, cress, sorrel, purslane, lovage, chervil, lemon verbena, curry leaf, betel leaf, pandan, galangal, kaffir lime, turmeric root, fresh turmeric, horseradish, wasabi, tobiko, bonito flakes, kombu, dashi, mirin, sake, shaoxing wine, rice wine, black vinegar, chinkiang vinegar, doubanjiang, chilli bean paste, black bean sauce, sweet bean sauce, xo sauce, char siu sauce, plum sauce, oyster mushrooms, enoki, king oyster mushrooms, porcini, chanterelles, morels, truffles, bitterballen, frikandel, stroopwafel, speculaas, gouda, edam, leerdammer, boerenkool, hutspot, endives, witlof, hollandse garnalen, grey shrimp, herring, mackerel, eel, mussels, oysters, lobster, crayfish, scampi, langoustines, tiger prawns, king prawns
`;

const SEEN = new Set();
export const INGREDIENT_VOCAB = RAW.split(',').map(s => norm(s)).filter(s => s && !SEEN.has(s) && SEEN.add(s))
  .sort((a, b) => b.length - a.length);

// Names we prefer to show when several spellings mean the same thing.
const DISPLAY = { 'chilies': 'chillies', 'chili': 'chilli', 'fois gras': 'foie gras', 'shrimps': 'shrimp', 'khimchi': 'kimchi', 'chick peas': 'chickpeas', 'linguini': 'linguine' };

// Words that, right before an ingredient, are part of a different thing (e.g. "chilli oil" handled by vocab;
// "ginger powder" is in vocab). We only need to avoid matching inside other words.
export function extractIngredients(text) {
  let t = ' ' + norm(text) + ' ';
  const found = [];
  for (const v of INGREDIENT_VOCAB) {
    const base = v.length > 4 ? v.replace(/(?<!s)(es|s)$/, '') : v;
    const re = new RegExp('\\s' + base.replace(/\s+/g, '\\s+') + '(?:s|es)?(?=\\s)', 'g');
    if (re.test(t)) {
      found.push({ name: DISPLAY[v] || v, pos: t.search(re) });
      // Remove matched text so "red chilli flakes" isn't also counted as "chilli".
      t = t.replace(re, ' | ');
    }
  }
  // Keep order of first appearance; drop near-duplicates (onion vs onions).
  const out = [], keys = new Set();
  for (const f of found.sort((a, b) => a.pos - b.pos)) {
    const k = f.name.replace(/(es|s)$/, '');
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(f.name);
  }
  return out;
}
