// The quality check (founder, 15 Nov 2026: "personalised suggestion is the
// product"). Runs realistic profiles through the same curation steps as the
// app (lib/server/curate.ts) against made-up places (test mode, ₹0) and
// checks that the picks match what each person chose and never break a
// hard rule. Every change to picks must pass: npm run eval.
//
// Live mode (EVAL_LIVE=1) runs the same profiles on real Google and Gemini
// for a final check before release (about ₹50; ask the founder first). In
// live mode the expectations that name test places are skipped.

import { EMPTY_ANSWERS, QUESTIONS, type Answers } from "@/lib/onboarding";
import { CUISINE_SEARCH, INTEREST_SEARCH, SIDE_SEARCH } from "@/lib/server/catalog";
import { searchCities } from "@/lib/server/cities";
import { curate, pickFrom } from "@/lib/server/curate";
import { mainlyMeat, mainlyNonVeg, popularCap, POPULAR_REVIEWS, type Category, type Taste, type Tweak, type When } from "@/lib/server/picks";
import { readTaste } from "@/lib/server/taste-reader";
import { cuisinesFor, swipeCards } from "@/lib/swipes";
import { readFileSync } from "node:fs";
import { OUT, schemaJson } from "./schema";

const LIVE = process.env.EVAL_LIVE === "1";

type Persona = {
  name: string;
  city: string;
  category: Category;
  when?: When;
  answers: Partial<Answers>;
  yes?: string[];
  lines?: string[];
  loved?: string[]; // places they love, as Feta describes them
  tweaks?: Tweak[];
  note?: string;
  dayPlan?: boolean;
  // Expectations.
  covers?: string[]; // intent ids that must be among the 8
  half?: boolean; // at least half of the 8 are for what they chose
  never?: RegExp; // test place names that must never show
  some?: RegExp; // at least one of these test places must show
  rule?: (name: string, primary: string) => string | null; // a hard rule, checked live too
  min?: number; // at least this many picks
  founder?: RegExp; // test places that are the founder's: up to 3 that fit must show, never more
};

const base: Answers = { ...EMPTY_ANSWERS, distance: "ride_5km", spend: ["level_2", "level_3"], drinks: "sometimes" };
const noBar = (_: string, primary: string) => (/^(bar|pub|night_club|wine_bar|cocktail_bar|brewery)$/.test(primary) ? "a bar for someone who doesn't drink" : null);

const PERSONAS: Persona[] = [
  {
    name: "Founder: vegetarian in Bengaluru, loves Thai and Korean, typed SE Asian",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean", "hole_in_wall"],
    lines: ["Also loves SE Asian"],
    covers: ["cuisine_thai", "cuisine_korean", "said_0"],
    half: true,
    never: /Gangnam BBQ|Kebab|Biryani|Smoke House|Coastal Catch|Wings|Pork/,
    some: /Lemongrass|Seoul Kitchen|Pho Saigon|Burma Lane/,
    rule: (n) => (/bbq|barbecue|kebab|biryani|steak|chicken|mutton|seafood|fish/i.test(n) ? "mainly meat or fish for a vegetarian" : null),
  },
  {
    name: "Curated layer: up to 3 of the founder's places that fit come first, never more",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean"],
    founder: /Go Native|Element Sattvik|Coastal Thali|Tiffin Roastery|Slice Theory|Seoul Kitchen|Gangnam BBQ/,
    covers: ["cuisine_thai", "cuisine_korean"],
    never: /Gangnam BBQ/, // hers, but mainly meat: the diet still wins
  },
  {
    name: "Founder: 4 cuisines ticked and loves cafes: the cafes still shape the first set",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean", "cuisine_italian", "cuisine_south_indian"],
    loved: ["Third Wave Coffee (coffee shop, mid-priced, ★4.5)", "Dyu Art Cafe (cafe, mid-priced, ★4.6)"],
    covers: ["cuisine_thai", "loved_0"],
    half: true,
    some: /Brew Lab|Quiet Pages|Tiffin Roastery/,
  },
  {
    name: "Spend range: only the two priciest levels ticked, so nothing cheap",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything", spend: ["level_4", "level_5"] },
    yes: ["cuisine_south_indian"],
    never: /Vidyarthi Corner|Brahmin Tiffin Room/,
  },
  {
    name: "Vegetarian in London, Thai: strict abroad (no 'not sure' places)",
    city: "London",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai"],
    covers: ["cuisine_thai"],
    never: /Lemongrass|Seoul Kitchen|Chettinad/,
    some: /Baan Siam|Thai Basil|Pho Saigon/,
  },
  {
    name: "Pescatarian in London, Japanese and Middle Eastern",
    city: "London",
    category: "food_drinks",
    answers: { diet: "pescatarian" },
    yes: ["cuisine_japanese", "cuisine_middle_eastern"],
    covers: ["cuisine_japanese", "cuisine_middle_eastern"],
    never: /Smoke House|Wings|Kebab|Pork|Biryani|Gangnam/,
    rule: (n, p) => (/steak|barbecue|chicken|burger/.test(p) || /steak|bbq|kebab|chicken|burger|pork|beef/i.test(n) ? "meat for a pescatarian" : null),
  },
  {
    name: "Italian lover, eats everything: Italian leads but not 8 of 8",
    city: "London",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_italian"],
    covers: ["cuisine_italian"],
    half: true,
  },
  {
    name: "Four cuisines: each gets a spot",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_mexican", "cuisine_japanese", "cuisine_bakery", "cuisine_indo_chinese"],
    covers: ["cuisine_mexican", "cuisine_japanese", "cuisine_bakery", "cuisine_indo_chinese"],
    half: true,
  },
  {
    name: "Small budget: nothing pricey",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything", spend: ["level_1"] },
    yes: ["dressed_up"],
    never: /Gilded Fork|Smoke House|Baan Siam|Sakura|Skyline/,
  },
  {
    name: "Things to do: karaoke, rooftops, board games, sports",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["karaoke", "rooftops", "board_games", "games_sports"], drinks: "love_bars" },
    covers: ["interest_karaoke", "interest_rooftops", "interest_board_games", "interest_games_sports"],
    half: true,
    some: /Mic Drop/,
    never: /Lakeside Karaoke/,
  },
  {
    name: "Things to do, no alcohol: rooftops and comedy, no bars",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["rooftops", "comedy", "hidden_bars", "nightlife"], drinks: "no_alcohol" },
    covers: ["interest_rooftops", "interest_comedy"],
    never: /Hidden Door|Pulse Club|Skyline|Copper Tap/,
    rule: noBar,
  },
  {
    name: "Things to do: loves a pottery studio and a comedy club, one interest (loved places shape to-do too)",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["outdoors"] },
    loved: ["Clay Studio (art studio, ★4.8)", "Laugh Lab (comedy club, ★4.6)"],
    covers: ["interest_outdoors", "loved_0", "loved_1"],
  },
  {
    name: "Quality: never a badly rated place or one with almost no reviews",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_bakery"],
    covers: ["cuisine_bakery"],
    never: /Sad Sweets/,
  },
  {
    name: "Quality, things to do: an address with 2 reviews is not a workshop",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["workshops"] },
    never: /Lakshmi Nilaya/,
  },
  {
    name: "Things to do, one interest: still 8, filled with what's popular nearby",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["art_culture"] },
    covers: ["interest_art_culture"],
    min: 8,
  },
  {
    name: "Things to do, nothing chosen, tonight: evening things, not closed galleries or restaurants",
    city: "Bengaluru",
    category: "experiences",
    answers: {},
    min: 3,
    never: /Tiffin|Vidyarthi|Dosa/,
  },
  {
    name: "Nothing chosen yet: still 8 good places",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    min: 8,
  },
  {
    name: "Typed in You: into pickleball and stand-up (weekend)",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["art_culture"] },
    lines: ["Into pickleball", "Loves stand-up comedy nights"],
    covers: ["interest_art_culture", "said_0", "said_1"],
    some: /Smash Pickleball/,
  },
  {
    name: "Day plan (Calicut-style trip day): sights, not only evening places",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["live_music"] },
    note: "beach and local culture",
    dayPlan: true,
    covers: ["plan_sights", "plan_heritage", "plan_outdoors"],
    some: /Sunset Beach|Old Fort/,
  },
  {
    name: "Day plan food: breakfast and local food as well as favourites",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai"],
    dayPlan: true,
    covers: ["plan_breakfast", "plan_local", "cuisine_thai"],
    some: /Morning Dosa House/,
  },
  {
    name: "Asked in chat: rooftop dinner",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_south_indian"],
    note: "rooftop dinner",
    covers: ["asked", "cuisine_south_indian"],
    some: /Terrace Twelve|Skyline/,
  },
];

async function run(p: Persona) {
  const [city] = searchCities(p.city, 1);
  const taste: Taste = {
    answers: { ...base, ...p.answers },
    lines: p.lines ?? [],
    own: p.lines ?? [],
    yes: p.yes ?? [],
    no: [],
    lovedPlaces: p.loved,
  };
  const extra = await readTaste(taste, city, p.category);
  const found = await curate({
    taste,
    city,
    origin: { lat: city.lat, lng: city.lng },
    category: p.category,
    when: p.when ?? "tonight",
    tweaks: p.tweaks ?? [],
    note: p.note,
    exclude: new Set(),
    needsDiet: p.category === "food_drinks" && ["vegetarian", "vegetarian_eggs", "jain", "vegan"].includes(p.answers.diet ?? ""),
    need: 8,
    rotation: 0,
    extra,
    dayPlan: p.dayPlan,
    favourites: p.founder ? async (pool) => pool.filter((c) => p.founder!.test(c.place.displayName?.text ?? "")).map((c) => ({ ...c, fetaNote: "test" })) : undefined,
  });
  const picked = pickFrom(found, { room: 8, small: false, popularCap: popularCap(taste) });
  const shown = picked.chosen.slice(0, picked.shown);
  const fails: string[] = [];
  const names = shown.map((c) => c.candidate.place.displayName?.text ?? "?");
  const covered = new Set(shown.flatMap((c) => c.candidate.intents ?? []));
  for (const id of p.covers ?? []) if (!covered.has(id)) fails.push(`nothing for ${id}`);
  const explicit = found.intents.filter((i) => i.explicit).map((i) => i.id);
  const isFor = (c: { intents?: string[] }) => (c.intents ?? []).some((id) => explicit.includes(id));
  const forChoices = shown.filter((c) => isFor(c.candidate)).length;
  // Half, or every one that passed the hard filters if there were fewer.
  const available = found.pool.filter(isFor).length;
  if (p.half && forChoices < Math.min(Math.ceil(shown.length / 2), available)) fails.push(`only ${forChoices} of ${shown.length} are for what they chose (${available} passed)`);
  if (!LIVE && p.never) for (const n of names) if (p.never.test(n)) fails.push(`showed ${n}`);
  if (!LIVE && p.some && !names.some((n) => p.some!.test(n))) fails.push(`none of ${p.some.source}`);
  if (p.min && shown.length < p.min) fails.push(`only ${shown.length} picks`);
  for (const c of shown) {
    const why = p.rule?.(c.candidate.place.displayName?.text ?? "", c.candidate.place.primaryType ?? "");
    if (why) fails.push(`${c.candidate.place.displayName?.text}: ${why}`);
    if (taste.answers.diet === "vegetarian" && p.category === "food_drinks" && mainlyNonVeg(c.candidate.place)) fails.push(`${c.candidate.place.displayName?.text}: mainly meat or fish`);
    if (taste.answers.diet === "pescatarian" && mainlyMeat(c.candidate.place)) fails.push(`${c.candidate.place.displayName?.text}: meat`);
  }
  if (new Set(names).size !== names.length) fails.push("a place twice");
  const feta = shown.filter((c) => c.candidate.fetaNote !== undefined).length;
  if (feta > 3) fails.push(`${feta} of the founder's places (at most 3)`);
  if (p.founder && feta < Math.min(3, found.pool.filter((c) => c.fetaNote !== undefined).length)) fails.push(`only ${feta} of the founder's places`);
  // Very popular places beyond the cap only when nothing less known was left.
  const isPopular = (c: { place: { userRatingCount?: number } }) => (c.place.userRatingCount ?? 0) >= POPULAR_REVIEWS;
  const popular = shown.filter((c) => isPopular(c.candidate) && !isFor(c.candidate)).length;
  const lessKnownLeft = found.pool.filter((c) => !isPopular(c) && !shown.some((s) => s.candidate === c)).length;
  if (popular > popularCap(taste) && lessKnownLeft > 0) fails.push(`${popular} very popular places while ${lessKnownLeft} less-known ones were left`);
  const reasons = shown.map((c) => `${c.candidate.place.displayName?.text} [${c.candidate.place.primaryType}${c.candidate.place.servesVegetarianFood === undefined ? ", veg unknown" : ""}] ${(c.candidate.intents ?? []).join(" ")} — ${c.ranked?.because ?? ""}`);
  return { fails, names, forChoices, reasons, missing: picked.missing.map((m) => m.label), searched: found.intents.map((i) => i.query) };
}

// Every choice on screen has search words (lib/server/catalog.ts).
function catalogueGaps() {
  const gaps: string[] = [];
  for (const c of [...cuisinesFor("IN"), ...cuisinesFor("GB")]) if (!CUISINE_SEARCH[c.id]) gaps.push(`cuisine ${c.id}`);
  for (const o of QUESTIONS.find((q) => q.id === "interests")!.options) if (!INTEREST_SEARCH[o.id]) gaps.push(`interest ${o.id}`);
  const notSearched = ["familiar", "new_to_me"]; // novelty only nudges the ranking
  for (const card of swipeCards(base)) if (card.type === "pair") for (const s of [card.a, card.b]) if (!notSearched.includes(s.id) && !SIDE_SEARCH[s.id]) gaps.push(`card side ${s.id}`);
  return gaps;
}

async function main() {
  let failed = 0;
  const gaps = catalogueGaps();
  if (gaps.length) {
    failed++;
    console.log(`✗ Choices with no search words: ${gaps.join(", ")}`);
  } else console.log("✓ Every choice on screen has search words");
  // Admin's database check reads this list; a new migration must be in it.
  if (readFileSync(OUT, "utf8") !== schemaJson()) {
    failed++;
    console.log(`✗ ${OUT} is out of date with the migrations: run npm run schema`);
  } else console.log("✓ The database check knows every migration");
  // EVAL_ONLY="Founder|London" runs just the profiles whose names match (live runs cost money).
  const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY) : null;
  for (const p of PERSONAS.filter((x) => !only || only.test(x.name))) {
    const r = await run(p);
    if (r.fails.length) failed++;
    console.log(`${r.fails.length ? "✗" : "✓"} ${p.name}`);
    console.log(`    searched: ${r.searched.join(" | ")}`);
    console.log(`    picks (${r.forChoices}/${r.names.length} for their choices): ${r.names.join(", ")}`);
    if (LIVE) r.reasons.forEach((x) => console.log(`      · ${x}`));
    if (r.missing.length) console.log(`    said none found: ${r.missing.join(", ")}`);
    for (const f of r.fails) console.log(`    ✗ ${f}`);
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
