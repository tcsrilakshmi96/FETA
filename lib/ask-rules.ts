// What code checks in Ask Feta's answers (app/api/ask/route.ts): only the
// things the chat model kept getting wrong. Kept apart so the quality check
// (npm run eval) can test them without calling the model.

// Whether a reply ends by asking them something, so it needs answers to tap.
export function asksQuestion(reply: string) {
  const sentences = reply.trim().split(/(?<=[.!?])\s+/);
  return /\?["”')]*\s*$/.test(sentences[sentences.length - 1] ?? "");
}

export const MEALS = ["breakfast", "brunch", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
type FoodSearch = { category?: string; note?: string; meal?: string | null; time?: string | null; tweaks?: string[] };

// A date night includes dinner unless they said otherwise (tester, 23 Nov
// 2026: "Both. Saturday. He eats meat and loves craft beer, I'm veg" got two
// breweries and a comedy club). The model is asked for a dinner search; when
// it sends a date's evening without one, its food search is the dinner, or
// a dinner search joins its plan when there is room. talk: what they said
// in this chat, latest last.
export function withDinner<T extends FoodSearch>(searches: T[], talk: string[]): (T & FoodSearch)[] {
  const recent = talk.slice(-4).join(" \n ");
  const date = /\b(date|date night|anniversary|romantic|valentine)\b/i.test(recent);
  const otherwise = /\b(already (ate|eaten|had dinner)|after dinner|had dinner|eaten already|(just|only) (drinks|a drink|dessert|coffee)|no dinner|skip dinner|not hungry)\b/i.test(recent);
  if (!date || otherwise || !searches.length) return searches;
  if (searches.some((s) => s.category !== "experiences" && MEALS.includes(s.meal as Meal))) return searches;
  const food = searches.find((s) => s.category !== "experiences");
  if (food) return searches.map((s) => (s === food ? { ...s, meal: "dinner" } : s));
  return searches.length < 2 ? [{ ...searches[0], category: "food_drinks", meal: "dinner", note: "romantic", time: null, tweaks: [] }, ...searches] : searches;
}

// The words of a chat reply only (founder, 25 Nov 2026: a reply showed
// `<invoke name="x"></invoke>` four times). The model now and then writes
// tool-call markup into its words instead of filling "search"; any tag is
// dropped, and the blank lines it leaves are closed up.
export function plainReply(text: string): string {
  return text
    .replace(/<([a-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?[a-z][\w:-]*\b[^>]*\/?>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// How many days a message asks for ("3 days in Porto", "a week in Japan",
// "two nights in Goa", "a weekend away"), or 0 when it names none. Code's
// own reading of their words, for trips the model talks about without
// making (founder's Opus trial, 25 Nov 2026).
const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
export function tripDays(message: string): number {
  const text = message.toLowerCase();
  if (/\b(long )?weekend (away|trip|getaway)\b|\bweekend in\b/.test(text)) return 2;
  let most = 0;
  for (const m of text.matchAll(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)(?: of)?[ -](days?|nights?|weeks?)\b/g)) {
    const n = /\d/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]];
    most = Math.max(most, m[2].startsWith("week") ? n * 7 : n);
  }
  return most;
}
