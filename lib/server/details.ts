import "server-only";

import type { Place } from "@/lib/server/places";

// "What to order" (food and drinks) or "Highlights" (things to do), from
// Gemini with Grounding with Google Maps, which reads the place's reviews.
// Fetched when Details opens and never stored (Google content). Google
// requires the Maps sources to be shown right after this text.

export type PlaceNotes = {
  items: string[];
  sources: { title: string; uri: string }[];
};

type Chunk = { maps?: { uri?: string; title?: string } };

export async function placeNotes(place: Place, kind: "EAT" | "DRINK" | "DO"): Promise<PlaceNotes> {
  const name = place.displayName?.text ?? "this place";
  const ask =
    kind === "DO"
      ? `List the 3 best things about visiting ${name}, from what visitors say on Google Maps. Each at most 60 characters, concrete (what to see or do, best time, what to book).`
      : `List the 3 things people most recommend ordering at ${name}, from Google Maps reviews. Each at most 60 characters: the dish or drink, then a few words on why. Never say anything is safe for a diet or allergy.`;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${ask}\nReply with only the 3 items, one per line, no numbering.` }] }],
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
  const items = text
    .split("\n")
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 3)
    .slice(0, 3);
  const seen = new Set<string>();
  const sources = ((candidate?.groundingMetadata?.groundingChunks ?? []) as Chunk[])
    .map((c) => ({ title: (c.maps?.title ?? "").replace(/ - Google Maps$/, ""), uri: c.maps?.uri ?? "" }))
    .filter((s) => s.uri && !seen.has(s.uri) && seen.add(s.uri))
    .slice(0, 2);
  return { items, sources };
}
