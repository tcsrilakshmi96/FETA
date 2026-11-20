// Style (founder, 20 Nov 2026): the 36 styles from her reference workbook,
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

// What to wear: an idea for one outing, pieces named by where they sit on
// the figure so the dots land on the clothes.
export type Outfit = {
  style: string; // a style id from STYLES
  title: string; // "Smart casual"
  big1: string; // "SMART"
  big2: string; // "casual"
  line: string; // one or two plain sentences
  pieces: { top: string; bottom: string; shoes: string };
  chips: string[]; // "Relaxed brewpub", "900 m walk"
};

export type Occasion = "dinner" | "drinks" | "do" | "day";
export const OCCASIONS: { id: Occasion; label: string }[] = [
  { id: "dinner", label: "Dinner" },
  { id: "drinks", label: "Drinks" },
  { id: "do", label: "Something to do" },
  { id: "day", label: "Just a day look" },
];
