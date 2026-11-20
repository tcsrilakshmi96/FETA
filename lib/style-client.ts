"use client";

import type { City } from "@/lib/cities";
import { distanceKm } from "@/lib/cities";
import { fetchNightPlaces, loadPlans, localDay } from "@/lib/night-client";
import { currentUserId, supabase } from "@/lib/supabase";
import type { Occasion, Outfit, Wears } from "@/lib/style";

// Style on the phone (founder, 20 Nov 2026): the person's style profile,
// photos made small before they're read, their drawings (kept only on this
// phone, never on Feta's servers), brands from the library, and what to
// wear tonight.

export type StyleProfile = {
  wears: Wears;
  styles: string[];
  readFromPhotos: number;
  budget: string[];
  homegrownOnly: boolean;
  onYou: boolean;
  votes: { look: string; verdict: "love" | "not_me"; at: string }[];
  cues: string[]; // what Feta saw in their photos, in style words (never the photos)
};

async function token() {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const t = await token();
  if (!t) return null;
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function loadStyleProfile(): Promise<StyleProfile | null> {
  if (!(await currentUserId())) return null;
  const { data } = await supabase().from("style_profiles").select("*").maybeSingle();
  if (!data) return null;
  return { wears: data.wears, styles: data.styles ?? [], readFromPhotos: data.read_from_photos ?? 0, budget: data.budget ?? [], homegrownOnly: !!data.homegrown_only, onYou: !!data.on_you, votes: data.outfit_votes ?? [], cues: data.cues ?? [] };
}

export async function saveStyleProfile(p: StyleProfile, city: City | null) {
  const userId = await currentUserId();
  if (!userId) return;
  const row = {
      user_id: userId,
      wears: p.wears,
      styles: p.styles,
      read_from_photos: p.readFromPhotos,
      budget: p.budget,
      homegrown_only: p.homegrownOnly,
      on_you: p.onYou,
      outfit_votes: p.votes.slice(-40),
      cues: p.cues.slice(0, 8),
      city_id: city?.id ?? null,
      country: city?.country ?? null,
      time_zone: city?.timeZone ?? null,
      currency: city?.currency ?? null,
      updated_at: new Date().toISOString(),
    };
  let { error } = await supabase().from("style_profiles").upsert(row);
  // Before the cues column exists (migration 20261120160000), save the rest.
  if (error?.message.includes("cues")) {
    ({ error } = await supabase().from("style_profiles").upsert({ ...row, cues: undefined }));
  }
  if (error) console.error("Saving style failed", error.message);
}

// A photo made small (longest side 900 px, JPEG) so reading is quick and cheap.
export function shrink(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open that photo"));
    };
    img.src = url;
  });
}

export function readStylePhotos(photos: string[], wears: Wears) {
  return post<{ photos?: { saw: string; styles: string[] }[]; styles?: { id: string; why: string; photos: number[] }[]; notice?: string }>("/api/style/read", { photos, wears });
}

export function drawStyle(photo: string, style: string) {
  return post<{ image?: string; notice?: string }>("/api/style/draw", { photo, style });
}

// Their photo and drawings live in this phone's storage only.
const DB_NAME = "feta-style";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kept");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function keepOnPhone(key: string, value: string | null) {
  try {
    const db = await idb();
    const tx = db.transaction("kept", "readwrite");
    if (value === null) tx.objectStore("kept").delete(key);
    else tx.objectStore("kept").put(value, key);
  } catch {
    // Private browsing: the drawings simply aren't kept.
  }
}

export async function fromPhone(key: string): Promise<string | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const get = db.transaction("kept").objectStore("kept").get(key);
      get.onsuccess = () => resolve((get.result as string) ?? null);
      get.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function forgetOnYou() {
  try {
    const db = await idb();
    db.transaction("kept", "readwrite").objectStore("kept").clear();
  } catch {
    // Nothing kept.
  }
}

// Tonight's saved plan (Saved → Plans), read live: names, kinds and the walk.
export type TonightPlan = { stops: { name: string; kind: string; time?: string }[]; walkKm: number | null; title: string };

export async function tonightPlan(): Promise<TonightPlan | null> {
  const today = localDay(new Date());
  const plan = (await loadPlans()).find((p) => p.day === today);
  if (!plan) return null;
  const read = await fetchNightPlaces(plan.placeIds);
  const places = read?.places ?? [];
  if (!places.length) return null;
  const kindWord = { EAT: "dinner", DRINK: "drinks", DO: "something to do" } as const;
  let walk = 0;
  for (let i = 1; i < places.length; i++) walk += distanceKm(places[i - 1], places[i]);
  const h = Math.floor(plan.startMinute / 60);
  const m = plan.startMinute % 60;
  const time = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  return {
    stops: places.map((p, i) => ({ name: p.name, kind: kindWord[p.kind], time: i === 0 ? time : undefined })),
    walkKm: walk && walk < 3 ? walk : null,
    title: `${places[0].name} at ${time}${places.length > 1 ? `, then ${places.length === 2 ? places[1].name : `${places.length - 1} more`}` : ""}`,
  };
}

// One idea at a time; kept for the day so opening Style again costs nothing.
export async function outfitFor(ask: { styles: string[]; wears: Wears; occasion: Occasion | null; plan: TonightPlan | null; cityId: string; avoid: string[]; usedStyles: string[]; cues: string[]; loved: string[]; notMe: string[] }): Promise<{ outfit?: Outfit; notice?: string } | null> {
  const key = `feta.outfit:${localDay(new Date())}:${ask.occasion ?? "plan"}:${ask.plan?.title ?? ""}:${ask.styles.join(",")}:${ask.wears}:${ask.avoid.length}`;
  try {
    const kept = sessionStorage.getItem(key);
    if (kept) return JSON.parse(kept);
  } catch {
    // Not kept.
  }
  const localTime = new Intl.DateTimeFormat("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date());
  const res = await post<{ outfit?: Outfit; notice?: string }>("/api/style/outfit", {
    styles: ask.styles,
    wears: ask.wears,
    occasion: ask.plan ? null : ask.occasion,
    stops: ask.plan?.stops ?? [],
    walkKm: ask.plan?.walkKm ?? null,
    cityId: ask.cityId,
    localTime,
    avoid: ask.avoid,
    usedStyles: ask.usedStyles,
    cues: ask.cues,
    loved: ask.loved,
    notMe: ask.notMe,
  });
  if (res?.outfit) {
    try {
      sessionStorage.setItem(key, JSON.stringify(res));
    } catch {
      // Not kept.
    }
  }
  return res;
}

// Brands for their styles that sell in their country, from the library:
// "ships from abroad" only with international shipping (not offered yet),
// never a rejected tag. Homegrown = started in that country.
export type BrandCard = {
  id: string;
  name: string;
  website: string | null;
  logo: string | null;
  homegrown: boolean;
  why: string;
  style: string;
  priceFeel: string | null;
  approved: boolean;
  fetaPick?: boolean; // the founder loves it (★ Feta Pick)
  note?: string | null; // her note
  lovers?: number; // other people who love and recommend it
  youLove?: boolean;
  forYou?: string; // why it suits them, from the ranking
};

type Row = {
  style_id: string;
  association: string;
  visible_cues: string;
  review_status: string;
  brands: { id: string; name: string; website: string | null; logo_url: string | null; origin_country: string | null; wears: string | null; brand_markets: { country: string; presence_type: string; price_feel: string | null }[] };
};

export async function brandsFor(styles: string[], country: string, wears: Wears): Promise<BrandCard[]> {
  if (!styles.length || !(await currentUserId())) return [];
  const { data, error } = await supabase()
    .from("brand_styles")
    .select("style_id, association, visible_cues, review_status, brands!inner (id, name, website, logo_url, origin_country, wears, brand_markets!inner (country, presence_type, price_feel))")
    .in("style_id", styles)
    .neq("review_status", "rejected")
    .eq("brands.brand_markets.country", country);
  if (error) {
    console.error("Loading brands failed", error.message);
    return [];
  }
  const fitsWear = (w: string | null) => !w || wears === "both" || w === "unisex" || w === "women+men" || w === wears;
  const cards: BrandCard[] = ((data ?? []) as unknown as Row[])
    .map((r) => ({ r, market: r.brands.brand_markets.find((m) => m.country === country) }))
    .filter(({ r, market }) => market && market.presence_type !== "ships from abroad" && fitsWear(r.brands.wears))
    .sort((a, b) => styles.indexOf(a.r.style_id) - styles.indexOf(b.r.style_id) || Number(b.r.review_status === "approved") - Number(a.r.review_status === "approved") || Number(b.r.association === "main") - Number(a.r.association === "main"))
    .map(({ r, market }) => ({
      id: r.brands.id,
      name: r.brands.name,
      website: r.brands.website,
      logo: r.brands.logo_url,
      homegrown: r.brands.origin_country === country,
      why: r.visible_cues,
      style: r.style_id,
      priceFeel: market!.price_feel,
      approved: r.review_status === "approved",
    }));
  // Feta Picks (the founder's brands) first, then the ones people love most;
  // within those, the order above.
  const [love, mine] = await Promise.all([brandLove(cards.map((c) => c.id)), lovedBrandIds()]);
  const ranked: BrandCard[] = cards.map((c) => ({ ...c, ...love.get(c.id), youLove: mine.has(c.id) }));
  // A stable sort keeps the order above within each group.
  return ranked.sort((a, b) => Number(!!b.fetaPick) - Number(!!a.fetaPick) || (b.lovers ?? 0) - (a.lovers ?? 0));
}

export async function savedBrandIds(): Promise<Set<string>> {
  if (!(await currentUserId())) return new Set();
  const { data } = await supabase().from("saved_brands").select("brand_id");
  return new Set((data ?? []).map((r) => r.brand_id as string));
}

export async function toggleSavedBrand(b: BrandCard, on: boolean, country: string) {
  const userId = await currentUserId();
  if (!userId) return;
  const db = supabase().from("saved_brands");
  const { error } = on ? await db.upsert({ user_id: userId, brand_id: b.id, style_id: b.style, country }) : await db.delete().eq("brand_id", b.id);
  if (error) console.error("Saving brand failed", error.message);
}

export type SavedBrand = { id: string; name: string; website: string | null; logo: string | null; style: string | null; country: string | null };

export async function loadSavedBrands(): Promise<SavedBrand[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("saved_brands").select("style_id, country, brands (id, name, website, logo_url)").order("created_at", { ascending: false });
  return ((data ?? []) as unknown as { style_id: string | null; country: string | null; brands: { id: string; name: string; website: string | null; logo_url: string | null } }[]).map((r) => ({
    id: r.brands.id,
    name: r.brands.name,
    website: r.brands.website,
    logo: r.brands.logo_url,
    style: r.style_id,
    country: r.country,
  }));
}

// Feta's own research for every style in their country (founder, 20 Nov
// 2026), one style at a time while Style is open: their own styles first,
// then the rest. Styles researched in the last 120 days are skipped; the
// server makes sure two phones never research the same one. Calls onFound
// when a style gains brands, so the screen can show them.
let researching = false;

export async function researchCountry(cityId: string, country: string, first: string[], onFound: (style: string) => void, onStyle?: (style: string | null) => void) {
  if (researching || !(await currentUserId())) return;
  researching = true;
  try {
    const { STYLES } = await import("@/lib/style");
    const { data } = await supabase().from("style_research").select("style_id, researched_at, done").eq("country", country);
    const fresh = new Set((data ?? []).filter((r) => r.done && Date.now() - new Date(r.researched_at).getTime() < 120 * 86400000).map((r) => r.style_id as string));
    const order = [...first, ...STYLES.map((x) => x.id).filter((id) => !first.includes(id))].filter((id) => !fresh.has(id));
    // Starts once the screen has settled, and stops at the first problem
    // (founder, 20 Nov 2026: "the app feels really slow": a failing research
    // call used to be retried for all 37 styles on every Style screen).
    await new Promise((r) => setTimeout(r, 4000));
    for (const style of order) {
      if (document.hidden) break;
      onStyle?.(style);
      const r = await post<{ found?: number; skipped?: string }>("/api/style/research", { style, cityId });
      if (!r || (r.skipped && r.skipped !== "done or running")) break;
      if (r.found) onFound(style);
    }
  } finally {
    researching = false;
    onStyle?.(null);
  }
}

// Brands they love (founder, 20 Nov 2026), like the places they love.
export type LovedBrand = { id: string; name: string; logo: string | null; styles: string[] };

export async function brandLove(ids: string[]): Promise<Map<string, { fetaPick: boolean; note: string | null; lovers: number }>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase().rpc("brand_love", { p_brand_ids: [...new Set(ids)] });
  if (error) return new Map();
  return new Map((data as { brand_id: string; feta_pick: boolean; note: string | null; lovers: number }[]).map((r) => [r.brand_id, { fetaPick: r.feta_pick, note: r.note, lovers: r.lovers }]));
}

async function lovedBrandIds(): Promise<Set<string>> {
  const { data } = await supabase().from("loved_brands").select("brand_id");
  return new Set((data ?? []).map((r) => r.brand_id as string));
}

export async function loadLovedBrands(): Promise<LovedBrand[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("loved_brands").select("brands (id, name, logo_url, brand_styles (style_id, review_status))").order("created_at");
  return ((data ?? []) as unknown as { brands: { id: string; name: string; logo_url: string | null; brand_styles: { style_id: string; review_status: string }[] } }[]).map((r) => ({
    id: r.brands.id,
    name: r.brands.name,
    logo: r.brands.logo_url,
    styles: r.brands.brand_styles.filter((x) => x.review_status !== "rejected").map((x) => x.style_id),
  }));
}

export async function loveBrand(id: string, on: boolean, opts: { recommend?: boolean; country?: string; note?: string } = {}) {
  const userId = await currentUserId();
  if (!userId) return;
  const db = supabase().from("loved_brands");
  const { error } = on ? await db.upsert({ user_id: userId, brand_id: id, recommend: opts.recommend ?? true, country: opts.country ?? null, ...(opts.note !== undefined ? { note: opts.note } : {}) }) : await db.delete().eq("brand_id", id);
  if (error) console.error("Saving loved brand failed", error.message);
}

export async function setRecommendBrands(recommend: boolean) {
  const userId = await currentUserId();
  if (!userId) return;
  await supabase().from("loved_brands").update({ recommend }).eq("user_id", userId);
}

// Brands in the library whose name starts with or contains what they typed.
export async function searchBrands(q: string): Promise<{ id: string; name: string; logo: string | null }[]> {
  const term = q.trim().replace(/[%_,()]/g, "");
  if (term.length < 2 || !(await currentUserId())) return [];
  const { data } = await supabase().from("brands").select("id, name, logo_url").ilike("name", `%${term}%`).limit(8);
  const lower = term.toLowerCase();
  return (data ?? [])
    .map((b) => ({ id: b.id as string, name: b.name as string, logo: b.logo_url as string | null }))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(lower)) - Number(a.name.toLowerCase().startsWith(lower)));
}

export function lookupNewBrand(name: string, cityId: string) {
  return post<{ brand?: { id: string; name: string }; notice?: string }>("/api/style/brand", { name, cityId });
}

// Their brands ordered for them by Feta (what their photos showed, their
// styles, budget, loved brands), with a line on why; Feta Picks stay first.
// Kept for the session so going back and forth costs nothing.
export async function rankForMe(cards: BrandCard[], p: StyleProfile, countryName: string, loved: string[]): Promise<BrandCard[]> {
  if (cards.length < 2) return cards;
  const key = `feta.brandRank:${[p.styles.join(","), p.cues.join("|"), p.budget.join(","), p.wears, loved.join(","), cards.map((c) => `${c.id}:${c.style}`).sort().join(",")].join("#").slice(0, 2000)}`;
  let order: { id: string; why: string }[] | null = null;
  try {
    order = JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    // Not kept.
  }
  if (!order) {
    // One line per brand (a brand under two of their styles is ranked once).
    const unique = cards.filter((c, i) => cards.findIndex((x) => x.id === c.id) === i);
    const r = await post<{ order: { id: string; why: string }[] }>("/api/style/rank", {
      cues: p.cues,
      styles: p.styles,
      wears: p.wears,
      budget: p.budget,
      loved,
      country: countryName,
      brands: unique.map((c) => ({ id: c.id, name: c.name, style: c.style, cues: c.why, priceFeel: c.priceFeel, homegrown: c.homegrown, lovers: c.lovers ?? 0 })),
    });
    order = r?.order?.length ? r.order : null;
    if (order) {
      try {
        sessionStorage.setItem(key, JSON.stringify(order));
      } catch {
        // Not kept.
      }
    }
  }
  if (!order) return cards;
  const rank = new Map(order.map((o, i) => [o.id, i]));
  const why = new Map(order.map((o) => [o.id, o.why]));
  return cards
    .map((c) => ({ ...c, forYou: why.get(c.id) || undefined }))
    .sort((a, b) => Number(!!b.fetaPick) - Number(!!a.fetaPick) || (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

// The best few across their styles, taking turns, so one style doesn't fill
// the line (founder, 20 Nov 2026: "all streetwear").
export function acrossStyles(cards: BrandCard[], styles: string[], n: number): BrandCard[] {
  const out: BrandCard[] = [];
  const used = new Set<string>();
  const queues = styles.map((st) => cards.filter((c) => c.style === st));
  for (let round = 0; out.length < n && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      const c = q.slice(round).find((x) => !used.has(x.id));
      if (c && out.length < n) {
        out.push(c);
        used.add(c.id);
      }
    }
  }
  return out;
}
