// Live check (founder, 23 Nov 2026: fixes passed on made-up places and
// missed in real cities). Three people on REAL Google data, before a push,
// ONLY with the founder's OK each time (about ₹100–250 a run). Each is a
// fresh ?qa-style test account, deleted at the end.
//   npx next dev -p 3400   (no FAKE_PLACES)   then   npm run live-check
// It prints every pick and fails on what the rules forbid.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const DB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const BASE = process.env.LIVE_BASE ?? "http://localhost:3400";

const CITIES = {
  bengaluru: { id: "gn:1277333", name: "Bengaluru", region: "Karnataka", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 12.97, lng: 77.59 },
  lisbon: { id: "gn:2267057", name: "Lisbon", region: "Lisbon", country: "PT", countryName: "Portugal", timeZone: "Europe/Lisbon", currency: "EUR", lat: 38.72, lng: -9.14 },
  london: { id: "gn:2643743", name: "London", region: "England", country: "GB", countryName: "United Kingdom", timeZone: "Europe/London", currency: "GBP", lat: 51.51, lng: -0.13 },
};

// Names that say a place is mainly about meat or fish (as lib/server/picks.ts).
const NON_VEG = /\b(biryani|kebabs?|chicken|mutton|steak\w*|bbq|barbe?que|butcher|shawarma|churras\w*|rodizio|frango|leit[aã]o|bifanas?|seafood|fish|marisqu\w*|bacalhau|sardinh\w*|yakitori)\b/i;
const NOT_TO_GO = /_store$|travel_agency|tour_agency|meal_delivery|lodging|hotel/;

const PEOPLE = [
  {
    name: "Bengaluru vegetarian, things to do tonight (pottery, live music)",
    city: "bengaluru",
    category: "experiences",
    when: "tonight",
    answers: { diet: "vegetarian", distance: "city", spend: ["level_2", "level_3"], drinks: "sometimes", interests: ["workshops", "class_pottery", "live_music"] },
    swipes: [],
    veg: true,
    wantEvents: true,
  },
  {
    name: "Lisbon vegetarian traveller, food this weekend (local, Italian)",
    city: "lisbon",
    category: "food_drinks",
    when: "weekend",
    answers: { diet: "vegetarian", distance: "city", spend: ["level_2", "level_3"], drinks: "sometimes", interests: [] },
    swipes: ["cuisine_local", "cuisine_italian"],
    veg: true,
  },
  {
    name: "London, Thai and Korean, food tonight",
    city: "london",
    category: "food_drinks",
    when: "tonight",
    answers: { diet: "everything", distance: "ride_5km", spend: ["level_2"], drinks: "love_bars", interests: [] },
    swipes: ["cuisine_thai", "cuisine_korean"],
  },
];

const fails = [];
const tokens = [];

async function account(p) {
  const s = await (await fetch(`${DB}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) })).json();
  const h = { apikey: KEY, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const c = CITIES[p.city];
  await fetch(`${DB}/rest/v1/profiles?id=eq.${s.user.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ is_test: true, first_name: "Livecheck", wants: [p.category === "food_drinks" ? "food" : "do"], city_id: c.id, country: c.country, time_zone: c.timeZone, currency: c.currency }) });
  await fetch(`${DB}/rest/v1/answers`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: s.user.id, halal: false, who: [], avoid: [], spend_currency: c.currency, ...p.answers }) });
  if (p.swipes.length) await fetch(`${DB}/rest/v1/swipes`, { method: "POST", headers: h, body: JSON.stringify(p.swipes.map((card_id) => ({ user_id: s.user.id, card_id, verdict: "yes" }))) });
  tokens.push(s.access_token);
  return s.access_token;
}

const check = (ok, what) => {
  if (!ok) fails.push(what);
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
};

for (const p of PEOPLE) {
  const token = await account(p);
  const c = CITIES[p.city];
  const t = Date.now();
  const res = await fetch(`${BASE}/api/picks`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ category: p.category, when: p.when, origin: { lat: c.lat, lng: c.lng, label: `Anywhere in ${c.name}`, source: "city", city: c } }) });
  let j = await res.json();
  // Events still on their way: ask again, as the phone does.
  if (j.eventsComing) {
    await new Promise((r) => setTimeout(r, 22000));
    j = await (await fetch(`${BASE}/api/picks`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ category: p.category, when: p.when, origin: { lat: c.lat, lng: c.lng, label: `Anywhere in ${c.name}`, source: "city", city: c } }) })).json();
  }
  console.log(`\n${p.name} (${Math.round((Date.now() - t) / 1000)} s)`);
  if (j.banner) console.log(`  banner: ${j.banner}`);
  if (j.notice) console.log(`  notice: ${j.notice}`);
  for (const k of j.picks ?? []) console.log(`  - ${k.event ? `EVENT ${k.event.title} · ${k.event.date} · ${k.event.site}` : `${k.name} (${k.type ?? "?"})`} | ${k.because || (k.fetaNote !== undefined ? "★ Feta Pick" : k.local ? "Local favourite" : k.featured ? `Featured in ${k.featured.guide}` : "— no reason")}`);
  const picks = j.picks ?? [];
  check(picks.length > 0, "has picks");
  check(picks.every((k) => k.event || (k.serves ?? []).length > 0), "every place is for something they chose (no filler)");
  if (p.veg) check(!picks.some((k) => !k.event && NON_VEG.test(k.name)), "no place mainly about meat or fish for a vegetarian");
  if (p.category === "experiences") check(!picks.some((k) => NOT_TO_GO.test(k.type ?? "")), "no shops, offices or hotels in things to do");
  if (p.wantEvents) check(picks.some((k) => k.event), "real events lead things to do");
  check(!picks.some((k) => /\bfood food\b|you love (upscale|fine dining)/i.test(k.because ?? "")), "reasons read right");
}

// Ask Feta on Claude Sonnet 5.5: a date night asks first, with options.
{
  const p = PEOPLE[0];
  const token = tokens[0];
  const c = CITIES[p.city];
  const t = Date.now();
  const r = await (await fetch(`${BASE}/api/ask`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: "Plan my date night this Saturday", origin: { lat: c.lat, lng: c.lng, label: `Anywhere in ${c.name}`, source: "city", city: c } }) })).json();
  console.log(`\nAsk Feta: "Plan my date night this Saturday" (${Math.round((Date.now() - t) / 1000)} s)\n  ${String(r.reply ?? "").slice(0, 300)}`);
  if (r.options?.length) console.log(`  options: ${r.options.join(" / ")}`);
  check(!!r.reply, "Ask Feta answers");
  check(!/\?\s*$/.test(r.reply ?? "") || (r.options ?? []).length > 0, "a question comes with options to tap");
}

for (const token of tokens) await fetch(`${DB}/rest/v1/rpc/delete_my_data`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
console.log(`\nTest accounts deleted (${tokens.length}).`);
console.log(fails.length ? `\n${fails.length} live check(s) failed.` : "\nAll live checks passed.");
process.exit(fails.length ? 1 : 0);
