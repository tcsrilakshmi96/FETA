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

export type StyleRead = { styles: { id: string; why: string }[] };

export async function readPhotos(db: SupabaseClient, photos: string[], wears: Wears): Promise<StyleRead> {
  if (FAKE) return { styles: [{ id: "streetwear", why: "Relaxed layers and cargo trousers" }, { id: "smart-casual", why: "Crisp shirts and loose trousers" }, { id: "y2k", why: "Baby tees and low-rise denim" }] };
  const all = await lenses(db);
  track("gemini_vision");
  const prompt = `You are Feta's stylist. These ${photos.length} photos are outfits a person loves (screenshots or their own). They shop for ${wears === "both" ? "womenswear and menswear" : wears === "women" ? "womenswear" : "menswear"}.
Read ONLY the clothes: silhouette, fabric, colour, pattern, details, how pieces are put together. Never guess or mention anyone's age, religion, ethnicity, body, size, looks, income or gender. A photo with no clear outfit counts for nothing.

Match what you see to these styles (use the id). Follow each "keep separate" rule.
${all.map((l) => `- ${l.style_id}: ${l.name}. ${l.definition} Looks like: ${l.visible_signals}${l.keep_separate ? ` Keep separate: ${l.keep_separate}` : ""}`).join("\n")}

Reply with only JSON: {"styles": [{"id": style id, "why": what you saw, at most 8 words, e.g. "Oversized hoodies, cargo trousers, chunky sneakers"}]}: the 2 to 4 styles that best describe these photos together, strongest first. Only styles clearly visible in at least one photo.`;
  const data = await gemini("gemini-3.5-flash", [{ text: prompt }, ...photos.slice(0, 8).map(inline)], { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } }, 30000);
  const parsed = JSON.parse(textOf(data)) as StyleRead;
  const seen = new Set<string>();
  return {
    styles: (parsed.styles ?? []).filter((s) => styleById(s.id) && !seen.has(s.id) && seen.add(s.id)).slice(0, 4).map((s) => ({ id: s.id, why: String(s.why ?? "").slice(0, 80) })),
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
  loved: string[]; // titles they loved before
  notMe: string[]; // titles they said weren't them
};

const OCCASION_WORDS: Record<Occasion, string> = { dinner: "going out for dinner", drinks: "going out for drinks", do: "going out to do something fun", day: "an everyday day look" };

export async function outfitIdea(ask: OutfitAsk): Promise<Outfit> {
  const mine = ask.styles.map(styleById).filter((s) => s !== null);
  if (FAKE) return fakeOutfit(mine[ask.avoid.length % Math.max(1, mine.length)]?.id ?? "smart-casual", ask);
  track("gemini_rank");
  const what = ask.stops.length ? `Their plan: ${ask.stops.map((s) => `${s.time ? `${s.time} ` : ""}${s.name} (${s.kind})`).join(", then ")}.${ask.walkKm ? ` About ${ask.walkKm.toFixed(1)} km on foot between stops.` : ""}` : ask.occasion ? `They are ${OCCASION_WORDS[ask.occasion]}.` : "They haven't said where they're going.";
  const prompt = `You are Feta's stylist in ${ask.city}. It is ${ask.localTime}.
Their styles: ${mine.map((s) => `${s.id} (${s.name})`).join(", ")}. They wear ${ask.wears === "both" ? "womenswear and menswear" : ask.wears === "women" ? "womenswear" : "menswear"}.
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
