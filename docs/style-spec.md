# Style: the full spec (founder, 22 Nov 2026)

Everything Style must do, from the founder's feedback, her testers, the UX review and the two-persona review (22 Nov 2026). The mock-up is https://claude.ai/artifact/UUy8nfAqGToqU8iYfKxKFB (page "Style: every flow, every case"); the mock wins for look and flow, this page for logic. "She wants the style section to be a perfect piece": nothing here is optional.

## Look and motion
- The app's own Style look: dark haze, Fraunces with italics, grey stage cards, pink buttons. Never a plain UI.
- Motion from her inspiration videos, all kept: figure between a giant word; pulsing dots on the clothes whose name tags pop up for ~3 s then fade; the depth lineup fanning in; photos and looks dropping onto a swaying clothesline; brand and price tags hanging on a line; looks walking in and out; sheets rising; toasts. Reduced-motion turns it all off.
- The look card stays uncluttered: the big style word sized to fit, the figure, dots, three thin progress bars, "Made by AI". Under it only the look's name, its style, and the pieces as one tappable line.

## Ways in and moving around
- In: Home's Style tile, a plan's "What to wear", a place's details, Ask Feta's "Open in Style".
- Inside Style: Today · Brands · My style switch at the top of every Style screen; "‹ Home" top left, or "‹ Back to your plan" when they came from a plan, or "‹ Back to your look" in Brands opened from a piece. The app's tab bar is unchanged. Sheets close by tapping outside.
- Back never walks through setup steps and never leaves Feta (no browser Back).

## First time (setup, once)
1. Intro: what Style does in three lines (show your style → say where you're going → wear it or find the piece), "Let's start", "Takes about a minute".
2. What do you shop for: Womenswear / Menswear / Both. Asked first; every figure follows it; never guessed from photos.
3. Hang up looks you love (one screen with 2): the clothesline, up to 8 photos, none required; or tap Feta's looks (already showing their figure). Photos: Gemini reads only the clothes, never faces, bodies, age, religion, ethnicity or gender. Looks only: no AI call, free and instant.
4. Your styles: the lineup, remove any (at least one stays), each with why Feta read it (kept for My style); budget per piece in the city's currency.
5. Then straight to Today ("Where are you going?" if there's no plan).
- AI down or credit out: "Couldn't read your photos right now" → pick from Feta's looks. Setup never gets stuck or shows a black screen.
- Leave halfway: what they did is kept; Home's tile says "Finish setting up Style" and opens on that step.
- Optional extras ("Looks on you" photo, brands they love) live in My style, never as hidden setup steps.

## What the look is for (checked in this order)
1. They came from a plan (Plan my evening, a saved plan for today, a place they opened): that plan, its place, time, and the walk between stops.
2. They already chose a look today: Style opens on it ("✓ You're wearing this", Pick a different look).
3. Otherwise ask "Where are you going?": Just the day, Work, Dinner, Drinks, Something to do, Somewhere else (where, outdoors/walking, things to avoid). Optional "Wearing something of your own?". Never guess; never Home's suggested plan.
- After 10 pm (city time): "Tonight, or tomorrow?" first.
- "Change" / "Not this plan?" always available, even from a plan.
- Times, "tonight/today" and the date use the city's time zone, never the phone's; am/pm always shown.
- The outing text has room for a real brief (no 60-character cut).
- Weather: not now.

## The 3 looks
- Look 1 is their style that fits this outing best; looks 2 and 3 the next best, so every style gets a turn. One style: three different takes on it. Each says which style it is.
- Built from their pieces first ("I have one", the wardrobe, what they said they're wearing), loved looks and votes; hard asks (covered shoulders, no heels, keep my boots) always hold.
- Every look is a complete outfit: top (and any layer under it), bottom or one-piece, shoes; every name whole, never cut mid-phrase, never ending in "over". Checked in code; an incomplete one is redone, not shown.
- Looks 2 and 3 must really differ from look 1 (different silhouette), not the same outfit reworded.
- The picture: a realistic AI image of the outfit on one figure of their chosen kind (Both: alternate), labelled "Made by AI", made only when that look comes on screen (about ₹4 each; founder 22 Nov 2026) and kept for the day. Not a cartoon, not product placement. If it can't be made: the style's own photo with the pieces written out, never blank.
- Swipe left or ✕: next look. Swipe right or Wear this: wear it. Only the small ‹ goes back.
- After all 3: "What's off?" (Colours, Fit or shape, Too dressy, Too casual, Costs too much, Just not me) → 3 new looks that fix it, and Feta remembers it; or "Just show 3 more".
- Tap a dot or a piece: I have one like this (kept in every look, added to the wardrobe) · Show me another (only that piece changes) · Where to buy.

## Wear this
- Saved to Looks you wore; "Which of these do you have?" (I have it / Buy ›).
- The plan shows "✓ You're wearing <look>" with its picture; Home's tile shows it until the day ends. Tapping either opens it, with Pick a different look.
- The chosen look stays put: leaving for Brands, My style, Home or closing the app and coming back always restores the same look and the same "dressing for".

## Brands
- Their country only: the link is the brand's store for that country (`brand_markets.presence_url`), never another country's site; a brand with no store there isn't shown ("ships from abroad" left out).
- Within their budget: a brand clearly above it is left out (one they love stays).
- "✓ In your budget · ₹X" only when a real price for that country backs it, with when it was checked; otherwise "Brand to explore · prices not checked", shown after the priced ones and only when research puts it in their range (founder 22 Nov 2026). Never a budget badge from a guess.
- For you: all their styles mixed: ★ Feta Pick first, then ♥ Loved by N Feta users, then brands that fit more of their styles. A chip per style shows only its brands. Homegrown only switch. Find more.
- From a piece: only brands that sell that kind of piece, with "‹ Back to your look".
- Research runs for their styles in their country only, once per country (not once per page load); a round that found nothing is not marked done; out of research budget is said plainly.

## My style (one page, edits in place, "Saved")
You shop · Your styles (with why, ✕, + hang up more looks) · Your wardrobe · Budget per piece · Looks you wore (Wear it again, no new picture) · Brands you love · Looks on you (optional photo, stays on this phone; on a new phone say so once).
- Changing what they shop for switches every figure and look.

## Coming back
- Next day: yesterday's look is in Looks you wore; Style asks where they're going again.
- New phone: pieces come back from their account; "Make the picture again" if the picture was on the other phone.

## AI use and limits
- Every Gemini call counted (`trackGemini`); test accounts (`?qa=1`) use their own pool.
- No AI for: tapping Feta's looks, showing a look already made today, Wear it again, I have one.
- Today's looks are cached for the day per outing, so coming back costs nothing.
- When today's new looks are used up: their go-to style with the pieces written out, "More from <reset in their time zone>". Never a blank screen, never money words.
- Setup says before any questions if today's limit is already used.

## Measure
Track: first look → keep / refine / wear / shopping link; rejects in a row; stale-look returns; incomplete outfits caught; wrong-country or broken links.
