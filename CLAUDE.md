# Feta — project guide for Claude Code

Feta is a personal AI lifestyle companion that learns a person's taste and decides for them: places to eat and drink, things to do, style, and trips. **Personalised curation is the product** (founder, 15 Nov 2026): what people tell Feta must decide what it finds.

This page holds the **current rules only**. The reasons and history behind them are in `docs/decisions.md` (add new decisions there, dated). If the two disagree, this page wins. Designs: `design/README.md`, `design/DATA_CONTRACT.md`, `design/prototype/Feta App v2.dc.html`; the design wins for look, this page for data, privacy and behaviour. Redesign mock (14 Nov 2026): https://claude.ai/artifact/StSCbvNLSQ4uz5LYjHiw4v

## Working with the founder
- Srilakshmi is non-technical. Explain in plain English, one short paragraph at a time. Think about the whole flow and the root cause before building; mock up UX changes first.
- **No stacking.** If a fix needs a special case on top of other logic, the base is wrong: change the base and delete what it replaces.
- **One change per commit.** She tests the whole set together on https://feta-beige.vercel.app (auto-deploys from main), so push when the set is done and tested.
- **Quality check first.** Every change to picks must pass `npm run eval` (realistic profiles against made-up places, ₹0). Add a profile when a tester finds a new kind of miss. A live run (`EVAL_LIVE=1`, about ₹50) only with her OK.
- Ask before adding a paid service, creating accounts, deleting anything, or spending money on tests. Never put keys or secrets in code or commits (`.env.local`, listed in `.env.example`). Migrations go on her clipboard for the Supabase SQL Editor.
- Suggest automations (n8n, Vercel, Claude scheduled tasks) in a line or two when a step could be automated; don't set them up without her go-ahead.

## Stack
Next.js 16 (App Router; `useParams`/`useSearchParams` need `<Suspense>`), Supabase (auth, RLS, Postgres), Vercel. Google Places API (New) for places; Gemini 3.5 Flash ranks places and reads taste; Venice (`claude-haiku-5-5`, `lib/server/venice.ts`) runs the chat. **Venice never receives Google content**; Gemini gets only Feta's own data plus live place descriptions.

## Flow
Welcome (3 cards, 18+ on the last) → `/start` (optional first name; "What do you want from Feta?": Places to eat and drink, Things to do, What to wear, Plan a trip) → `/questions` (at most 4 screens, only for what they chose: basics; places they love, no limit, then "Recommend them to people like you?"; cuisines (up to 4 + Something else) and things to do (+ own words); one vibe card) → `/location` (their location or a city, then area / anywhere) → Home. A trip alone asks no category questions; a category they didn't choose asks its questions the first time it's opened (`components/FirstTime.tsx`). Sign-in (Google) is offered once on Home after the first picks.

Home: date · area, ★ Feta Picks and You buttons, "Hi <name>!", Choose for me (mood: new / usual / surprise), the wanted category as the big tile, the other smaller, Plan my evening, Style, Plan a trip. Tabs: Picks + Style, Saved, Ask (🧀); You from the round button. "How was it?" is a pop-up; 5 tester questions on a second visit.

## How picks work
One path for every caller (Picks, Home, Ask Feta, Plan my evening, trips), in `lib/server/`:
1. **What they want** (`intents.ts`): every choice becomes an intent: what they asked for right now (chat note, tweaks), favourite cuisines (food) or interests (things to do), their own words and what their loved places have in common (`taste-reader.ts`, Gemini, kept in memory an hour), then taste-card sides. Search words and which Google types count as a match live **only** in `catalog.ts`; the eval fails if a choice on screen has no entry.
2. **Find** (`curate.ts`): one Google text search per intent, up to 4 per set (`MAX_SEARCHES`), plus what's popular nearby for food when there's room. If more were chosen, they take turns across sets. One wider search (2× distance) if too few pass.
3. **Hard filters in code** (`picks.ts` `applyHardFilters`): diet, budget, distance, drinks, opening hours, closed, already saved/skipped/been. Never left to the AI.
4. **Rank**: Gemini orders the places for this person and says which intents each "serves" (it can confirm, never add, a match). Test mode uses `fakeRank`.
5. **Keep the promise** (`selectPicks`): each thing they chose gets its best place among the 8 when one passed (even if very popular); one Feta favourite; places for their choices fill at least half; then the ranking. One branch per chain, at most 1–3 very popular places (novelty), a few of one kind at most. Anything chosen that found nothing is said plainly in the banner ("No Korean near you that fits tonight").

Then `engine.ts` adds events (experiences, up to 2), verdicts, reasons ("Because you love Thai & SE Asian food" when Gemini's doesn't fit), stores the set (place IDs and Feta's words only) and builds cards. Sets are reused for 3 h (tonight) / 12 h (weekend), keyed by place **and a taste fingerprint**, so any change in taste searches again; the phone also drops its kept picks (`forgetPicks`).

Rules inside the filters:
- **Vegetarian, veg + eggs, Jain, vegan**: Google's "serves vegetarian food" must be yes; **in India a place with no answer also passes**, with the chip "Veg options · not confirmed, check with staff"; abroad it doesn't. Places mainly about meat or fish never pass (type, name, and Gemini's flag). Never "pure veg"; never say food is safe for a diet.
- **Pescatarian**: places mainly about meat are dropped. **No beef / no pork**: places mainly about it are dropped. Halal can't be checked: a "not confirmed" chip only.
- **No alcohol**: places whose main type is a bar, pub, club or brewery are dropped (a restaurant with a bar is fine).
- **Things to do** never show a place that's mainly for eating or drinking, unless it matched something they're into that happens there (karaoke, rooftops, board games, hidden bars, comedy, live music).
- Spend: levels travel between currencies (`lib/currency.ts`); unknown price passes only for levels 1–3 and "depends". Tonight: open now after 5 pm, else open an hour between 7 and 10 pm today (city time). Weekend: Sat or Sun hours.
- Verdicts: "Good if you're nearby" by default, "Worth a detour" at most once per set, "Skip unless…" for a real, checkable compromise. Chips are written by code from facts.
- Small cities (< 300k) show only real fits; bigger cities fill to 8 honestly.

**Feta Favourites**: the founder's places (`founder_places`, FETA PICK with her note) and places Feta users loved and chose to recommend (`pick_actions.recommend`; `feta_favourites()` puts people with a shared cuisine or interest first; `feta_love_counts()`). Ones found by the search cost nothing; up to 3 founder places (at random) and 2 community places are checked live per new search. The founder's places may come back even if the person has been or saved them; only a skip hides one. The ★ button next to You on Home (`components/FetaStar.tsx`; once a day, when the city has her places, the pill at the top says "★ Feta Picks in <city>" and the star flies into the button) opens polaroids, her note handwritten (`/api/feta-picks`, `components/FetaPicksSheet.tsx`), of her places and favourites from people with a similar taste that fit their diet and budget, nearest first (up to 10 checked live when opened, about ₹20, kept on the phone an hour; closed places say "Closed now"). Cards show "♥ Loved by N Feta users"; never who.

## Ask Feta (chat) and trips
- `app/api/ask/route.ts`: a short brief (who they are, what Feta knows, the current trip, what it can do: search, itinerary of 1–3 days, trip route) and the model talks and decides. Code checks only what the model kept getting wrong: a whole country, more than 3 days, or 2 days or more away from where they are ("3 days in Calicut") is always a route (a second, route-only call if needed); a search of a whole country asks for a city; the same route sent again keeps the trip's progress; day plans for a trip's cities go to its card. The current trip is found from the whole chat, not the last 12 messages. What it learns goes into profile lines (Undo; "Only for this trip").
- Trips (`lib/server/trip.ts`, `/api/trip`, `components/TripCard.tsx`, `/trip/<id>`): route with a two-line story per city (editable; the title follows the nights) → getting around (rough estimates, including getting there from home and back) → hotel budget (asked separately) and 3 stays per city → day plans per city, 3 days per tap near the chosen hotel, kept on the trip. Day plans for chat and trips both use `plan-days.ts` → picks engine in day-plan mode → `itinerary.ts`. Day-plan mode (founder, 16 Nov 2026: Calicut came back all food) also searches the sights (top attractions, history and culture, beach/park/nature) and breakfast and local food, plus one of their own interests for the evening; hours are checked per stop for its own day and time, and asking again finds the same places (no "already shown" exclusion). Day-plan sets are stored apart from everyday picks.

## Learning from people
Profile lines (`profile_lines`): from answers and taste cards, typed in their own words ("Something else", "Anything else", "Tell Feta what you like" on the picks list and in You), learned in chat, from tweaks. Lines in their own words are **searched for**, not only shown to the ranking. Places they've been (Saved → Been, check-ins) with Loved it / Fine / Not for me, how often, and notes feed the taste summary; loved places (latest 3, read live, about ₹1.7 each) shape food searches.

## Google, privacy and cost rules (never break)
- Store only Google place IDs. Show live Google data with the words "Google Maps" unchanged; events show Google's Search chip. Never use Google content to train or test AI models (the eval uses made-up places).
- No scraping of Zomato, District, Swiggy, BookMyShow or Meetup; link out. Published lists only as "Featured in" facts with links.
- 18+ check, itemised consent with a separate location toggle (off by default; "Use my location" turns it on), consent log, one-tap delete, grievance email. Nothing public by default. Diet never appears on anything shareable. No taste types or labels on people. Instagram data stays on the founder's Mac.
- Every record carries city, country, time zone and currency.
- Cost guards: `PICKS_DAILY_LIMIT`, `PICKS_USER_DAILY_LIMIT`, `DAILY_BUDGET_INR` (Vercel); every paid call is counted (`lib/server/costs.ts`). A new food set costs about ₹12–20 (up to 4 Google searches, loved places read live, Gemini); reused sets cost only live re-checks.

## Testing
- `npm run eval`: the quality check (must pass). `FAKE_PLACES=1` dev server: made-up places that look like a real city (`lib/server/fake-places.ts`), fake ranking, no events or photos, ₹0. Chat still calls Venice (a few paise).
- Live Google only when the change depends on real data: one short run, with her OK, and delete test accounts after.

## Not built yet
Reviews with photos and "Show my review to others", the Jain/vegan "N Feta users said it worked" count, admin review approval, Google Maps saved-places import, Style beyond the teaser, a Schedule tab, Plan my evening in the city's time zone when planning a city in another time zone (it uses the phone's clock).
