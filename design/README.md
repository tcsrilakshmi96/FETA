# Handoff: Feta v1 (mobile web app)

## Overview
Feta is a personal lifestyle companion that learns your taste and gives **3 confident picks** for food, drinks and experiences, each with one line explaining why it suits you. v1 is a friends test (50–100 people) opened from a link on a phone. Mobile web only, no app store.

Core loop: Welcome → Sign in (once) → 6 questions → 10 taste swipes → "Here's what I picked up" → Location → Picks (3) → Details / Save / Skip → Check-in after the outing → better picks. A chat ("Ask", the cheese in the tab bar) lets users tell Feta about trips and company; what it learns is added to their profile, visibly and undoably.

## About the design files
The files in this bundle are **design references built in HTML**: a clickable prototype showing intended look, copy and behaviour. They are **not production code to copy**. Recreate them in the target stack. The repo is currently empty, so choose a fitting stack (suggested: Next.js or Vite + React, TypeScript, CSS modules or Tailwind, deployed as a mobile-first PWA). All data in the prototype is **placeholder**: picks, reviews, cities, hours and photos must come from real APIs (see `DATA_CONTRACT.md`).

Open `prototype/Feta App v2.dc.html` in a browser (keep `support.js` next to it). The list on the left jumps to every screen and state.

## Fidelity
**High fidelity.** Final colours, type, spacing, copy and motion. Recreate pixel-close at a 360–390 px wide viewport. Photos are stock placeholders.

## Non-negotiable rules
1. Never more than **3 picks** at once; every list has a visible end ("That's everything.").
2. Every pick explains itself in **one line** tied to what the user said or swiped ("Because you…").
3. Honest verdicts only: `Worth a detour` · `Good if you're nearby` · `Skip unless…`. No stars.
4. **Google data stays separate.** Live data from Google (open now, hours) sits on its own line, on its own white band, in a plain system font (Roboto/Arial, #3C4043 on #FFFFFF), never in brand colours. Format: `Open now · closes 23:00 · checked just now · Google Maps`. The words "Google Maps" are never restyled or translated. Follow Google Places attribution terms for any Google photos.
5. **Feta Favourite** badge only when earned: ≥3 ratings and ≥70% "Loved it".
6. **Nothing public by default.** Reviews and location are separate consent toggles; withdrawing is as easy as giving.
7. Diet is asked but never shown on anything shareable. Allergies are out of scope; never imply food is "safe".
8. No taste types or labels. The profile is plain, editable lines.
9. No streaks, guilt prompts, invite walls, red discount badges or dark patterns.
10. Thumb-friendly: tap targets ≥ 44 px, primary actions at the bottom. Must work on slow connections (skeletons, small images).

## Screens
Viewport reference 360 × 760. Side padding 22 px (cards 14 px). Radii: cards 30–32, sheets 36, pills 99, inputs 16–18.

1. **Welcome**: full-bleed photo top (inset 8 px, radius 40, bottom 236 px free) with slow Ken Burns zoom; wordmark `feta` (Outfit 600 30); promise `Three picks for tonight, chosen for your taste.` (Outfit 300/500 36). Below: `A few quick questions, ten swipes, then your picks. No sign-up.`, 18+ checkbox, `Let's go` (disabled at 60% opacity until 18+ is ticked).
2. **Sign in + consent** (once, right after Welcome): phone number → 6-digit code → consent toggles (`Use my location`, on; `Show my reviews to others`, off). States: wrong code (`That code didn't match. Check it and try again.`), resend (`Code sent again · resend in 0:30`), declined (`Not now` → continue, toast `No problem. Sign in later from You.`).
3. **Questions (6)**: progress bar (6 segments), ‹ back, Skip, `01 / 06` counter, title (Outfit 300 34), "Why we ask" line, big chips (height 50, radius 99; selected = ink fill, blush text, tick animates in). Continue (rose) is enabled once answered. Q1 diet (single + Halal toggle), Q2 distance, Q3 spend, Q4 who (multi), Q5 drinks, Q6 interests (max 4, `n of 4 picked`).
4. **Taste swipes (10)**: full-bleed photo cards (radius 32), drag with rotation (dx/18 deg), stamps `Yes, me` / `Not me` fade in with drag, throw threshold 80 px. Buttons ✕ / Not sure / ♥. Progress bar in rose, `n / 10`.
5. **Here's what I picked up**: yes-photos fly in and settle in a loose pile (1.1 s, stagger 120 ms), then the heading and 4 removable plain lines, then `Show my picks`.
6. **Location**: why (3 lines), `Use my location` / `Pick a city instead`. States: denied, not covered (`We're not in Évora yet.` + nearest covered cities). **City picker sheet**: search + city list (current marked, uncovered = `Not yet`) → area chips → `Show picks in {area}` / `Anywhere in {city}`.
7. **Picks home**: Tonight / This weekend segmented control (sliding thumb), city pill (opens the city picker), title `Your 3 for tonight` + 3 progress dots. One card visible at a time (360 px tall); the next card fades in only while dragging. On card: type tag (EAT/DRINK/DO/EVENT), name (Outfit 300 32), area · distance, verdict (#FFB020), "Because you…", matched chips. Below the card: Google line, then ✕ · Details · ♥ (54 px), then `Tweak these` (opens a sheet: Somewhere quieter, Cheaper, Closer, Outdoors, Open later, Better for groups, plus free text). Swipe right = save (toast `Saved to Want to try`); swipe left = not for me + optional reason sheet (Too far, Too pricey, Not my vibe, Been there). Tap = details. States: loading (`Finding your 3…`, 3 bars fill in sequence), nothing nearby (2 cards + banner `Here are 2 worth a short ride.`), all swiped (`That's your 3.` + `Show me 3 more`).
8. **Pick details**: hero photo 330 px with dots, ‹ back; type · area · distance; name; verdict (text rose); Feta Favourite badge (saffron) when earned; Google line; `WHY IT'S YOURS`; matched chips; `WHAT TO ORDER` / `HIGHLIGHTS` (3 numbered rows); `WHAT FETA USERS SAID` (first name + when, approved photos). Floating action bar: primary booking CTA, Directions, ♥, Share. States: closed now, sold out (CTA `Join the waitlist`), no reviews.
9. **My lists**: Want to try / Been, each with a personal note. Private by default. Empty state. Ends with `That's everything.`
10. **Profile ("What I think you like")**: plain lines from answers, swipes, check-ins and chat (chat lines tagged `From chat`); Remove → toast `Picks updated`. My reviews, Privacy toggles, policy link, `Delete my data` (confirm inline).
11. **Check-in**: `Did you go?` → Loved it / It was fine / Not for me (/ I didn't go) → one-tap reason → optional text, up to 3 photos (upload progress), `Show my review to others` (off). States: didn't go, uploading, waiting for approval.
12. **Style, coming soon**: blurred fashion collage, `Tell me when it's ready` → `✓ You're on the list`.
13. **Feedback sheet**: from the `Feedback` pill (top-right on every screen): text, attach screenshot toggle, Send, `Thanks. We read every one.`
14. **Review approval (admin)**: founder-only list of pending reviews and photos with Approve / Hide.
15. **Ask (chat overlay)**: opened from the cheese in the centre of the tab bar; grows from the bottom centre (550 ms). Header: cheese + `Ask Feta`, × close, context chip (`Planning: Tokyo · 14–18 Dec`). Messages: assistant = white bubble, user = ink bubble. Rich replies: 3 mini pick cards in a 3-column grid, and an `ADDED TO YOUR PROFILE` card (turquoise tint) with Undo. Quick prompts wrap above the input.

**Tab bar**: floating glass panel (left/right/bottom 14 px, height 62, radius 24, `rgba(255,255,255,.42)`, `backdrop-filter: blur(22px) saturate(1.4)`, soft shadow) over a blush fade. Items: Picks · Lists · Ask (cheese on a butter tile) · Style · You. Active = ink 600 + 4 px rose dot; inactive = 45% ink.

## Interactions and motion
- Easing: enter `cubic-bezier(.2,.9,.2,1)`; spring-back `cubic-bezier(.2,1.25,.35,1)`; press `scale(.88–.96)` with `cubic-bezier(.3,1.6,.5,1)`.
- Card throw: 550–600 ms out, 125–130% translateX + 9–14° rotation.
- Text on the active card rises in (opacity + 16 px, 600–700 ms, 200 ms delay).
- Ken Burns on photos: scale 1.04 → 1.18 over 16 s, alternate.
- Background haze: saffron, turquoise and rose blurred blobs (blur 80–90, opacity .18–.45) drifting over 14–18 s.
- Cheese: gentle float with a small pop every 3.2 s; eyes blink every 4.5 s.
- Respect `prefers-reduced-motion`: drop the drift, Ken Burns and pop.

## State (suggested)
`user { id, phone, consent{location, publicReviews} }`, `answers{diet, halal, distance, spend, who[], drinks, interests[]}`, `swipes[{cardId, verdict: yes|no|unsure}]`, `profileLines[{id, text, source: answers|swipes|checkin|chat, createdAt}]`, `picksSession{tab, city, area, tweak?, picks[3], index, outcomes[]}`, `lists{want[], been[]}` (+ note), `checkins[]`, `reviews[]` (status pending|approved|hidden), `chat{messages[], context{destination, dates, company}}`. Full shapes: `DATA_CONTRACT.md`.

## Design tokens
Colours: Blush `#FFF3EE` (bg) · Ink `#1A1616` · Rose `#FF4F7B` (fills only) · Text rose `#C81E52` (text accents) · Saffron `#FFB020` (verdict on photos, badge, haze) · Turquoise `#2BC4C9` (banners, chat-added card, haze) · White `#FFFFFF` (sheets, Google band) · Google text `#3C4043` · scrim `rgba(26,22,22,.85–.9)` · muted ink `rgba(26,22,22,.45–.7)` · hairline `rgba(26,22,22,.1)`.
Type: **Outfit** only (300 for display, 400 body, 500/600 emphasis). Scale: 42 / 36 / 34 / 32 / 30 / 28 / 26 / 16 / 15 / 14.5 / 14 / 13.5 / 13 / 12.5 / 12 / 11 / 10.5 (labels, letter-spacing .12–.2em, uppercase). Numbers use `font-variant-numeric: tabular-nums`. Display headings use letter-spacing −0.035 to −0.045em and mix 300 with 500 for the key words.
Spacing: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 24 / 28.
Shadows: card `0 18px 40px rgba(120,30,50,.2)`; bar `0 10px 30px rgba(120,30,50,.1)`.

## Assets
- Photos: Unsplash placeholders (hot-linked). **Replace** with real venue photos (Google Places Photos with attribution, or partner photos).
- Cheese mascot: inline SVG in the prototype (search `viewBox="0 0 80 64"`). Export it as a component.
- No icon font; glyphs used: ✕ ♥ ‹ › ↑ ↗ ✓ ★.

## Files
- `prototype/Feta App v2.dc.html`: the full app, every screen and state (primary reference).
- `prototype/support.js`: runtime needed to open the prototype locally.
- `DATA_CONTRACT.md`: data shapes, API sources, and what each screen needs.
- `screenshots/`: 31 PNGs of every screen and state, named in flow order (`01-welcome.png` … `31-admin-review-approval.png`).
- `explorations/`: every earlier design round, for context only (not to build). Start at `Feta Design Index.dc.html`. Rounds 1–9 include taste types and other directions that were later dropped; **`Feta App v2.dc.html` is the source of truth.**
