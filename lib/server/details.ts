import "server-only";
import { FAKE } from "@/lib/server/fake-places";

import { track } from "@/lib/server/costs";
import type { Place } from "@/lib/server/places";

// "What to order" (food and drinks) or "Highlights" (things to do), from
// Gemini with Grounding with Google Maps, which reads the place's reviews.
// Fetched when Details opens and never stored (Google content). Google
// requires the Maps sources to be shown right after this text.

export type PlaceNotes = {
  items: string[];
  sources: { title: string; uri: string }[];
  // What reviews say about halal or Jain food, if anything. A signal to
  // show as "Reviews mention…, check with staff", never a guarantee.
  dietSignal?: string;
};

// Who it's for: dishes suggested must fit their diet and drinks.
export type NotesFor = { diet: string | null; halal: boolean; noAlcohol: boolean };

const DIET_RULE: Record<string, string> = {
  vegetarian: "They are vegetarian: suggest only vegetarian dishes (no meat, chicken, fish, seafood or egg).",
  vegetarian_eggs: "They are vegetarian but eat eggs: suggest only vegetarian or egg dishes (no meat, chicken, fish or seafood).",
  jain: "They eat Jain food: suggest only vegetarian dishes without onion, garlic, potato or other root vegetables, and no egg.",
  vegan: "They are vegan: suggest only dishes with no meat, fish, egg, dairy or honey.",
  pescatarian: "They are pescatarian: suggest only vegetarian, fish or seafood dishes (no meat or chicken).",
};

type Chunk = { maps?: { uri?: string; title?: string } };

export async function placeNotes(place: Place, kind: "EAT" | "DRINK" | "DO", who?: NotesFor): Promise<PlaceNotes> {
  if (FAKE) return { items: ["Test mode: no notes"], sources: [] };
  const name = place.displayName?.text ?? "this place";
  const ask =
    kind === "DO"
      ? `List the 3 best things about visiting ${name}, from what visitors say on Google Maps. Each at most 60 characters, concrete (what to see or do, best time, what to book).`
      : `List the 3 things people most recommend ordering at ${name}, from Google Maps reviews. Each at most 60 characters: the dish or drink, then a few words on why. Never say anything is safe for a diet or allergy.${who?.diet && DIET_RULE[who.diet] ? ` ${DIET_RULE[who.diet]} If there aren't 3 such dishes, list fewer.` : ""}${who?.noAlcohol ? " They don't drink alcohol: no alcoholic drinks, and no desserts made with alcohol (like tiramisu)." : ""}`;
  // Halal or Jain: what reviews say, reported as a signal only.
  const signal =
    kind !== "DO" && (who?.halal || who?.diet === "jain")
      ? `\nThen, on a last line starting "DIET:", say in under 80 characters what reviews say about ${who?.halal ? "halal food" : "Jain food"} here (e.g. "Several reviews mention halal-certified meat"), or "DIET: none" if reviews don't mention it. Don't guess.`
      : "";
  track("gemini_maps");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${ask}\nReply with only the items, one per line, no numbering.${signal}` }] }],
      tools: [{ googleMaps: {} }],
      toolConfig: place.location
        ? { retrievalConfig: { latLng: { latitude: place.location.latitude, longitude: place.location.longitude } } }
        : undefined,
      generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Place notes failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text: string = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const lines = text.split("\n");
  const dietLine = lines.find((l) => /^\s*DIET:/i.test(l));
  const dietSignal = dietLine?.replace(/^\s*DIET:\s*/i, "").trim();
  const items = lines
    .filter((l) => l !== dietLine)
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 3)
    .slice(0, 3);
  const seen = new Set<string>();
  const sources = ((candidate?.groundingMetadata?.groundingChunks ?? []) as Chunk[])
    .map((c) => ({ title: (c.maps?.title ?? "").replace(/ - Google Maps$/, ""), uri: c.maps?.uri ?? "" }))
    // One line per place: Google sometimes cites the same place twice.
    .filter((s) => s.uri && !seen.has(s.title.toLowerCase()) && seen.add(s.title.toLowerCase()))
    .slice(0, 2);
  return { items, sources, ...(dietSignal && !/^none\b/i.test(dietSignal) ? { dietSignal: dietSignal.slice(0, 100) } : {}) };
}
