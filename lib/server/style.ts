import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { STYLES, styleById, type Occasion, type Outfit, type Wears } from "@/lib/style";

// Style's three AI steps (founder, 20 Nov 2026), all through Gemini with
// Feta's own data only. Photos are read or drawn and never stored:
// - readPhotos: up to 8 inspiration photos → their styles, from the clothes
//   alone (never age, religion, ethnicity, body, income or gender).
// - drawOnYou: one photo of them, drawn as the same kind of illustration as
//   the style's picture, wearing that style. About ₹4 a drawing.
// - outfitIdea: what to wear for one outing: a direction, not exact items.

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

type Lens = { style_id: string; name: string; definition: string; visible_signals: string; keep_separate: string | null };

async function lenses(db: SupabaseClient): Promise<Lens[]> {
  const { data } = await db.from("style_lenses").select("style_id, name, definition, visible_signals, keep_separate");
  return (data as Lens[] | null) ?? [];
}

async function gemini(model: string, parts: object[], generationConfig: object, timeoutMs: number) {
  const res = await fetch(`${GEMINI}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini ${model} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
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
  track("gemini_vision");
  const prompt = `You are Feta's stylist. These ${photos.length} photos (numbered 1 to ${photos.length} in order) are outfits a person loves: screenshots or their own. They shop for ${wears === "both" ? "womenswear and menswear" : wears === "women" ? "womenswear" : "menswear"}.
Read ONLY the clothes: silhouette, fabric, colour, pattern, details, how pieces are put together. Never guess or mention anyone's age, religion, ethnicity, body, size, looks, income or gender.

Styles (use the id). Styles overlap; a photo can show more than one.
${all.map((l) => `- ${l.style_id}: ${l.name}. ${l.definition} Looks like: ${l.visible_signals}`).join("\n")}

Be true to what people would recognise in themselves. Everyday outfits are usually basics, smart-casual, minimalist, polished-minimal, streetwear or athleisure; name a niche aesthetic (coquette, dark-academia, y2k, goth, cottagecore…) only when its signals are clearly there, never from one detail.

Reply with only JSON:
{"photos": [one per photo, in order: {"saw": what the outfit is, at most 8 plain words, e.g. "Oversized blazer, white tee, straight jeans", "styles": 1 or 2 style ids}],
 "styles": [the 2 to 5 styles that run through these photos, strongest first: {"id", "why": what they have in common, at most 8 words, "photos": the photo numbers that show it}]}
A photo with no clear outfit: {"saw": "No clear outfit", "styles": []}.`;
  const data = await gemini("gemini-3.5-flash", [{ text: prompt }, ...photos.slice(0, 8).map(inline)], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "medium" } }, 40000);
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

// Their photo drawn in the style, in the same look as Feta's illustrations
// (the style's picture goes along as the reference). Returns a data URL.
export async function drawOnYou(photo: string, styleId: string, reference: string): Promise<string> {
  const style = styleById(styleId);
  if (!style) throw new Error("Unknown style");
  if (FAKE) return reference;
  track("gemini_image");
  const prompt = `Make a fashion illustration of the person in the FIRST image, full body, standing, alone, on the same plain light grey background and in exactly the same illustration style as the SECOND image (soft hand-drawn fashion illustration, natural proportions).
Dress them in a ${style.name.toLowerCase()} outfit like the matching figure in the second image, adapted to them.
Keep the person recognisably themselves: face, skin tone, hair and body exactly as in their photo. Never slim, lighten, beautify or change their body or features. No text, no logos, no other people.`;
  const data = await gemini("gemini-3.1-flash-image", [{ text: prompt }, inline(photo), inline(reference)], { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } }, 60000);
  const part = data.candidates?.[0]?.content?.parts?.find((p: { inline_data?: unknown; inlineData?: unknown }) => p.inline_data || p.inlineData);
  const img = part?.inline_data ?? part?.inlineData;
  if (!img?.data) throw new Error("No drawing came back");
  return `data:${img.mime_type ?? img.mimeType ?? "image/png"};base64,${img.data}`;
}

export type OutfitAsk = {
  styles: string[];
  wears: Wears;
  occasion: Occasion | null;
  stops: { name: string; kind: string; time?: string }[]; // tonight's plan, if any
  walkKm: number | null;
  city: string;
  localTime: string; // "Thursday 7:40 pm"
  avoid: string[]; // ideas already shown this time
  usedStyles: string[]; // their styles those ideas were based on
  cues: string[]; // what Feta saw in outfits they love
  loved: string[]; // titles they loved before
  notMe: string[]; // titles they said weren't them
};

const OCCASION_WORDS: Record<Occasion, string> = { dinner: "going out for dinner", drinks: "going out for drinks", do: "going out to do something fun", day: "an everyday day look" };

export async function outfitIdea(ask: OutfitAsk): Promise<Outfit> {
  const mine = ask.styles.map(styleById).filter((s) => s !== null);
  if (FAKE) return fakeOutfit(mine[ask.usedStyles.length % Math.max(1, mine.length)]?.id ?? "smart-casual", ask);
  // Another moves on to a style of theirs not used yet (founder, 20 Nov 2026: "I have only gotten streetstyle").
  const fresh = mine.filter((m) => !ask.usedStyles.includes(m.id));
  track("gemini_rank");
  const what = ask.stops.length ? `Their plan: ${ask.stops.map((s) => `${s.time ? `${s.time} ` : ""}${s.name} (${s.kind})`).join(", then ")}.${ask.walkKm ? ` About ${ask.walkKm.toFixed(1)} km on foot between stops.` : ""}` : ask.occasion ? `They are ${OCCASION_WORDS[ask.occasion]}.` : "They haven't said where they're going.";
  const prompt = `You are Feta's stylist in ${ask.city}. It is ${ask.localTime}.
Their styles: ${mine.map((s) => `${s.id} (${s.name})`).join(", ")}.
${ask.cues.length ? `What they wear in outfits they love: ${ask.cues.join("; ")}.\n` : ""}${ask.usedStyles.length && fresh.length ? `Base this idea on one of these styles of theirs, not used yet: ${fresh.map((m) => m.id).join(", ")}.\n` : ""} They wear ${ask.wears === "both" ? "womenswear and menswear" : ask.wears === "women" ? "womenswear" : "menswear"}.
${what}
${ask.loved.length ? `Ideas they loved before: ${ask.loved.join("; ")}.\n` : ""}${ask.notMe.length ? `Ideas that weren't them: ${ask.notMe.join("; ")}.\n` : ""}${ask.avoid.length ? `Already suggested now, give something different: ${ask.avoid.join("; ")}.\n` : ""}
Suggest what to wear: a direction from THEIR styles that suits the place and the evening, not exact items, brands or colours. Plain, warm, short. Never comment on body, size or looks.
Reply with only JSON: {"style": the style id it is based on (one of theirs), "title": 2 to 4 words, e.g. "Smart casual" or "Streetwear, dressed up", "big1": one word in capitals for a poster, e.g. "SMART", "big2": one or two lowercase words, e.g. "casual", "line": one or two sentences on why it suits tonight, "pieces": {"top": 2 to 5 words, "bottom": 2 to 5 words, "shoes": 2 to 6 words}, "chips": 2 to 4 short facts it is based on, e.g. "Relaxed brewpub", "900 m walk", "Late dinner"}`;
  const data = await gemini("gemini-3.5-flash", [{ text: prompt }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 15000);
  const o = JSON.parse(textOf(data)) as Outfit;
  const style = styleById(o.style) && ask.styles.includes(o.style) ? o.style : (mine[0]?.id ?? "smart-casual");
  const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);
  return {
    style,
    title: cut(o.title, 40),
    big1: cut(o.big1, 10).toUpperCase(),
    big2: cut(o.big2, 16).toLowerCase(),
    line: cut(o.line, 260),
    pieces: { top: cut(o.pieces?.top, 40), bottom: cut(o.pieces?.bottom, 40), shoes: cut(o.pieces?.shoes, 48) },
    chips: (o.chips ?? []).slice(0, 4).map((c) => cut(c, 24)),
  };
}

function fakeOutfit(id: string, ask: OutfitAsk): Outfit {
  const s = styleById(id) ?? STYLES[0];
  return {
    style: s.id,
    title: s.short,
    big1: s.big,
    big2: "tonight",
    line: `Made-up idea for testing: ${s.name.toLowerCase()} for ${ask.stops[0]?.name ?? ask.occasion ?? "tonight"}.`,
    pieces: { top: "An easy top layer", bottom: "Relaxed trousers", shoes: "Comfortable shoes" },
    chips: ask.stops.length ? ["Your plan", "Test mode"] : ["Test mode"],
  };
}

// Brands ranked for this person (founder, 20 Nov 2026: "it feels like a
// hardcoded thing"): what Feta saw in their photos, their styles, budget,
// what they shop for and the brands they love decide the order, with one
// line on why each suits them. Library facts only (no Google content).
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
  track("gemini_rank");
  const top = Math.max(...ask.budget.map((b) => Number(b.slice(1))).filter(Number.isFinite), 0);
  const prompt = `You are Feta's stylist in ${ask.country}. Order these clothing brands for one person, best for them first, and say in one short line why each suits THEM.
What Feta saw in outfits they love: ${ask.cues.length ? ask.cues.join("; ") : "no photos"}.
Their styles, strongest first: ${ask.styles.map((id) => styleById(id)?.name ?? id).join(", ")}.
They shop for ${ask.wears === "both" ? "womenswear and menswear" : ask.wears === "women" ? "womenswear" : "menswear"}. Clothes budget per piece: up to level ${top || "any"} of 4 (1 budget, 2 mid, 3 premium, 4 luxury).
${ask.loved.length ? `Brands they already love: ${ask.loved.join(", ")}.` : ""}
Put first the brands whose clothes look most like what they wear and fit their budget; spread across their styles rather than one style filling the top; homegrown and lesser-known labels are a plus. "why" is at most 12 words, about the clothes and them (e.g. "Same relaxed cargo shapes as your photos, within budget"), never about bodies or looks.
Brands (id | name | style | what it sells | price | homegrown | loved by others):
${ask.brands.map((b) => `${b.id} | ${b.name} | ${b.style} | ${b.cues.slice(0, 140)} | ${b.priceFeel ?? "?"} | ${b.homegrown ? "yes" : "no"} | ${b.lovers}`).join("\n")}
Reply with only JSON: {"order": [{"id", "why"}]} including every brand once.`;
  const data = await gemini("gemini-3.5-flash", [{ text: prompt }], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 20000);
  const parsed = JSON.parse(textOf(data)) as { order?: { id: string; why?: string }[] };
  const known = new Set(ask.brands.map((b) => b.id));
  const seen = new Set<string>();
  const order = (parsed.order ?? []).filter((o) => known.has(o.id) && !seen.has(o.id) && seen.add(o.id)).map((o) => ({ id: o.id, why: String(o.why ?? "").slice(0, 100) }));
  // Anything the model left out keeps its place at the end.
  return [...order, ...ask.brands.filter((b) => !seen.has(b.id)).map((b) => ({ id: b.id, why: "" }))];
}
