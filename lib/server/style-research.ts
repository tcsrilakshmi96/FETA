import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@/lib/server/costs";

// Style brand discovery (founder, 19–20 Nov 2026): brands people can buy
// from in a country for one style, found with Google Search through Gemini
// the way a fashion editor would (local Vogue, blogs, "best homegrown
// streetwear brands" articles, brand sites, store directories), then each
// brand's current collection read to check the style from what's visible.
// Her reference workbook (style_lenses, style_reference_*) is the brief:
// it shows what kind of brand fits, never the answer. Brands only, never a
// marketplace; every claim keeps its link; everything starts as proposed
// until she approves it in Admin.

export type Brief = {
  styleId: string;
  name: string;
  definition: string;
  signals: string;
  keepSeparate: string;
  examples: { name: string; country: string; labelType: string; cues: string; association: string }[];
};

export type FoundBrand = {
  brand_name: string;
  name_key: string;
  website: string;
  instagram: string | null;
  origin_country: string | null; // ISO code
  homegrown: boolean;
  wears: "women" | "men" | "unisex" | "women+men" | null;
  presence_type: "stores" | "own site delivers here" | "official local site" | "ships from abroad";
  presence_url: string;
  collection_url: string;
  editorial_url: string | null;
  visible_cues: string;
  association: "main" | "adjacent";
  label_type: string | null;
  price_feel: "budget" | "mid" | "premium" | "luxury" | null;
  sample_price: number | null;
  sample_currency: string | null;
  sample_item: string | null;
  similar_reference: string | null;
  confidence: "verified_collection" | "written_evidence_only";
};

export type Research = { brands: FoundBrand[]; searchHtml: string; dropped: { name: string; why: string }[] };

// Marketplaces and multi-brand stores are never the answer.
const MARKETPLACES = /myntra|ajio|nykaa|amazon\.|flipkart|tatacliq|namshi|noon\.com|farfetch|asos\.|zalando|ssense|net-a-porter|mytheresa|shein|meesho|lazada|shopee|zara\.com\/.*\/search|instagram\.com|facebook\.com|pinterest\./;

export function nameKey(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

export async function loadBrief(db: SupabaseClient, styleId: string): Promise<Brief | null> {
  const [{ data: lens }, { data: links }] = await Promise.all([
    db.from("style_lenses").select("*").eq("style_id", styleId).maybeSingle(),
    db.from("style_reference_links").select("association, style_reference_brands (name, country, label_type, cues)").eq("style_id", styleId),
  ]);
  if (!lens) return null;
  type Ref = { name: string; country: string; label_type: string | null; cues: string | null };
  return {
    styleId,
    name: lens.name,
    definition: lens.definition,
    signals: lens.visible_signals,
    keepSeparate: lens.keep_separate ?? "",
    examples: (links ?? []).map((l) => {
      const b = l.style_reference_brands as unknown as Ref;
      return { name: b.name, country: b.country, labelType: b.label_type ?? "", cues: b.cues ?? "", association: l.association };
    }),
  };
}

type Grounded = { text: string; searchHtml: string };

export async function gemini(prompt: string, tools: object[]): Promise<Grounded> {
  track("gemini_search");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools, generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }),
    signal: AbortSignal.timeout(170000),
  });
  if (!res.ok) throw new Error(`Style research failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const cand = data.candidates?.[0];
  return {
    text: (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""),
    searchHtml: cand?.groundingMetadata?.searchEntryPoint?.renderedContent ?? "",
  };
}

export function jsonArray<T>(text: string): T[] {
  try {
    return JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? "[]") as T[];
  } catch {
    return [];
  }
}

const briefText = (b: Brief) => `STYLE: ${b.name} (${b.styleId})
Definition: ${b.definition}
Visible signals: ${b.signals}
Keep separate: ${b.keepSeparate}
Example brands that fit (calibration only; they show the kind and level of brand, they are not the answer):
${b.examples.map((e) => `- ${e.name} (${e.country}, ${e.labelType}, ${e.association}): ${e.cues}`).join("\n") || "- none"}`;

// Pass 1: candidates, the way a fashion editor would find them.
async function discover(brief: Brief, country: { code: string; name: string }, want: number, known: string[] = []) {
  const prompt = `You are a fashion researcher for Feta, an app that helps people discover clothing brands that fit their style in their own country.

${briefText(brief)}

COUNTRY: ${country.name} (${country.code})

Search the web for ${want} real clothing brands that people living in ${country.name} can buy from, whose current collections fit this style. Look where a fashion editor would: local fashion editorial and press (Vogue ${country.name}, Elle, GQ, Grazia, Harper's Bazaar, Hypebeast, Highsnobiety, local fashion blogs), "best homegrown ${brief.name.toLowerCase()} brands in ${country.name}" articles, brand websites, and mall or store directories for international brands. Never use marketplace listings to discover brands.

Mix homegrown labels from ${country.name} with international brands that genuinely operate there (their own stores, or their own website delivering within ${country.name}). At least half should be homegrown or lesser-known labels people may not have heard of: small independent labels, new designers, city-specific and Instagram-first labels with their own site. Finding those outliers is the point.

Styles overlap, so one brand can fit several styles: that's fine. Include big chains (Zara, H&M, Uniqlo, Mango, Jack & Jones and local chains) when a real part of their current range (a section, an edit, several pieces) carries this style, and denim brands when their cuts match it (baggy → streetwear, skatewear; low-rise or bootcut → Y2K; raw or selvedge → workwear; ripped → grunge; plain everyday denim → basics).

${known.length ? `Feta already has these for this style in ${country.name}; find OTHER brands, especially smaller, newer and lesser-known labels: ${known.join(", ")}.\n\n` : ""}Rules: brands only, never a marketplace or multi-brand store (no Myntra, Ajio, Nykaa, Amazon, Namshi, Farfetch, ASOS, Zalando). Never invent a brand, URL or handle; fewer real brands beat more guessed ones. No comments about bodies, sizes or who should wear something.

Reply with only a JSON array, one item per brand:
{"brand_name", "website": the brand's own site, "instagram": handle or null, "origin_country": ISO code, "presence_type": "stores" (physical stores in ${country.name}) | "official local site" (a ${country.name} site or local-currency store) | "own site delivers here" (ships within ${country.name} from inside it) | "ships from abroad" (only international shipping into ${country.name}, duties may apply), "presence_url": a page proving it, "collection_url": a page of its current collection that shows this style, "editorial_url": an article that recommends it, or null}`;
  const out = await gemini(prompt, [{ google_search: {} }]);
  return { candidates: jsonArray<Partial<FoundBrand>>(out.text), searchHtml: out.searchHtml };
}

// Pass 2: read each brand's current collection and tag the style only from
// what is visible there.
async function check(brief: Brief, country: { code: string; name: string }, batch: Partial<FoundBrand>[]) {
  const prompt = `You are checking clothing brands for Feta's style library.

${briefText(brief)}

COUNTRY: ${country.name} (${country.code})

For each brand below, open its collection page (and its site if needed) and look at what it sells NOW. Decide from what you can see (silhouette, fabric, pattern, details) whether a real part of its current range carries this style: a section, an edit or several pieces is enough, even when the brand also does other styles (styles overlap; that is expected). Look across the range, never judge from a single item. Use the "keep separate" notes only to avoid lazy matches (a long dress is not automatically modest; technical fabric is not automatically techwear), not to turn away brands that also fit other styles. Say it doesn't fit only when the range clearly doesn't carry this style. Also check how people in ${country.name} buy from it: physical stores there, an official local site, delivery from inside the country, or only international shipping from abroad (duties may apply), and note one current price in the local currency where the brand shows one.

Brands:
${batch.map((b, i) => `${i + 1}. ${b.brand_name} · site ${b.website} · collection ${b.collection_url} · presence ${b.presence_url}`).join("\n")}

Reply with only a JSON array, one item per brand, in the same order:
{"brand_name", "fits": true | false, "why_not": short reason if it doesn't fit or can't be checked, else null, "presence_type": "stores" | "official local site" | "own site delivers here" | "ships from abroad", "association": "main" (this style is a core direction of the current collection) | "adjacent" (a section, edit or some pieces within a broader range), "visible_cues": one short plain line of what you saw (e.g. "relaxed graphic tees, heavy cotton hoodies, cargo trousers"), "sells_here": true | false, "wears": "women" | "men" | "unisex" | "women+men", "label_type": "homegrown designer-led" | "specialist" | "large international" | "designer house" | "other", "price_feel": "budget" | "mid" | "premium" | "luxury" (relative to ${country.name}), "sample_price": number or null, "sample_currency": ISO code or null, "sample_item": short item name or null, "similar_reference": the example brand above it most resembles, or null, "confidence": "verified_collection" if you saw the products, else "written_evidence_only"}`;
  const out = await gemini(prompt, [{ url_context: {} }, { google_search: {} }]);
  return jsonArray<Partial<FoundBrand> & { fits?: boolean; why_not?: string | null; sells_here?: boolean }>(out.text);
}

// A link that answers (free: no Google call). Some brand sites refuse
// bots, so a refusal (401/403/429) still counts as alive.
export async function linkAlive(url: string | null | undefined) {
  if (!url || !/^https:\/\//.test(url)) return false;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "User-Agent": "Mozilla/5.0 (compatible; FetaLinkCheck/1.0)" } });
    return res.status < 400 || [401, 403, 429].includes(res.status);
  } catch {
    return false;
  }
}

export async function researchStyle(brief: Brief, country: { code: string; name: string }, want = 14, known: string[] = []): Promise<Research> {
  const { candidates, searchHtml } = await discover(brief, country, want, known);
  const dropped: Research["dropped"] = [];
  const seen = new Set<string>();
  const real = candidates.filter((c) => {
    const name = (c.brand_name ?? "").trim();
    const key = nameKey(name);
    if (!name || seen.has(key) || known.some((k) => nameKey(k) === key)) return false;
    seen.add(key);
    if (MARKETPLACES.test(c.website ?? "")) {
      dropped.push({ name, why: "a marketplace, not a brand" });
      return false;
    }
    return true;
  });
  const batches: Partial<FoundBrand>[][] = [];
  for (let i = 0; i < real.length; i += 4) batches.push(real.slice(i, i + 4));
  const checked = (await Promise.all(batches.map((b) => check(brief, country, b).catch(() => [])))).flat();
  const byName = new Map(checked.map((c) => [nameKey(c.brand_name ?? ""), c]));
  const brands: FoundBrand[] = [];
  await Promise.all(
    real.map(async (c) => {
      const name = c.brand_name!.trim();
      const v = byName.get(nameKey(name));
      if (!v) return dropped.push({ name, why: "couldn't be checked" });
      if (!v.fits) return dropped.push({ name, why: v.why_not ?? "current collection doesn't fit" });
      if (v.sells_here === false) return dropped.push({ name, why: `doesn't sell in ${country.name}` });
      const [siteOk, presenceOk] = await Promise.all([linkAlive(c.website), linkAlive(c.presence_url)]);
      if (!siteOk && !presenceOk) return dropped.push({ name, why: "its links don't open" });
      brands.push({
        brand_name: name,
        name_key: nameKey(name),
        website: c.website!,
        instagram: c.instagram?.replace(/^@/, "") || null,
        origin_country: c.origin_country?.toUpperCase().slice(0, 2) || null,
        homegrown: c.origin_country?.toUpperCase() === country.code,
        wears: v.wears ?? null,
        presence_type: (v.presence_type as FoundBrand["presence_type"]) ?? c.presence_type ?? "own site delivers here",
        presence_url: presenceOk ? c.presence_url! : c.website!,
        collection_url: c.collection_url ?? c.website!,
        editorial_url: c.editorial_url ?? null,
        visible_cues: v.visible_cues ?? "",
        association: v.association === "main" ? "main" : "adjacent",
        label_type: v.label_type ?? null,
        price_feel: v.price_feel ?? null,
        sample_price: typeof v.sample_price === "number" ? v.sample_price : null,
        sample_currency: v.sample_currency ?? null,
        sample_item: v.sample_item ?? null,
        similar_reference: v.similar_reference ?? null,
        confidence: v.confidence === "verified_collection" ? "verified_collection" : "written_evidence_only",
      });
    }),
  );
  return { brands: brands.sort((a, b) => Number(b.association === "main") - Number(a.association === "main")), searchHtml, dropped };
}

export async function saveResearch(db: SupabaseClient, country: string, styleId: string, r: Research) {
  const { error } = await db.rpc("save_style_research", {
    p_key: process.env.USAGE_REPORT_KEY,
    p_country: country,
    p_style: styleId,
    p_rows: r.brands.map((b) => ({ ...b, similar_reference: b.similar_reference })),
    p_search_html: r.searchHtml,
  });
  if (error) throw new Error(`Saving style research failed: ${error.message}`);
}

// One brand someone typed that isn't in the library (founder, 20 Nov 2026:
// people add brands they love, like places). Checked with Google Search:
// a real clothing brand (never a marketplace), its own site, where it's
// from, which styles it carries, and how people in the country buy it.
// About ₹3. Saved as proposed.
export async function lookupBrand(db: SupabaseClient, name: string, country: { code: string; name: string }, styleIds: string[]): Promise<{ id: string; name: string } | null> {
  const prompt = `Find the clothing brand "${name}" (someone in ${country.name} says they love it). Use Google Search.
If it is not a real clothing or fashion brand, or it is a marketplace or multi-brand store (Myntra, Ajio, Nykaa, Amazon, Namshi, Farfetch, ASOS, Zalando and the like), reply {"real": false}.
Otherwise reply with only JSON: {"real": true, "brand_name": its proper name, "website": its own site (https), "instagram": handle or null, "origin_country": ISO code, "wears": "women" | "men" | "unisex" | "women+men", "label_type": "homegrown designer-led" | "specialist" | "large international" | "designer house" | "other", "presence_type": how people in ${country.name} buy it: "stores" | "official local site" | "own site delivers here" | "ships from abroad", or null if they can't, "presence_url": a page showing it, or null, "price_feel": "budget" | "mid" | "premium" | "luxury" (in ${country.name}), "visible_cues": one short plain line about what it sells now, "styles": every style id from this list a real part of its current range carries (styles overlap; list all that fit): ${styleIds.join(", ")}}`;
  const out = await gemini(prompt, [{ google_search: {} }]);
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(/\{[\s\S]*\}/.exec(out.text)?.[0] ?? "{}");
  } catch {
    return null;
  }
  if (!r.real || typeof r.brand_name !== "string" || typeof r.website !== "string" || MARKETPLACES.test(r.website) || !(await linkAlive(r.website))) return null;
  const row = { ...r, name_key: nameKey(r.brand_name), origin_country: typeof r.origin_country === "string" ? r.origin_country.toUpperCase().slice(0, 2) : null, instagram: typeof r.instagram === "string" ? r.instagram.replace(/^@/, "") : null };
  const styles = (Array.isArray(r.styles) ? r.styles : []).filter((x): x is string => typeof x === "string" && styleIds.includes(x));
  const { data, error } = await db.rpc("save_brand_lookup", { p_key: process.env.USAGE_REPORT_KEY, p_country: country.code, p_row: row, p_styles: styles });
  if (error || !data) throw new Error(`Saving brand failed: ${error?.message}`);
  return { id: data as string, name: r.brand_name };
}
