import "server-only";

import type { City } from "@/lib/cities";
import { track } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import type { Intent } from "@/lib/server/intents";
import type { Category, Taste } from "@/lib/server/picks";

// What people say in their own words ("Also loves SE Asian", "into
// pickleball", "I love Burmese khow suey", lines added in You or learned in
// chat) and the places they love become things to search for, not only
// notes for the ranking (founder, 15 Nov 2026: "that data collection is
// coming to no use"). Gemini reads them, with what the loved places are
// like (read live, never stored), and returns a few Google searches.
// Gemini only sees Feta's own data plus those place descriptions; Venice
// never does. Read once per new search, kept in this server's memory for
// an hour so "Show me more" doesn't pay again.

type Read = { label: string; query: string; from: "said" | "loved" };

const AT_A_BAR = /\b(bar|pub|cafe|café|lounge|karaoke|rooftop|board games?|speakeasy|comedy|jazz|trivia|quiz)\b/i;

const memo = new Map<string, { at: number; reads: Read[] }>();
const HOUR = 3600 * 1000;

export async function readTaste(taste: Taste, city: City, category: Category): Promise<Intent[]> {
  const said = taste.own ?? [];
  const loved = category === "food_drinks" ? (taste.lovedPlaces ?? []) : [];
  if (said.length === 0 && loved.length === 0) return [];
  const key = JSON.stringify([city.id, category, said, loved]);
  const hit = memo.get(key);
  let reads = hit && Date.now() - hit.at < HOUR ? hit.reads : null;
  if (!reads) {
    reads = FAKE ? fakeRead(said, loved, category) : await geminiRead(said, loved, city, category).catch((error) => {
      console.error(error);
      return [] as Read[];
    });
    memo.set(key, { at: Date.now(), reads });
  }
  const food = category === "food_drinks";
  return reads.slice(0, 5).map((r, i) => ({
    id: `${r.from}_${i}`,
    label: r.label,
    reason: r.from === "said" ? `Because you said you love ${r.label.toLowerCase()}.` : "Because it's like the places you love.",
    query: r.query,
    // A thing to do that happens in a bar or café ("karaoke", "board games").
    def: { searches: [r.query], foodDrink: !food && AT_A_BAR.test(r.query) },
    explicit: true,
    source: r.from === "said" ? "typed" : "loved",
    food,
  }));
}

async function geminiRead(said: string[], loved: string[], city: City, category: Category): Promise<Read[]> {
  const what = category === "food_drinks" ? "places to eat or drink" : "things to do (not restaurants)";
  const prompt = `A person in ${city.name}, ${city.countryName} wants ${what}.
${said.length ? `In their own words:\n${said.map((s) => `- ${s}`).join("\n")}\n` : ""}${loved.length ? `Places they love:\n${loved.map((s) => `- ${s}`).join("\n")}\n` : ""}
Turn this into Google Maps searches for ${what} that would find what they'd love, most important first: at most 3 from their own words and at most 2 from the places they love.
- From their own words: only the parts about ${what}; skip anything else. Make vague words specific ("SE Asian" → "southeast asian restaurant", "into pickleball" → "pickleball court").
- From the places they love: what they have in common (cuisine, style, price), as a search for new places like them ("modern south indian cafe"). Never a place's name.
Reply with only JSON: {"reads": [{"label": 1 to 4 words, e.g. "Southeast Asian", "query": the search, "from": "said" or "loved"}]}. [] if nothing fits.`;
  track("gemini_rank");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Gemini read failed: ${res.status}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? "{}";
  const parsed = JSON.parse(text) as { reads?: Partial<Read>[] };
  return (parsed.reads ?? [])
    .filter((r): r is Read => typeof r.label === "string" && typeof r.query === "string" && (r.from === "said" || r.from === "loved"))
    .map((r) => ({ label: r.label.slice(0, 30), query: r.query.slice(0, 80), from: r.from }));
}

// Test mode: their words as the search, without the lead-in (things to do
// only from words that sound like an activity), then the kind of place
// their loved places are ("Brew Lab (coffee shop, mid-priced)").
function fakeRead(said: string[], loved: string[], category: Category): Read[] {
  const doing = /\b(into|play|playing|class|court|music|karaoke|comedy|games?|hike|dance|dancing)\b/i;
  const words = said.filter((s) => category === "food_drinks" || doing.test(s)).map((s) => s.replace(/^(also loves|loves|i love|into|likes)\s+/i, "").trim()).filter(Boolean).map((label) => ({ label, query: category === "food_drinks" ? `${label} restaurant` : label, from: "said" as const }));
  const kinds = [...new Set(loved.map((l) => /\(([^,)]+)/.exec(l)?.[1]).filter((k): k is string => !!k))];
  return [...words, ...kinds.map((k) => ({ label: k, query: k, from: "loved" as const }))];
}
