// How well a place on Feta's lists (her places, local favourites, Featured
// in) fits what a person wants, before it's checked live (about ₹1.7 each).
// Founder, 24 Nov 2026: Feta used to guess from the name, so Tacocina never
// counted as Mexican. Each list place has several tags in Feta's own words
// ("mexican", "tacos", "live_music", "jazz club"); a tag that is the id of a
// choice (TAG_IDS) or matches the choice's Google kinds is a sure match, and
// the words of what they want in the name, note or tags count too.
import type { Intent } from "@/lib/server/intents";
import { CUISINE_SEARCH, INTEREST_SEARCH, SIDE_SEARCH } from "@/lib/server/catalog";

// The ids a tag can use so it matches a choice exactly.
export const TAG_IDS = [...new Set([...Object.keys(CUISINE_SEARCH), ...Object.keys(INTEREST_SEARCH), ...Object.keys(SIDE_SEARCH)])].filter((k) => k !== "local");

const SKIP = new Set(["restaurant", "place", "places", "food", "with", "near", "best"]);
const SURE = 3;

export function listFit(place: { name: string; note?: string; tags?: string[] }, intents: Intent[]) {
  const tags = (place.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  const said = `${place.name} ${place.note ?? ""} ${tags.join(" ")}`.toLowerCase();
  let fit = 0;
  for (const i of intents) {
    const key = i.id.replace(/^(cuisine|interest|side)_/, "");
    const types = i.def.types;
    if (tags.includes(key) || (types && tags.some((t) => types.test(t.replace(/[\s-]+/g, "_"))))) {
      fit += SURE;
      continue;
    }
    const words = new Set((`${i.label} ${i.query}`.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !SKIP.has(w)));
    fit += [...words].filter((w) => said.includes(w)).length;
  }
  return fit;
}

export function cleanTags(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim().slice(0, 40)).filter(Boolean))].slice(0, 12) : [];
}
