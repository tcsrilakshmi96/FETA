# Feta

**Fashion, Experience, Travel — all in one.** A personal AI lifestyle companion that learns your taste and decides for you: places to eat and drink, things to do, and trips, each with an honest reason. The more you share, the more it curates for you.

Live (friends test): **https://askfeta.com** (also feta-beige.vercel.app) · phone-first web app, light and dark mode.

> Status: v1 alpha, November 2026, international from day one. Built by the founder with Claude Code.

---

## What it does

**Onboarding**
Welcome (3 cards, 18+) → your first name and what you want from Feta (places to eat and drink, things to do, what to wear, a trip) → at most 4 question screens, only for what you chose (diet, distance, spend as a range, drinks; places you love; cuisines and things you're into, in your own words too; a vibe card) → your location, a neighbourhood or the whole city → Home.

**Home**
Date and area, the ★ **Feta Picks** button (the founder's places and favourites from people with a similar taste, as polaroids with her handwritten note, nearest first), **Choose for me** (pick a mood: something new, my usual, or surprise me; the cheese rolls and one place fills the screen, swipe for the next), your categories as big photo tiles, Plan my evening, Style and Plan a trip. Pull down for a fresh set (a cheese pull). When friends reply to a plan you shared, the pill at the top says who's in.

**Picks** (Food & drinks, Things to do)
- *Tonight* and *This weekend*, 8 at a time, each with a "Because you…" line, facts and an honest verdict (*Good if you're nearby*, at most one *Worth a detour*, *Skip unless…* for a real compromise).
- Everything you share becomes something Feta searches for, taken in turn: cuisines and interests, your own words, and what the places you love have in common. Food and things to do use exactly the same steps.
- Tweak (cheaper, fancier, closer, open later, quieter, outdoors, groups, kids, or your own words), Show me more, Details (live Google Maps facts, *What to order* / *Highlights*), Let's go (directions, booking, tell your friends).
- **Send to the group**: a Feta link friends answer *In* or *Out* on, without signing up.

**Saved**
*Want to try*, *Been* (Loved it / Fine / Not for me, how often, notes: these shape your next picks) and **Plans**. **Plan a night**: tick 2 to 5 saved places, pick a day and time, and Feta orders them for that day's opening hours (early closers first, dinner last) on the **cheese trail**, with walk or ride times, a plain word when a place doesn't fit, editing, "Room for dessert?", the whole route in Google Maps, Save and Share. Each plan shows **who's in**. The day after, Home asks "How was Saturday?" for every stop.

**Ask Feta** (the cheese): chat to plan a trip anywhere (route, getting around, stays, day plans), change your picks, or ask "why this one?". What it learns goes into your profile, with Undo and "Only for this trip".

**You**: what Feta knows (editable taste lines, the people you go out with, trips, your places) and settings · **Style** (coming-soon teaser) · a **Feedback** button on every screen.

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

**How picks work:** everything the person shared becomes a list of things to look for → up to 4 Google searches per new set (plus what's popular nearby when there's room) → hard filters in code → Gemini ranks the survivors and writes the reasons → code keeps its promises (each thing they chose gets its best place, one Feta favourite, a few very popular places at most) → only place IDs and Feta's own words are stored. Sets are reused for 3 hours (tonight) or 12 hours (weekend) and re-checked live. Full detail in [`CLAUDE.md`](CLAUDE.md).

**Cost guards:** every Google and Gemini call is logged with its estimated price; a daily spending cap and daily search limits (shared and per person, set in Vercel); set reuse, events shared per area for a few hours, picks and "What to order" kept in the phone's memory while the app is open, a Google Cloud budget alert, and the Monday usage email.

## Project map

```
app/                 screens (one folder per route) and server routes in app/api/
  api/picks          the picks engine endpoint
  api/ask            Ask Feta chat
  api/details        "What to order" / "Highlights"
  api/lists          Want to try / Been
  api/night-plan     live hours and locations for Plan a night
  api/surprise       Choose for me → Surprise me
  api/feta-picks     the ★ Feta Picks sheet
  api/trip           trips from Ask Feta
  api/place/[id]     public data for shared links
  p/[id], s/[slug]   shared place page, group vote page
  admin              Feta picks, weekend plans, Instagram import (founder only)
components/          one component (+ .module.css) per screen or sheet
lib/                 client helpers: cities, currency, phone codes, swipes, plan, sharing, Supabase
lib/server/          server-only: engine, Google Places, events, Gemini details, Venice, taste summary, cities, costs
data/cities.json     every city of 15,000+ people (GeoNames), for "type any city"
supabase/migrations/ database changes, run in order in the Supabase SQL editor
design/              approved designs, screenshots and the data contract
```

## Running it locally

1. Node 24 and npm.
2. `cp .env.example .env.local` and fill in the keys (Supabase URL and publishable key, Gemini, Google Places, Venice). **Never commit `.env.local`.**
3. Run each file in `supabase/migrations/` in order in Supabase → SQL Editor.
4. `npm install` then `npm run dev`, and open http://localhost:3000 (phone-sized window works best).

Settings in Vercel: the same keys, plus optional `PICKS_DAILY_LIMIT` (shared, default 600), `PICKS_USER_DAILY_LIMIT` (per person, default 20) and `DAILY_BUDGET_INR` (estimated spend a day, default 170).

City data: `data/cities.json` is built from [GeoNames](https://www.geonames.org) (CC BY 4.0) by `node scripts/build-cities.mjs <folder>`, using `cities15000.txt`, `admin1CodesASCII.txt` and `countryInfo.txt` from download.geonames.org.

## Not built yet

Download my data (needed for EU/UK users) · reviews with photos and admin approval · phone notifications (for replies to a shared plan) · events in Plan a night · Style beyond the teaser · usage analytics.

## For contributors (and Claude)

[`CLAUDE.md`](CLAUDE.md) is the source of truth for product decisions, data and privacy rules. [`design/README.md`](design/README.md) is the source of truth for look, copy and flow.
