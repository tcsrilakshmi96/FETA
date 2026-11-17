import "server-only";

import type { City } from "@/lib/cities";
import { track } from "@/lib/server/costs";
import { CUISINE_SEARCH, INTEREST_SEARCH } from "@/lib/server/catalog";
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

// One JSON answer from Gemini (Feta's own data only, plus place descriptions).
async function askGemini<T>(prompt: string): Promise<T> {
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
  return JSON.parse(text) as T;
}

async function geminiRead(said: string[], loved: string[], city: City, category: Category): Promise<Read[]> {
  const what = category === "food_drinks" ? "places to eat or drink" : "things to do (not restaurants)";
  const prompt = `A person in ${city.name}, ${city.countryName} wants ${what}.
${said.length ? `In their own words:\n${said.map((s) => `- ${s}`).join("\n")}\n` : ""}${loved.length ? `Places they love:\n${loved.map((s) => `- ${s}`).join("\n")}\n` : ""}
Turn this into Google Maps searches for ${what} that would find what they'd love, most important first: at most 3 from their own words and at most 2 from the places they love.
- From their own words: only the parts about ${what}; skip anything else. Make vague words specific ("SE Asian" → "southeast asian restaurant", "into pickleball" → "pickleball court").
- From the places they love: what they have in common (cuisine, style, price), as a search for new places like them ("modern south indian cafe"). Never a place's name.
Reply with only JSON: {"reads": [{"label": 1 to 4 words, e.g. "Southeast Asian", "query": the search, "from": "said" or "loved"}]}. [] if nothing fits.`;
  const parsed = await askGemini<{ reads?: Partial<Read>[] }>(prompt);
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

// "Surprise me" (founder, 17 Nov 2026: "there is really no surprise"):
// kinds of place this person hasn't chosen and probably hasn't tried, but
// would likely love, read from everything they've shared. Each comes with a
// line about why, in Feta's voice. tried: kinds already shown this time.
export type Surprise = { label: string; query: string; why: string };

export async function readSurprise(taste: Taste, city: City, category: Category, tried: string[]): Promise<Surprise[]> {
  if (FAKE) return fakeSurprise(taste, category, tried);
  const what = category === "food_drinks" ? "a place to eat or drink" : "a thing to do (not a restaurant)";
  const chosen = category === "food_drinks" ? taste.yes.filter((y) => y.startsWith("cuisine_")).map((y) => y.slice(8).replace(/_/g, " ")) : taste.answers.interests.map((i) => i.replace(/_/g, " "));
  const prompt = `A person in ${city.name}, ${city.countryName} wants to be surprised tonight with ${what}.
What they chose: ${chosen.join(", ") || "nothing yet"}.
What Feta knows about them: ${[...taste.lines, ...(taste.own ?? [])].slice(0, 20).join("; ") || "little so far"}.
${taste.lovedPlaces?.length ? `Places they love: ${taste.lovedPlaces.join("; ")}.\n` : ""}${taste.places?.lovedNotes.length ? `What they love about places, in their words: ${taste.places.lovedNotes.join(" | ")}.\n` : ""}${tried.length ? `Already suggested, don't repeat: ${tried.join(", ")}.\n` : ""}
Suggest 3 kinds of ${what} they have NOT chosen and probably haven't tried, but would very likely love given their personality, each different. Respect their diet (${taste.answers.diet || "anything"})${taste.answers.drinks === "no_alcohol" ? " and that they don't drink" : ""}.
Reply with only JSON: {"kinds": [{"label": 1 to 4 words, e.g. "Burmese", "query": a Google Maps search, e.g. "burmese restaurant", "why": one warm sentence to them, under 20 words, linking it to what they love, e.g. "You love Thai and quiet cafés, and you've never tried Burmese."}]}`;
  const parsed = await askGemini<{ kinds?: Partial<Surprise>[] }>(prompt);
  return (parsed.kinds ?? [])
    .filter((k): k is Surprise => typeof k.label === "string" && typeof k.query === "string" && typeof k.why === "string")
    .map((k) => ({ label: k.label.slice(0, 30), query: k.query.slice(0, 80), why: k.why.slice(0, 160) }));
}

// Test mode: catalogue kinds they didn't choose, in order.
function fakeSurprise(taste: Taste, category: Category, tried: string[]): Surprise[] {
  const food = category === "food_drinks";
  const ids = food ? Object.keys(CUISINE_SEARCH).filter((id) => !taste.yes.includes(`cuisine_${id}`)) : Object.keys(INTEREST_SEARCH).filter((id) => !taste.answers.interests.includes(id));
  return ids
    .map((id) => ({ label: id.replace(/_/g, " "), query: (food ? CUISINE_SEARCH : INTEREST_SEARCH)[id].searches[0], why: `Something you haven't tried: ${id.replace(/_/g, " ")}.` }))
    .filter((k) => !tried.includes(k.label))
    .slice(0, 3);
}
