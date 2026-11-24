// What a place on Feta's lists (her places, local favourites, Featured in)
// is, from its tags (founder, 24 Nov 2026: Feta used to guess from the name,
// so Tacocina never counted as Mexican). Each list place has several tags in
// Feta's own words ("mexican", "tacos", "live_music", "jazz club").
// listFit: how well it fits what a person wants, to choose which ones to
//   check live (about ₹1.7 each).
// listServes: whether a checked place counts as one of their choices, as a
//   Google type would (audit, 24 Nov 2026: a speakeasy tagged hidden_bars was
//   checked and then dropped, as hidden bars have no Google type).
// Matching is by whole tags and whole words (audit: "steak" counted as tea).
import type { Intent } from "@/lib/server/intents";
import { CUISINE_SEARCH, INTEREST_SEARCH, SIDE_SEARCH } from "@/lib/server/catalog";

// The ids a tag can use so it matches a choice exactly.
export const TAG_IDS = [...new Set([...Object.keys(CUISINE_SEARCH), ...Object.keys(INTEREST_SEARCH), ...Object.keys(SIDE_SEARCH)])].filter((k) => k !== "local");

// Words that say nothing about what a place is.
const SKIP = new Set(["restaurant", "restaurants", "place", "places", "food", "with", "near", "best", "vegetarian", "vegan", "spot", "spots", "something", "good", "nice", "bar", "bars", "club", "venue", "show", "shows", "night"]);
const SURE = 3;

type ListPlace = { name: string; note?: string; tags?: string[] };

const norm = (t: string) => t.toLowerCase().trim().replace(/[\s-]+/g, "_");
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-zÀ-ɏ]{3,}/g) ?? []);
const wanted = (i: Intent) => [...wordsOf(`${i.label} ${i.query}`)].filter((w) => w.length >= 4 && !SKIP.has(w));
const choiceKey = (i: Intent) => i.id.replace(/^(cuisine|interest|side)_/, "");

// A tag that is the choice's id, or one of the Google kinds the catalog
// names for it, as a whole tag or a whole word of one ("pizza" for Italian).
function sureMatch(tags: string[], i: Intent) {
  const whole = new Set(tags.map(norm));
  if (whole.has(choiceKey(i))) return true;
  const types = i.def.types;
  if (!types) return false;
  const alts = types.source.split("|").filter((a) => /^[a-z_]+$/.test(a));
  const parts = new Set([...whole].flatMap((t) => [t, ...t.split("_")]));
  return alts.some((a) => parts.has(a));
}

export function listFit(place: ListPlace, intents: Intent[]) {
  const tags = place.tags ?? [];
  const said = wordsOf(`${place.name} ${place.note ?? ""} ${tags.join(" ")}`);
  let fit = 0;
  for (const i of intents) {
    if (sureMatch(tags, i)) fit += SURE;
    else fit += wanted(i).filter((w) => said.has(w)).length;
  }
  return fit;
}

// The choices a checked list place serves by its tags. A choice Feta has a
// tag id for needs that tag (or its Google kind); anything else (what they
// typed or searched, a loved place's kind) needs every word of it in the
// tags or her note, or in the name for a search.
export function listServes(place: ListPlace, intents: Intent[]) {
  const tags = place.tags ?? [];
  if (!tags.length) return [];
  const pool = wordsOf(`${tags.join(" ")} ${place.note ?? ""}`);
  const named = wordsOf(place.name);
  return intents
    .filter((i) => {
      if (sureMatch(tags, i)) return true;
      if (TAG_IDS.includes(choiceKey(i))) return false;
      const words = wanted(i);
      return words.length > 0 && words.every((w) => pool.has(w) || pool.has(w.replace(/s$/, "")) || (i.source === "asked" && named.has(w)));
    })
    .map((i) => i.id);
}

export function cleanTags(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim().slice(0, 40)).filter(Boolean))].slice(0, 12) : [];
}

// What kind of place they want, as tags a list place mustn't have (founder,
// 24 Nov 2026: "Feta Picks should also match the vibe"; user test: someone
// who said "quiet, elegant places, nothing loud" got a casual chain as a
// Feta Pick, matched on cuisine alone). From their own words, the vibe card
// and skips ("Too loud and crowded"); with nothing said, nothing is ruled out.
const QUIET_WORDS = /\b(quiet|quieter|calm|peaceful|intimate|not loud|nothing loud|no loud|too loud|low[- ]key|serene)\b/i;
const ELEGANT_WORDS = /\b(elegant|classy|upscale|luxur\w*|fine dining|refined|chic|sophisticated|dressed[- ]up)\b/i;
const LIVELY_WORDS = /\b(lively|buzzing|buzzy|party|loud|energetic)\b/i;
const CLASH = {
  quiet: ["buzzing", "night_out", "nightlife", "club", "dancing", "late night", "party", "social", "loud"],
  elegant: ["casual", "hole_in_wall", "fast food", "street_food", "food hall", "pub", "british pub", "dive"],
  casual: ["dressed_up", "fine dining"],
  lively: ["quiet", "quiet_cafe"],
};
export type Vibe = (keyof typeof CLASH)[];
export function vibeOf(taste: { own?: string[]; lines?: string[]; yes?: string[]; no?: string[]; skipped?: string[] }): Vibe {
  const said = [...(taste.own ?? []), ...(taste.skipped ?? [])].join(" · ");
  const lines = (taste.lines ?? []).join(" · ");
  const yes = new Set(taste.yes ?? []);
  const out: Vibe = [];
  if (QUIET_WORDS.test(said) || /Prefers quieter places/.test(lines)) out.push("quiet");
  else if (LIVELY_WORDS.test(said) && !/\bnot (loud|buzzing)\b/i.test(said)) out.push("lively");
  if (ELEGANT_WORDS.test(said) || (yes.has("dressed_up") && !yes.has("hole_in_wall"))) out.push("elegant");
  else if (yes.has("hole_in_wall") && !yes.has("dressed_up")) out.push("casual");
  return out;
}
export function vibeClash(place: { tags?: string[] }, vibe: Vibe) {
  const tags = new Set((place.tags ?? []).map((t) => t.toLowerCase().trim()));
  return vibe.some((v) => CLASH[v].some((t) => tags.has(t)));
}

