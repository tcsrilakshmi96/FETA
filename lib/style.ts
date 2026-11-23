// Style (founder, 20 Nov 2026): the 36 styles from her reference workbook plus Basics,
// each with its illustration (a man and a woman wearing it; which side the
// woman stands on, so "What do you shop for?" shows the right figure), and
// the clothes budget levels per currency. Shared by the phone and the server.

import { formatMoney, spendBounds, type Currency } from "@/lib/currency";

export type Wears = "women" | "men" | "both";
// Where the woman stands in the illustration ("both" when both figures are women).
type Side = "left" | "right" | "both";

export type StyleLens = { id: string; name: string; short: string; big: string; woman: Side };

export const STYLES: StyleLens[] = [
  { id: "minimalist", name: "Minimalist", short: "Minimalist", big: "MINIMAL", woman: "right" },
  { id: "maximalist", name: "Maximalist", short: "Maximalist", big: "MAXIMAL", woman: "right" },
  { id: "preppy", name: "Preppy", short: "Preppy", big: "PREPPY", woman: "right" },
  { id: "ivy", name: "Ivy", short: "Ivy", big: "IVY", woman: "right" },
  { id: "streetwear", name: "Streetwear", short: "Streetwear", big: "STREET", woman: "right" },
  { id: "skatewear", name: "Skatewear", short: "Skatewear", big: "SKATE", woman: "right" },
  { id: "athleisure", name: "Athleisure", short: "Athleisure", big: "SPORT", woman: "right" },
  { id: "gorpcore", name: "Gorpcore", short: "Gorpcore", big: "GORP", woman: "right" },
  { id: "workwear", name: "Heritage workwear", short: "Workwear", big: "WORK", woman: "right" },
  { id: "utility", name: "Military-inspired utility", short: "Utility", big: "UTILITY", woman: "right" },
  { id: "techwear", name: "Techwear", short: "Techwear", big: "TECH", woman: "right" },
  { id: "bohemian", name: "Bohemian", short: "Boho", big: "BOHO", woman: "right" },
  { id: "coquette", name: "Romantic / coquette", short: "Coquette", big: "ROMANCE", woman: "left" },
  { id: "cottagecore", name: "Cottagecore", short: "Cottagecore", big: "COTTAGE", woman: "left" },
  { id: "punk", name: "Punk", short: "Punk", big: "PUNK", woman: "left" },
  { id: "goth", name: "Goth / dark romantic", short: "Goth", big: "GOTH", woman: "left" },
  { id: "grunge", name: "Grunge-inspired", short: "Grunge", big: "GRUNGE", woman: "left" },
  { id: "dark-academia", name: "Dark academia", short: "Dark academia", big: "ACADEMIA", woman: "left" },
  { id: "rockabilly", name: "Rockabilly revival", short: "Rockabilly", big: "ROCKABILLY", woman: "right" },
  { id: "mod", name: "Mod revival", short: "Mod", big: "MOD", woman: "right" },
  { id: "disco", name: "Disco-inspired", short: "Disco", big: "DISCO", woman: "right" },
  { id: "y2k", name: "Y2K revival", short: "Y2K", big: "Y2K", woman: "left" },
  { id: "avant-garde", name: "Avant-garde", short: "Avant-garde", big: "AVANT", woman: "right" },
  { id: "lolita", name: "Japanese Lolita fashion", short: "Lolita", big: "LOLITA", woman: "both" },
  { id: "western", name: "Western-inspired", short: "Western", big: "WESTERN", woman: "right" },
  { id: "tailoring", name: "Classic tailoring", short: "Tailoring", big: "TAILORED", woman: "right" },
  { id: "smart-casual", name: "Smart casual", short: "Smart casual", big: "SMART", woman: "right" },
  { id: "sari", name: "Contemporary sari", short: "Sari", big: "SARI", woman: "both" },
  { id: "kurta", name: "Contemporary kurta", short: "Kurta", big: "KURTA", woman: "right" },
  { id: "modest", name: "Modest dressing", short: "Modest", big: "MODEST", woman: "both" },
  { id: "balletcore", name: "Balletcore", short: "Balletcore", big: "BALLET", woman: "both" },
  { id: "blokecore", name: "Blokecore", short: "Blokecore", big: "BLOKE", woman: "right" },
  { id: "eclectic-grandpa", name: "Eclectic grandpa", short: "Grandpa", big: "GRANDPA", woman: "right" },
  { id: "polished-minimal", name: "Polished minimal", short: "Polished", big: "POLISHED", woman: "left" },
  { id: "egirl", name: "E-girl / e-boy", short: "E-girl", big: "E-GIRL", woman: "left" },
  { id: "indian-fusion", name: "Indian fusion", short: "Fusion", big: "FUSION", woman: "left" },
  // Added by the founder, 20 Nov 2026: plain everyday tees, jeans and layers.
  { id: "basics", name: "Everyday basics", short: "Basics", big: "BASICS", woman: "right" },
];

const BY_ID = new Map(STYLES.map((s) => [s.id, s]));
export const styleById = (id: string) => BY_ID.get(id) ?? null;
export const lookImage = (id: string) => `/style/looks/${id}.jpg`;

// Which half of the illustration to show: the woman, the man, or both.
export function figureHalf(style: StyleLens, wears: Wears): "left" | "right" | "both" {
  if (wears === "both" || style.woman === "both") return "both";
  const man = style.woman === "left" ? "right" : "left";
  return wears === "women" ? style.woman : man;
}

// Clothes budget per piece, separate from eating out: four levels whose
// bounds follow the city's currency, like the food budget does.
const CLOTHES_USD = [30, 80, 200];
const CLOTHES: Record<string, number[]> = {
  INR: [1500, 4000, 10000],
  AED: [100, 300, 800],
  GBP: [25, 70, 180],
  EUR: [30, 80, 200],
  SGD: [40, 110, 270],
  JPY: [4000, 12000, 30000],
};

export function clothesBounds(currency: Currency): number[] {
  if (CLOTHES[currency]) return CLOTHES[currency];
  // Scaled from the US bands by how the food bands compare (close enough).
  const ratio = spendBounds(currency)[2] / spendBounds("USD")[2];
  return CLOTHES_USD.map((b) => {
    const n = b * ratio;
    const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
  });
}

export const BUDGET_LEVELS = ["c1", "c2", "c3", "c4"] as const;
export const BUDGET_NAMES = ["Easy", "Mid", "Treat", "Splurge"];

export function budgetLabels(currency: Currency): string[] {
  const [a, b, c] = clothesBounds(currency);
  const m = (n: number) => formatMoney(n, currency);
  return [`Under ${m(a)}`, `${m(a)} to ${m(b).replace(/^\D+/, "")}`, `${m(b)} to ${m(c).replace(/^\D+/, "")}`, `Over ${m(c)}`];
}

// Brand price feel against the levels ticked: budget ≈ c1, mid ≈ c2, premium ≈ c3, luxury ≈ c4.
const FEEL_LEVEL: Record<string, number> = { budget: 1, mid: 2, premium: 3, luxury: 4 };
export function fitsBudget(priceFeel: string | null, budget: string[]): boolean | null {
  if (!priceFeel || !FEEL_LEVEL[priceFeel] || budget.length === 0) return null;
  const top = Math.max(...budget.map((b) => Number(b.slice(1))));
  return FEEL_LEVEL[priceFeel] <= top;
}

// What to wear (founder, 22–23 Nov 2026, docs/style-spec.md): for one
// outing, 3 complete looks, each from one of their styles (the best fit for
// the outing first). Every piece is named whole and sits in a slot, so the
// lookbook card can number it on the figure and list it beside.
export type Slot = "top" | "layer" | "bottom" | "one-piece" | "shoes" | "extra";
export const SLOTS: Slot[] = ["layer", "top", "one-piece", "bottom", "shoes", "extra"];
export const SLOT_NAME: Record<Slot, string> = { top: "TOP", layer: "LAYER", bottom: "BOTTOM", "one-piece": "ONE-PIECE", shoes: "SHOES", extra: "EXTRA" };
export type Piece = { slot: Slot; name: string };
export type Look = {
  id: string; // stable for the day: the picture is kept under it
  style: string; // a style id from STYLES, one of theirs
  title: string; // "Easy linen evening"
  why: string; // one sentence on why it suits this outing
  pieces: Piece[];
};

// Where the outing is: a plan they chose, or what they said.
export type Where = "day" | "work" | "dinner" | "drinks" | "do" | "else";
export const WHERES: { id: Where; label: string }[] = [
  { id: "day", label: "Just the day" },
  { id: "work", label: "Work" },
  { id: "dinner", label: "Dinner" },
  { id: "drinks", label: "Drinks" },
  { id: "do", label: "Something to do" },
  { id: "else", label: "Somewhere else…" },
];
export type LookFor = {
  key: string; // what the day's set is kept under: "plan:<stops>", "dinner", "else:<words>"
  text: string; // "Dinner at Toit, then drinks · 8 pm", "Dinner tonight"
  where: Where | "plan";
  stops: { name: string; kind: string; time?: string }[];
  walkKm: number | null;
  place?: string; // somewhere else: where
  setting?: string[]; // "Outdoors", "Walking there"
  avoid?: string; // "No heels, no skirts"
  own?: string; // something of their own they're wearing
  tomorrow?: boolean; // after 10 pm, for tomorrow
};

// A piece name that was cut off or trails off (review, 22 Nov 2026: "a
// couple of outfits end mid-phrase", a top ending in "over").
const TRAILING = /\b(over|under|with|and|or|in|of|a|an|the|plus|on|for|to|at|by|from|&)$/i;
export function pieceProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 3) return "empty";
  if (n.length > 48) return "too long";
  if (TRAILING.test(n) || /[,;:(/-]$/.test(n)) return "ends mid-phrase";
  const words = n.split(/\s+/).length;
  if (words > 8) return "too long";
  return null;
}
// A complete outfit: shoes, and a top with a bottom or a one-piece; every
// name whole. Returns what's wrong, or null.
export function lookProblem(l: Look, styles: string[]): string | null {
  if (!styles.includes(l.style)) return "not one of their styles";
  if (!l.title || TRAILING.test(l.title.trim()) || l.title.length > 40) return "title cut off";
  // "Indo Indo Evening" (testers, 23 Nov 2026).
  const words = l.title.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (new Set(words).size < words.length) return "a word repeated in the title";
  if (!l.pieces.some((p) => p.slot === "shoes")) return "no shoes";
  const onePiece = l.pieces.some((p) => p.slot === "one-piece");
  if (!onePiece && !(l.pieces.some((p) => p.slot === "top") && l.pieces.some((p) => p.slot === "bottom"))) return "no top and bottom";
  if (l.pieces.length > 5) return "too many pieces";
  for (const p of l.pieces) {
    const bad = pieceProblem(p.name);
    if (bad) return `"${p.name}" ${bad}`;
  }
  return null;
}
// Two looks too alike: the same pieces reworded is not a new look (review:
// "Constraints held, but the silhouette barely changed").
export function tooAlike(a: Look, b: Look): boolean {
  const words = (l: Look) => new Set(l.pieces.filter((p) => p.slot !== "shoes").flatMap((p) => p.name.toLowerCase().split(/\s+/)).filter((w) => w.length > 3));
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared >= Math.max(3, Math.ceil(Math.min(x.size, y.size) * 0.7));
}
// Pieces in the order they're listed, and where each one's dot sits on a
// standing figure (share of the picture's width and height).
export function orderedPieces(pieces: Piece[]): Piece[] {
  return [...pieces].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
}
export const SLOT_AT: Record<Slot, [number, number]> = { layer: [0.36, 0.36], top: [0.56, 0.27], "one-piece": [0.52, 0.42], bottom: [0.52, 0.62], shoes: [0.52, 0.94], extra: [0.72, 0.5] };

// Where a brand card links (founder, 22 Nov 2026: "dont show brand and link
// to another country"; a tester's Mumbai H&M opened Australia, London Uniqlo
// opened India). The brand's own page for their country first (the research's
// proof of where it sells there), then its main site only when nothing in it
// points at another country, else a search for its store in their country.
const LANGS = new Set(["en", "fr", "de", "es", "it", "pt", "nl", "ar", "ja", "zh", "ko", "sv", "da", "no", "fi", "pl", "tr", "ru", "th", "vi", "id", "ms", "he", "el", "cs", "hu", "ro"]);
const NOT_COUNTRY_TLD = new Set(["co", "io", "me", "ai", "tv", "ly", "fm", "gg", "so", "to", "cc", "ws", "la", "is", "it", "st", "us"]);
function siteName(host: string) {
  const parts = host.replace(/^www\d*\./, "").split(".");
  const n = parts.length;
  if (n >= 3 && parts[n - 1].length === 2 && ["co", "com", "net", "org"].includes(parts[n - 2])) return parts[n - 3];
  return parts[n - 2] ?? parts[0];
}
// The countries a link names (".com.au", "au.", "/en-au/", "/en_in/", "/in/"), lower case.
export function linkCountries(href: string): string[] {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return [];
  }
  const out = new Set<string>();
  const parts = u.hostname.toLowerCase().split(".");
  const tld = parts[parts.length - 1];
  if (tld.length === 2 && !NOT_COUNTRY_TLD.has(tld)) out.add(tld === "uk" ? "gb" : tld);
  if (parts.length > 2 && /^[a-z]{2}$/.test(parts[0]) && !LANGS.has(parts[0]) && parts[0] !== "m") out.add(parts[0] === "uk" ? "gb" : parts[0]);
  for (const seg of u.pathname.toLowerCase().split("/").slice(1, 3)) {
    const m = seg.match(/^([a-z]{2})[-_]([a-z]{2})$/);
    if (m) out.add(m[2] === "uk" ? "gb" : m[2]);
    else if (/^[a-z]{2}$/.test(seg) && !LANGS.has(seg)) out.add(seg === "uk" ? "gb" : seg);
  }
  return [...out];
}
function rightCountry(href: string, country: string) {
  const named = linkCountries(href);
  return named.length === 0 || named.includes(country.toLowerCase());
}
export function shopLink(brand: { name: string; website: string | null; origin_country?: string | null }, market: { presence_url: string | null; presence_ok?: boolean | null }, country: string, countryName: string, wears?: Wears): { href: string; label: string } {
  const own = brand.website ? (() => { try { return siteName(new URL(brand.website).hostname); } catch { return null; } })() : null;
  // Never the other side's page (persona re-test, 23 Nov 2026: a womenswear
  // shopper's Allen Solly link opened men's shirts).
  const p = market.presence_url && !otherSide(market.presence_url, wears) ? market.presence_url : null;
  if (p && market.presence_ok !== false && own) {
    try {
      if (siteName(new URL(p).hostname) === own && rightCountry(p, country)) return { href: p, label: `Shop in ${countryName} ↗` };
    } catch {}
  }
  if (brand.website && rightCountry(brand.website, country) && linkCountries(brand.website).includes(country.toLowerCase())) return { href: brand.website, label: `Shop in ${countryName} ↗` };
  // A site that names no country only for a brand from there: a global
  // brand's plain site sends people to whatever store it guesses (testers,
  // 23 Nov 2026: uniqlo.com opened India for someone in Lisbon).
  if (brand.website && brand.origin_country === country && rightCountry(brand.website, country)) return { href: brand.website, label: `Shop in ${countryName} ↗` };
  return { href: `https://www.google.com/search?q=${encodeURIComponent(`${brand.name} ${countryName} official store`)}`, label: `Find it in ${countryName} ↗` };
}

function otherSide(url: string, wears?: Wears) {
  if (!wears || wears === "both") return false;
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  const men = /(^|[\/_-])(men|mens|man|male|homme|herren|hombre)([\/_.-]|$)/.test(path);
  const women = /(^|[\/_-])(women|womens|woman|female|femme|damen|mujer|ladies)([\/_.-]|$)/.test(path);
  return wears === "women" ? men && !women : women && !men;
}

// A brand's price against their budget (founder, 22 Nov 2026: "brands within
// the budget mentioned"; a tester saw brands over hers, and the review found
// "In your budget" badges no price backed). A price the research found in
// their currency decides: within their top level it's "fits", above it's
// "above". No such price: the research's price level may keep it as a brand
// to explore ("prices not checked"), never with a budget badge; no level
// either, or a level above theirs: "above" (left out).
export type BrandPrice = { fit: "fits" | "explore" | "above"; price: number | null; checked: string | null };
export function brandPrice(market: { price_feel: string | null; sample_price: number | null; sample_currency: string | null; checked_date: string | null }, budget: string[], currency: Currency): BrandPrice {
  const top = budget.length ? Math.max(...budget.map((b) => Number(b.slice(1))).filter(Number.isFinite)) : 4;
  const cap = top >= 4 ? Infinity : clothesBounds(currency)[top - 1];
  // No budget set ("Depends"): the price shows, with no budget claim.
  if (market.sample_price && market.sample_price > 0 && market.sample_currency === currency && !budget.length)
    return { fit: "explore", price: market.sample_price, checked: market.checked_date };
  if (market.sample_price && market.sample_price > 0 && market.sample_currency === currency)
    return { fit: market.sample_price <= cap ? "fits" : "above", price: market.sample_price, checked: market.checked_date };
  const feel = market.price_feel ? FEEL_LEVEL[market.price_feel] : 0;
  return { fit: feel && feel <= top ? "explore" : "above", price: null, checked: null };
}
