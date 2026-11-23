// Search (founder, 23 Nov 2026: "if they want to search for a specific
// product we show brands that have that product, in a city a specific
// place, or a specific activity"). One box on Home: a piece of clothing
// leads with brands, anything else with places and things to do; both are
// always offered, so a wrong guess is one tap away. No AI and no cost here.
// Places search goes through the picks engine (`search` in engine.ts);
// pieces are matched against the brand library on the phone (piecesMatch).

export type SearchCategory = "food_drinks" | "experiences";

// Words for clothes, shoes and accessories (singular; plurals are folded).
const CLOTHES = new Set(
  "shirt tshirt tee top blouse tank camisole cami crop sweater jumper cardigan hoodie sweatshirt jacket blazer coat trench parka puffer gilet vest waistcoat dress gown skirt mini midi maxi trouser pant jean denim chino cargo jogger legging short suit tuxedo jumpsuit romper overall kurta kurti saree sari lehenga salwar dupatta sherwani shoe sneaker trainer boot heel sandal loafer flat mule slipper bag handbag tote clutch backpack belt hat cap beanie scarf glove sock tie bra lingerie swimsuit bikini swimwear linen silk satin wool cashmere leather suede corduroy knit knitwear sequin jewellery jewelry earring necklace ring bracelet watch sunglass outfit".split(" "),
);

// Words for food and drink: these search Food & drinks; anything else
// searches Things to do (both lists are one tap apart on the results).
const FOOD = new Set(
  "food eat eats restaurant restaurants cafe cafes coffee tea bar bars pub pubs brewery wine cocktail cocktails beer drinks drink brunch breakfast lunch dinner dessert desserts bakery bakeries cake cakes ice cream gelato pizza pasta sushi ramen burger burgers tapas noodles dumplings dim sum thai indian italian chinese japanese korean mexican vietnamese french spanish greek turkish lebanese burmese ethiopian peruvian biryani dosa idli chaat curry steak seafood vegan vegetarian veg kebab falafel bagel croissant chocolate matcha boba juice smoothie rooftop speakeasy bistro diner izakaya trattoria taverna".split(" "),
);

export const foldSearch = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/t-shirt/g, "tshirt")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// "jeans" → "jean", "dresses" → "dress", "shoes" → "shoe": close enough to match.
const one = (w: string) => (w.length > 4 && /(ss|sh|ch|x)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (t: string) => foldSearch(t).split(" ").filter(Boolean).map(one);

export function guessSearch(typed: string): { clothes: boolean; category: SearchCategory } {
  const w = words(typed);
  return { clothes: w.some((x) => CLOTHES.has(x)), category: w.some((x) => FOOD.has(x) || FOOD.has(`${x}s`)) ? "food_drinks" : "experiences" };
}

// Brands for a piece: every word they typed (but filler) must be in what
// Feta knows about the brand (its name, the research's notes on its range,
// its style). If none has all of them, the ones with the most, said so.
const FILLER = new Set(["a", "an", "the", "for", "with", "and", "in", "to", "buy", "where", "of", "my", "some", "good", "best", "nice", "cheap"]);

export function piecesMatch<T>(cards: T[], typed: string, text: (c: T) => string): { cards: T[]; exact: boolean } {
  const want = [...new Set(words(typed).filter((w) => !FILLER.has(w)))];
  if (!want.length) return { cards: [], exact: false };
  const scored = cards
    .map((c, i) => {
      const have = new Set(words(text(c)));
      return { c, i, n: want.filter((w) => have.has(w)).length };
    })
    .filter((x) => x.n > 0);
  const best = Math.max(0, ...scored.map((x) => x.n));
  return { cards: scored.filter((x) => x.n === best).sort((a, b) => a.i - b.i).map((x) => x.c), exact: best === want.length };
}

// Recent searches, on this phone only (a convenience; nothing is sent).
const RECENT_KEY = "feta.searches";
export function recentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}
export function rememberSearch(typed: string) {
  try {
    const t = typed.trim().slice(0, 80);
    if (!t) return;
    localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5)));
  } catch {
    // Private mode: no recent searches.
  }
}
