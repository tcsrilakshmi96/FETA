# Feta

**Fashion, Experience, Travel — all in one.** A personal AI lifestyle companion that learns your taste and decides for you: **3 confident picks for food and drinks, and 3 for experiences**, each with an honest reason.

Live (friends test): **https://feta-beige.vercel.app** · phone-first web app, light and dark mode.

> Status: v1 friends test, November 2026. Built by the founder with Claude Code.
> International from v1 is planned (founder's decision, 11 Nov 2026) and not built yet.

---

## What it does

**Onboarding (about 90 seconds to first picks)**
Welcome (18+) → Continue with Google or "Not now" → city → 6 quick questions (diet, distance, spend in local currency, company, drinks, interests) → 6 taste swipes → "Here's what I picked up" → your location or an area → picks.

**Picks**
- *Tonight* and *This weekend*, in two separate categories: **Food & drinks** (EAT, DRINK) and **Experiences** (DO, plus this week's EVENTs).
- Exactly 3 per category, one card at a time, each with a "Because you…" line, matched facts and an honest verdict: *Good if you're nearby*, at most one *Worth a detour*, and *Skip unless…* for a real compromise.
- **Feta picks**: the founder's own places, with her note, always get a spot when they fit.
- **Tweak these** (cheaper, closer, open later, quieter, outdoors, groups, kids, or your own words), **Show me 3 more**, and **Plan my evening** (dinner plus something nearby, with times that respect opening hours).
- **Details**: photo, live Google Maps line, why it's yours, and *What to order* / *Highlights* read from Google Maps.
- **Send to the group**: a Feta link friends vote on (I'm in / Not this time) without signing up.

**Ask Feta** (the cheese): chat to plan a trip anywhere, change your picks, or ask "why this one?". What it learns goes into your profile straight away, with Undo and "Only for this trip".

**Lists** (Want to try, Been, private notes) · **You** (editable profile lines, answers, city, appearance, consent toggles, privacy, Delete my data) · **Style** (coming-soon teaser) · a **Feedback** button on every screen.

## Rules Feta never breaks

- Diet, budget, distance, alcohol and opening hours are **hard filters in code**, never left to the AI.
- Never claims food is safe for a diet or allergy: Jain, vegan and halal say *"not confirmed, check with staff"*.
- Stores only **Google place IDs**; live Google data is shown on its own line credited to **Google Maps**. Google content is never used to train or test AI.
- No scraping of Zomato, District, Swiggy, BookMyShow or Meetup — link out only.
- Privacy: 18+, itemised consent, location off by default and never stored as a trail, consent log, one-tap delete. Diet never appears on anything shared.

## How it's built

| Part | Tool |
|---|---|
| App | Next.js 16 (App Router), hosted on Vercel (auto-deploys from `main`) |
| Database, sign-in | Supabase (Postgres with row-level security, Google sign-in, anonymous sessions) |
| Places | Google Places API (New): search, live hours, prices, photos |
| Picking and reasons | Gemini 3.5 Flash, with Grounding with Google Maps (details) and Google Search (events) |
| Chat and profile | Venice AI (OpenAI-compatible). **Venice knows the person, Gemini knows the places**: Venice never receives Google content |
| Weekly report | n8n on the founder's Mac: usage counts → Gemini summary → email every Monday |

**How picks work:** one Google search per new set → hard filters in code → Gemini ranks the survivors and writes the reasons → code keeps 3 (at most one very popular place) → only place IDs and Feta's own words are stored. Sets are reused for 3 hours (tonight) or 12 hours (weekend) and re-checked live. Full detail in [`CLAUDE.md`](CLAUDE.md).

**Cost guards:** daily search limits (shared and per person, set in Vercel), set reuse, events shared per area for a few hours, picks and "What to order" kept in the phone's memory while the app is open, a Google Cloud budget alert, and the Monday usage email.

## Project map

```
app/                 screens (one folder per route) and server routes in app/api/
  api/picks          the picks engine endpoint
  api/ask            Ask Feta chat
  api/details        "What to order" / "Highlights"
  api/lists          Want to try / Been
  api/place/[id]     public data for shared links
  p/[id], s/[slug]   shared place page, group vote page
  admin              Feta picks (founder only)
components/          one component (+ .module.css) per screen or sheet
lib/                 client helpers: cities, currency, swipes, plan, sharing, Supabase
lib/server/          server-only: engine, Google Places, events, Gemini details, Venice, taste summary
supabase/migrations/ database changes, run in order in the Supabase SQL editor
design/              approved designs, screenshots and the data contract
```

## Running it locally

1. Node 24 and npm.
2. `cp .env.example .env.local` and fill in the keys (Supabase URL and publishable key, Gemini, Google Places, Venice). **Never commit `.env.local`.**
3. Run each file in `supabase/migrations/` in order in Supabase → SQL Editor.
4. `npm install` then `npm run dev`, and open http://localhost:3000 (phone-sized window works best).

Settings in Vercel: the same keys, plus optional `PICKS_DAILY_LIMIT` (shared, default 150) and `PICKS_USER_DAILY_LIMIT` (per person, default 30).

## Not built yet

International cities and currencies (planned next) · check-in after an outing (Loved it / It was fine / Not for me) and reviews · admin approval for review photos · weekend plan drafted for WhatsApp · Instagram import for Feta picks · usage analytics.

## For contributors (and Claude)

[`CLAUDE.md`](CLAUDE.md) is the source of truth for product decisions, data and privacy rules. [`design/README.md`](design/README.md) is the source of truth for look, copy and flow.
