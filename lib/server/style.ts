import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { trackGemini, type Sku } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { SLOTS, STYLES, lookProblem, orderedPieces, pieceProblem, styleById, tooAlike, type Look, type LookFor, type Piece, type Slot, type Where, type Wears } from "@/lib/style";

// Style's three AI steps (founder, 20 Nov 2026), all through Gemini with
// Feta's own data only. Photos are read or drawn and never stored:
// - readPhotos: up to 8 inspiration photos → their styles, from the clothes
//   alone (never age, religion, ethnicity, body, income or gender).
// - makeLooks: 3 complete looks for one outing (swapPiece changes one piece).
// - lookPicture: a realistic picture of one look, about ₹4, when it's shown.

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

type Lens = { style_id: string; name: string; definition: string; visible_signals: string; keep_separate: string | null };

async function lenses(db: SupabaseClient): Promise<Lens[]> {
  const { data } = await db.from("style_lenses").select("style_id, name, definition, visible_signals, keep_separate");
  return (data as Lens[] | null) ?? [];
}

async function gemini(sku: Sku, model: string, parts: object[], generationConfig: object, timeoutMs: number) {
  const res = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini ${model} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  trackGemini(sku, data);
  return data;
}

const textOf = (data: { candidates?: { content?: { parts?: { text?: string }[] } }[] }) => data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "{}";

// "data:image/jpeg;base64,…" → Gemini's inline image.
function inline(dataUrl: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Not an image");
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

// Each photo read on its own (what Feta saw, which styles), then the styles
// across all of them with the photos each came from, so the person can see
// why (founder, 20 Nov 2026: "I couldn't relate… I don't understand how it
// is interpreting the style").
export type StyleRead = {
  photos: { saw: string; styles: string[] }[];
  styles: { id: string; why: string; photos: number[] }[];
};

export async function readPhotos(db: SupabaseClient, photos: string[], wears: Wears): Promise<StyleRead> {
  if (FAKE)
    return {
      photos: photos.map((_, i) => ({ saw: ["Puffer jacket, cargo trousers", "Blazer, loose trousers", "Baby tee, low-rise jeans"][i % 3], styles: [["streetwear"], ["smart-casual"], ["y2k"]][i % 3] })),
      styles: [
        { id: "streetwear", why: "Relaxed layers and cargo trousers", photos: photos.map((_, i) => i).filter((i) => i % 3 === 0) },
        { id: "smart-casual", why: "Crisp shirts and loose trousers", photos: photos.map((_, i) => i).filter((i) => i % 3 === 1) },
        { id: "y2k", why: "Baby tees and low-rise denim", photos: photos.map((_, i) => i).filter((i) => i % 3 === 2) },
      ].filter((x) => x.photos.length),
    };
  const all = await lenses(db);
  const prompt = `You are Feta's stylist. These ${photos.length} photos (numbered 1 to ${photos.length} in order) are outfits a person loves: screenshots or their own. They shop for ${wears === "both" ? "womenswear and menswear" : wears === "women" ? "womenswear" : "menswear"}.
Read ONLY the clothes: silhouette, fabric, colour, pattern, details, how pieces are put together. Never guess or mention anyone's age, religion, ethnicity, body, size, looks, income or gender.

Styles (use the id). Styles overlap; a photo can show more than one.
${all.map((l) => `- ${l.style_id}: ${l.name}. ${l.definition} Looks like: ${l.visible_signals}`).join("\n")}

Be true to what people would recognise in themselves. Everyday outfits are usually basics, smart-casual, minimalist, polished-minimal, streetwear or athleisure; name a niche aesthetic (coquette, dark-academia, y2k, goth, cottagecore…) only when its signals are clearly there, never from one detail.

Reply with only JSON:
{"photos": [one per photo, in order: {"saw": what the outfit is, at most 8 plain words, e.g. "Oversized blazer, white tee, straight jeans", "styles": 1 or 2 style ids}],
 "styles": [the 2 to 5 styles that run through these photos, strongest first: {"id", "why": what they have in common, at most 8 words, "photos": the photo numbers that show it}]}
A photo with no clear outfit: {"saw": "No clear outfit", "styles": []}.`;
  const data = await gemini("gemini_vision", "gemini-3.5-flash", [{ text: prompt }, ...photos.slice(0, 8).map(inline)], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } }, 40000);
  const parsed = JSON.parse(textOf(data)) as { photos?: { saw?: string; styles?: string[] }[]; styles?: { id: string; why?: string; photos?: number[] }[] };
  const seen = new Set<string>();
  return {
    photos: photos.map((_, i) => {
      const p = parsed.photos?.[i];
      return { saw: String(p?.saw ?? "").slice(0, 80), styles: (p?.styles ?? []).filter((id) => styleById(id)).slice(0, 2) };
    }),
    styles: (parsed.styles ?? [])
      .filter((x) => styleById(x.id) && !seen.has(x.id) && seen.add(x.id))
      .slice(0, 5)
      .map((x) => ({ id: x.id, why: String(x.why ?? "").slice(0, 80), photos: (x.photos ?? []).map((n) => Number(n) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < photos.length) })),
  };
}

// Which figure a look shows (tester, 22 Nov 2026: the drawing picked a man
// or a woman whatever they chose). "Both" takes turns by look.
export function figureFor(wears: Wears, seed = ""): "man" | "woman" {
  return wears === "men" ? "man" : wears === "women" ? "woman" : [...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 ? "man" : "woman";
}

// A look's picture (founder, 22 Nov 2026: "it can just look real", not a
// drawing or product placement): a realistic full-length photo of one
// person of the kind they shop for wearing exactly these pieces, on the
// lookbook's plain grey. On them when they added their photo in My style.
// Made only when the look comes on screen, about ₹4 (founder, 22 Nov 2026).
export async function lookPicture(look: Look, wears: Wears, photo: string | null): Promise<string> {
  if (FAKE) throw new Error("No pictures in test mode");
  const who = photo
    ? "the person in the image (keep them recognisably themselves: face, skin tone, hair and body exactly as in their photo; never slim, lighten, beautify or change their body or features)"
    : `one ${figureFor(wears, look.id)}, an ordinary adult, natural and relaxed`;
  const prompt = `A realistic fashion lookbook photograph of ${who}, full length from head to toe, standing, facing the camera, centred, alone, on a plain light grey studio background (#dcdbd7), soft even light.
They wear exactly this outfit, "${look.title}": ${orderedPieces(look.pieces).map((p) => `${p.slot}: ${p.name}`).join("; ")}. Nothing else that stands out.
Real fabric and fit, like a brand's lookbook. No text, no logos, no other people, no props.`;
  const parts = photo ? [{ text: prompt }, inline(photo)] : [{ text: prompt }];
  const data = await gemini("gemini_image", "gemini-3.1-flash-image", parts, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } }, 60000);
  const part = data.candidates?.[0]?.content?.parts?.find((p: { inline_data?: unknown; inlineData?: unknown }) => p.inline_data || p.inlineData);
  const img = part?.inline_data ?? part?.inlineData;
  if (!img?.data) throw new Error("No picture came back");
  return `data:${img.mime_type ?? img.mimeType ?? "image/png"};base64,${img.data}`;
}

// Where each piece is in the picture, so the numbered dots sit on the
// clothes (testers, 23 Nov 2026: dots on the wrong pieces, lines crossing).
// One small look at the picture, about ₹0.1; none if it fails.
export async function findSpots(image: string, pieces: Piece[]): Promise<([number, number] | null)[] | null> {
  const prompt = `This is a full-length photo of one person. For each numbered piece of clothing, give the point at the centre of where it shows in the photo, as fractions of the image's width and height (x 0 = left edge, 1 = right edge; y 0 = top, 1 = bottom).
${pieces.map((p, i) => `${i + 1}. ${p.slot}: ${p.name}`).join("\n")}
A piece you can't clearly see in the photo (a small necklace, a bag that isn't there) is null: never guess a spot.
Reply with only JSON: {"spots": [[x, y] or null, ...]} in the same order, one per piece.`;
  const data = await gemini("gemini_rank", "gemini-3.5-flash", [{ text: prompt }, inline(image)], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 15000);
  const o = JSON.parse(textOf(data)) as { spots?: unknown };
  const spots = Array.isArray(o.spots) ? o.spots : [];
  const ok = spots.length === pieces.length && spots.every((x) => x === null || (Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number" && v >= 0 && v <= 1)));
  return ok ? (spots as ([number, number] | null)[]) : null;
}

export type LookAsk = {
  styles: string[]; // theirs, strongest first
  wears: Wears;
  for: LookFor;
  city: string;
  localTime: string; // "Sunday 7:40 pm", the city's
  count: number; // 3, or 1 for Ask Feta
  wardrobe: string[]; // pieces they have ("I have one")
  usuals: string[]; // brands they shop from
  cues: string[]; // what Feta saw in outfits they love
  worn: string[]; // looks they chose before
  off: string[]; // what was off before ("Too dressy")
  avoid: string[]; // looks already shown for this outing
  note?: string | null; // anything else they said (Ask Feta)
};

const WHERE_WORDS: Record<Where, string> = { day: "an everyday day: errands, coffee, whatever comes up", work: "a day at work", dinner: "going out for dinner", drinks: "going out for drinks", do: "going out to do something", else: "somewhere they describe" };

function forText(f: LookFor) {
  if (f.where === "plan") return `Their plan${f.tomorrow ? " for tomorrow" : ""}: ${f.stops.map((s) => `${s.time ? `${s.time} ` : ""}${s.name} (${s.kind})`).join(", then ")}.${f.walkKm ? ` About ${f.walkKm.toFixed(1)} km on foot between stops.` : ""}`;
  return [
    `They are ${WHERE_WORDS[f.where]}${f.tomorrow ? ", tomorrow" : ""}.`,
    f.place ? `Where: ${f.place}.` : "",
    f.setting?.length ? `It's: ${f.setting.join(", ").toLowerCase()}.` : "",
    f.avoid ? `They want to avoid: ${f.avoid}.` : "",
  ].filter(Boolean).join(" ");
}

const slotOf = (x: unknown): Slot | null => (SLOTS.includes(String(x) as Slot) ? (String(x) as Slot) : null);

function parseLooks(text: string, ask: LookAsk): Look[] {
  const parsed = JSON.parse(text) as { looks?: { style?: string; title?: string; why?: string; pieces?: { slot?: string; name?: string }[] }[] };
  return (parsed.looks ?? []).map((l, i) => ({
    id: `${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`,
    style: String(l.style ?? ""),
    title: String(l.title ?? "").trim(),
    why: String(l.why ?? "").trim().slice(0, 220),
    pieces: (l.pieces ?? []).map((p) => ({ slot: slotOf(p.slot), name: String(p.name ?? "").trim() })).filter((p): p is Piece => !!p.slot),
  })).filter((l) => l.style || ask.styles.length);
}

// 3 looks for one outing in one call (about ₹0.3): the style of theirs
// that fits it best first, then the next best, so every style gets a turn
// (founder, 22 Nov 2026). Every look is checked in code (complete, nothing
// cut off, really different from the others); what fails is redone once
// with the reason, then left out. Never cut to fit.
export async function makeLooks(ask: LookAsk): Promise<Look[]> {
  const mine = ask.styles.map(styleById).filter((s) => s !== null);
  if (FAKE) return fakeLooks(ask);
  const n = Math.max(1, Math.min(3, ask.count));
  const rule = mine.length >= n
    ? `First decide which of their styles suit this outing best, best first. Look 1 uses the best, look ${n > 1 ? "2 the next" : ""}${n > 2 ? ", look 3 the one after" : ""}.`
    : mine.length === 1
      ? `They have one style, so give ${n} different takes on it${n > 1 ? " (one simpler, one dressed up or bolder)" : ""}.`
      : `Use their styles best fit first, then a second take on the best one.`;
  // Founder, 23 Nov 2026: "the clothes suggestions are not great". A
  // stylist's brief: the season there, a colour story, colour and fabric in
  // every piece, what people really wear to this kind of place in this city,
  // and their own pieces built in.
  const base = `You are a sharp personal stylist in ${ask.city}, dressing one person. It is ${ask.localTime}: dress for the weather usual in ${ask.city} at this time of year. In a warm or tropical climate never suggest warm layers (velvet, wool, knits, sweaters, boots for warmth); use breathable fabrics.
Their styles, strongest first: ${mine.map((s) => `${s.id} (${s.name})`).join(", ")}. They shop for ${ask.wears === "both" ? "womenswear and menswear" : ask.wears === "women" ? "womenswear" : "menswear"}.
${forText(ask.for)}
${ask.for.own ? `They're wearing something of their own: ${ask.for.own}. Use it in every look, word for word.\n` : ""}${ask.wardrobe.length ? `Pieces they own: ${ask.wardrobe.slice(-20).join("; ")}. Build at least one look around one of these when it suits this outing, naming it exactly as written here.\n` : ""}${ask.usuals.length ? `Brands they shop from (the kind of clothes, never name them): ${ask.usuals.slice(0, 8).join(", ")}.\n` : ""}${ask.cues.length ? `What they wear in outfits they love: ${ask.cues.join("; ")}.\n` : ""}${ask.worn.length ? `Looks they chose before: ${ask.worn.slice(-6).join("; ")}.\n` : ""}${ask.off.length ? `What was off in earlier looks (fix it): ${ask.off.slice(-4).join("; ")}.\n` : ""}${ask.avoid.length ? `Already shown for this outing, give clearly different ones: ${ask.avoid.join("; ")}.\n` : ""}${ask.note ? `They also said: ${ask.note}\n` : ""}
${rule}
Give ${n} complete outfit${n > 1 ? "s" : ""} a good stylist would really put together: what people dress like for this kind of place in ${ask.city}, true to the style, wearable and easy to find in shops there.
- Each has shoes, and a top with a bottom (or a one-piece like a dress, jumpsuit or kurta set); add a layer or one extra (bag, belt, jewellery, scarf) only when it lifts the look. At most 5 pieces.
- Each look has a clear colour story (2 or 3 colours that work together) and one piece that makes it.
- Name every piece fully in 2 to 6 plain words with its colour and fabric or finish, e.g. "Rust linen midi skirt", "Black leather loafers", never ending mid-phrase.
- ${n > 1 ? "The looks differ in silhouette, colours and pieces, not the same outfit reworded. " : ""}Hard asks (covered shoulders, no heels, keep my boots) always hold. Dress for exactly this outing, its setting and the time.
- "title" is 2 to 4 words that name the look's idea, no word repeated (e.g. "Rust and denim dinner"). "why" is one short sentence on why it works for this outing.
- Plain, warm, short. Never brands or prices; never comment on body, size or looks.
Reply with only JSON: {"looks": [{"style": the style id it is from (one of theirs), "title", "why", "pieces": [{"slot": "top" | "layer" | "bottom" | "one-piece" | "shoes" | "extra", "name": the piece}]}]}`;
  // Medium thinking: a stylist's choices, not a list (about ₹0.5 a set).
  const ask1 = await gemini("gemini_rank", "gemini-3.5-flash", [{ text: base }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } }, 25000);
  let looks = parseLooks(textOf(ask1), ask);
  const problems = (ls: Look[]) =>
    ls.map((l, i) => lookProblem(l, ask.styles) ?? (ls.slice(0, i).some((m) => tooAlike(l, m)) ? "too like an earlier look" : null));
  let bad = problems(looks);
  if (looks.length < n || bad.some(Boolean)) {
    // Once more, saying what was wrong (never cut to fit).
    const why = bad.map((b, i) => (b ? `look ${i + 1}: ${b}` : "")).filter(Boolean).join("; ") || `only ${looks.length} came back`;
    const ask2 = await gemini("gemini_rank", "gemini-3.5-flash", [{ text: `${base}\n\nYour last answer had problems (${why}). Answer again, fixing them.` }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } }, 25000);
    const again = parseLooks(textOf(ask2), ask);
    const againBad = problems(again);
    const good = (ls: Look[], b: (string | null)[]) => ls.filter((_, i) => !b[i]);
    looks = good(again, againBad).length >= good(looks, bad).length ? again : looks;
    bad = problems(looks);
  }
  const ok = looks.filter((_, i) => !bad[i]).slice(0, n);
  if (!ok.length) throw new Error(`No complete look: ${bad.join("; ")}`);
  return ok.map((l) => ({ ...l, pieces: orderedPieces(l.pieces) }));
}

// Change one piece and keep the rest (founder, 20 Nov 2026: "some might
// like the pant idea but not the top").
export async function swapPiece(ask: LookAsk, look: Look, index: number, tried: string[]): Promise<Look> {
  const piece = look.pieces[index];
  if (!piece) throw new Error("No such piece");
  if (FAKE) return { ...look, pieces: look.pieces.map((p, i) => (i === index ? { ...p, name: `Another ${p.slot === "one-piece" ? "dress" : p.slot}` } : p)) };
  const prompt = `You are Feta's stylist in ${ask.city}. ${forText(ask.for)}
They like this look, "${look.title}": ${look.pieces.map((p) => `${p.slot}: ${p.name}`).join("; ")}, except the ${piece.slot} ("${piece.name}"). Suggest a different ${piece.slot} that works with the rest for this outing.${tried.length ? ` Already tried: ${tried.join("; ")}.` : ""} Name it fully in 2 to 6 plain words, never ending mid-phrase; no brands.
Reply with only JSON: {"name": the new piece, "why": the look's one-sentence why, updated if needed}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await gemini("gemini_rank", "gemini-3.5-flash", [{ text: prompt + (attempt ? "\nYour last answer was cut off or empty. Answer again." : "") }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 15000);
    const o = JSON.parse(textOf(data)) as { name?: string; why?: string };
    const name = String(o.name ?? "").trim();
    if (!pieceProblem(name) && name.toLowerCase() !== piece.name.toLowerCase())
      return { ...look, why: String(o.why ?? "").trim().slice(0, 220) || look.why, pieces: look.pieces.map((p, i) => (i === index ? { ...p, name } : p)) };
  }
  throw new Error("No complete piece came back");
}

// Test mode: made-up but complete looks, one per style in turn.
function fakeLooks(ask: LookAsk): Look[] {
  const n = Math.max(1, Math.min(3, ask.count));
  const seen = ask.avoid.length;
  return Array.from({ length: n }, (_, k) => {
    const id = ask.styles[(k + seen) % Math.max(1, ask.styles.length)] ?? "smart-casual";
    const st = styleById(id) ?? STYLES[0];
    return {
      id: `fake${seen}${k}${Date.now().toString(36)}`,
      style: st.id,
      title: `${st.short} take ${seen + k + 1}`,
      why: `Made-up look for testing, for ${ask.for.text.toLowerCase()}.`,
      pieces: orderedPieces([
        { slot: "top", name: ask.wears === "men" ? "Relaxed linen shirt" : "Fitted cotton top" },
        { slot: "bottom", name: "Straight-leg trousers" },
        { slot: "shoes", name: ask.for.own ? ask.for.own : "White leather sneakers" },
      ]),
    };
  });
}

export type RankAsk = {
  cues: string[];
  styles: string[];
  wears: Wears;
  budget: string[]; // c1…c4
  loved: string[]; // brand names
  country: string;
  brands: { id: string; name: string; style: string; cues: string; priceFeel: string | null; homegrown: boolean; lovers: number }[];
};

export async function rankBrands(ask: RankAsk): Promise<{ id: string; why: string }[]> {
  if (FAKE) return ask.brands.map((b) => ({ id: b.id, why: `Test mode: fits your ${styleById(b.style)?.short.toLowerCase() ?? "style"}` }));
  const top = Math.max(...ask.budget.map((b) => Number(b.slice(1))).filter(Number.isFinite), 0);
  const prompt = `You are Feta's stylist in ${ask.country}. Order these clothing brands for one person, best for them first, and say in one short line why each suits THEM.
What Feta saw in outfits they love: ${ask.cues.length ? ask.cues.join("; ") : "no photos"}.
Their styles, strongest first: ${ask.styles.map((id) => styleById(id)?.name ?? id).join(", ")}.
They shop for ${ask.wears === "both" ? "womenswear and menswear" : ask.wears === "women" ? "womenswear" : "menswear"}. Clothes budget per piece: up to level ${top || "any"} of 4 (1 budget, 2 mid, 3 premium, 4 luxury).
${ask.loved.length ? `Brands they already love: ${ask.loved.join(", ")}.` : ""}
Put first the brands whose clothes look most like what they wear AND fit their budget; a brand mostly above their budget goes after the ones within it unless it is a much better match; spread across their styles rather than one style filling the top; homegrown and lesser-known labels are a plus. "why" is at most 12 words, about the clothes and them (e.g. "Same relaxed cargo shapes as your photos"), never about price or budget (Feta shows the checked price beside it) and never about bodies or looks.
Brands (id | name | style | what it sells | price | homegrown | loved by others):
${ask.brands.map((b) => `${b.id} | ${b.name} | ${b.style} | ${b.cues.slice(0, 140)} | ${b.priceFeel ?? "?"} | ${b.homegrown ? "yes" : "no"} | ${b.lovers}`).join("\n")}
Reply with only JSON: {"order": [{"id", "why"}]} including every brand once.`;
  const data = await gemini("gemini_rank", "gemini-3.5-flash", [{ text: prompt }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 20000);
  const parsed = JSON.parse(textOf(data)) as { order?: { id: string; why?: string }[] };
  const known = new Set(ask.brands.map((b) => b.id));
  const seen = new Set<string>();
  // A line about price would contradict the checked price shown beside it
  // ("slightly above your budget" over "✓ In your budget", persona re-test).
  const order = (parsed.order ?? []).filter((o) => known.has(o.id) && !seen.has(o.id) && seen.add(o.id)).map((o) => ({ id: o.id, why: /budget|price|afford|cheap|expensive|₹|\$|€|£/i.test(String(o.why ?? "")) ? "" : String(o.why ?? "").slice(0, 100) }));
  // Anything the model left out keeps its place at the end.
  return [...order, ...ask.brands.filter((b) => !seen.has(b.id)).map((b) => ({ id: b.id, why: "" }))];
}
