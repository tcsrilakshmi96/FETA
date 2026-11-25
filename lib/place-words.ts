// How a kind of place reads in words, kept apart so the quality check can
// test it (npm run eval).

// "south_indian_restaurant" → "South Indian restaurants"; null for types too
// broad to say no to ("restaurant", "bar").
const BROAD = ["restaurant", "bar", "cafe", "food", "point_of_interest", "establishment", "tourist_attraction", "store", "meal_takeaway"];
// Peoples and places keep their capital (design audit, 25 Nov 2026: "Not
// into portuguese restaurants"): any word that reads as a nationality
// (Peruvian, Burmese, Spanish), plus the few that don't end that way.
const CAPS = ["thai", "greek", "french", "german", "dutch", "swiss", "south", "north", "middle", "eastern", "western", "mediterranean", "basque", "creole", "cajun"];
const NOT_A_PEOPLE = ["vegan", "fish", "pan", "dumpling", "fine"];
const isPeople = (w: string) => CAPS.includes(w) || (/(an|ese|ish|ian)$/.test(w) && !NOT_A_PEOPLE.includes(w));
export function kindOfPlace(type: string | undefined): string | null {
  if (!type || BROAD.includes(type)) return null;
  const words = type.split("_").map((w) => (isPeople(w) ? w[0].toUpperCase() + w.slice(1) : w));
  const last = words.pop()!;
  const plural = /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : /(s|sh|ch|x)$/.test(last) ? `${last}es` : `${last}s`;
  return [...words, plural].join(" ");
}
