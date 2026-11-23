"use client";

import type { City } from "@/lib/cities";
import { distanceKm } from "@/lib/cities";
import { fetchNightPlaces, loadPlans, localDay } from "@/lib/night-client";
import { loadOrigin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";
import { brandPrice, shopLink, type BrandPrice, type Look, type LookFor, type Wears } from "@/lib/style";
import type { Currency } from "@/lib/currency";

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
  wardrobe: string[]; // pieces they have ("I have one"), used in every look
  offNotes: string[]; // what was off ("Too dressy"), so the next looks fix it
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
    // A stuck request gives up instead of leaving "Picking a look…" forever,
    // but never before the server would have answered: drawings take up to
    // 60 s there, reading photos up to 40 s.
    const wait = path.endsWith("/draw") ? 75000 : path.endsWith("/read") ? 45000 : 35000;
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(wait) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function loadStyleProfile(): Promise<StyleProfile | null> {
  if (!(await currentUserId())) return null;
  const { data } = await supabase().from("style_profiles").select("*").maybeSingle();
  if (!data) return null;
  return { wears: data.wears, styles: data.styles ?? [], readFromPhotos: data.read_from_photos ?? 0, budget: data.budget ?? [], homegrownOnly: !!data.homegrown_only, onYou: !!data.on_you, votes: data.outfit_votes ?? [], cues: data.cues ?? [], wardrobe: data.wardrobe ?? [], offNotes: data.off_notes ?? [] };
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
      wardrobe: p.wardrobe.slice(-40),
      off_notes: p.offNotes.slice(-12),
      city_id: city?.id ?? null,
      country: city?.country ?? null,
      time_zone: city?.timeZone ?? null,
      currency: city?.currency ?? null,
      updated_at: new Date().toISOString(),
    };
  let { error } = await supabase().from("style_profiles").upsert(row);
  // Before the wardrobe columns exist (migration 20261123100000), save the rest.
  if (error && /wardrobe|off_notes/.test(error.message)) {
    ({ error } = await supabase().from("style_profiles").upsert({ ...row, wardrobe: undefined, off_notes: undefined }));
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

// Whether today's limit leaves room for Style, asked before setup's questions.
export function styleLimit() {
  return post<{ notice?: string }>("/api/style/limit", {});
}

export function readStylePhotos(photos: string[], wears: Wears) {
  return post<{ photos?: { saw: string; styles: string[] }[]; styles?: { id: string; why: string; photos: number[] }[]; notice?: string }>("/api/style/read", { photos, wears });
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

// What Feta is dressing them for: a plan or place they chose (Plan my
// evening, "What to wear" on a plan or place), so Style uses it. Never Home's
// suggested plan (founder, 21 Nov 2026: "it has automatically chosen my plan
// for me"). Kept for the day on this phone, so reopening the app keeps it
// (review, 22 Nov 2026: a plan from "See the look" was gone after reopening).
const CHOSEN_FOR = "feta.style.for";
export function setWearFor(plan: TonightPlan) {
  setLookFor(lookForPlan(plan));
}
export function setLookFor(f: LookFor | null) {
  try {
    if (f) localStorage.setItem(CHOSEN_FOR, JSON.stringify({ f, day: cityDay() }));
    else localStorage.removeItem(CHOSEN_FOR);
  } catch {
    // Style asks instead.
  }
}
export function chosenLookFor(): LookFor | null {
  try {
    const kept = JSON.parse(localStorage.getItem(CHOSEN_FOR) ?? "null") as { f: LookFor; day: string } | null;
    return kept && kept.day === cityDay() ? kept.f : null;
  } catch {
    return null;
  }
}
export function lookForPlan(plan: TonightPlan, tomorrow = false): LookFor {
  return { key: `plan:${plan.stops.map((s) => s.name).join("|")}`.slice(0, 200), text: plan.title, where: "plan", stops: plan.stops, walkKm: plan.walkKm, tomorrow };
}

// From a plan on the phone (Plan my evening) or one place (its details).
const KIND_WORD: Record<string, string> = { EAT: "dinner", DRINK: "drinks", DO: "something to do" };
export function planFromStops(stops: { name: string; kind: string; time?: Date }[], walkKm: number | null): TonightPlan {
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(":00", "").replace(" ", "");
  return {
    stops: stops.map((s) => ({ name: s.name, kind: KIND_WORD[s.kind] ?? s.kind.toLowerCase(), time: s.time ? clock(s.time) : undefined })),
    walkKm: walkKm && walkKm < 3 ? walkKm : null,
    title: stops.map((s, i) => (i === 0 && s.time ? `${s.name} at ${clock(s.time)}` : s.name)).join(", then "),
  };
}

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
  const time = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  return {
    stops: places.map((p, i) => ({ name: p.name, kind: kindWord[p.kind], time: i === 0 ? time : undefined })),
    walkKm: walk && walk < 3 ? walk : null,
    title: `${places[0].name} at ${time}${places.length > 1 ? `, then ${places.length === 2 ? places[1].name : `${places.length - 1} more`}` : ""}`,
  };
}

// The city's clock (never the phone's: tester, 22 Nov 2026: "Sunday
// afternoon" in the morning): today's date there, the hour, and the time.
function cityZone() {
  return loadOrigin()?.city.timeZone;
}
export function cityDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const timeZone = cityZone();
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(d);
}
export function cityNow() {
  const timeZone = cityZone();
  const now = new Date();
  const z = timeZone ? { timeZone } : {};
  return {
    hour: Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, ...z }).format(now)) % 24,
    // With the date, so the stylist dresses for the season there.
    localTime: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, ...z }).format(now),
    clock: new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, ...z }).format(now).replace(" ", " "),
    date: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", ...z }).format(now).replace(",", ""),
  };
}

// The day's looks for one outing, kept on their account (migration
// 20261123100000) so the look stays put and comes back on any phone, and
// coming back costs nothing.
export type LookSet = { id: string; day: string; forKey: string; forText: string; forDetail: LookFor | null; setNo: number; looks: Look[]; chosen: number | null };
type SetRow = { id: string; day: string; for_key: string; for_text: string; for_detail: LookFor | null; set_no: number; looks: Look[]; chosen: number | null };
const setOf = (r: SetRow): LookSet => ({ id: r.id, day: r.day, forKey: r.for_key, forText: r.for_text, forDetail: r.for_detail ?? null, setNo: r.set_no, looks: r.looks ?? [], chosen: r.chosen });
const SET_COLS = "id, day, for_key, for_text, for_detail, set_no, looks, chosen";

export async function loadSet(day: string, forKey: string): Promise<LookSet | null> {
  if (!(await currentUserId())) return null;
  const { data } = await supabase().from("style_sets").select(SET_COLS).eq("day", day).eq("for_key", forKey).order("set_no", { ascending: false }).limit(1).maybeSingle();
  return data ? setOf(data as SetRow) : null;
}

// The look they chose for a day, whatever it was for.
export async function wornOn(day: string): Promise<LookSet | null> {
  if (!(await currentUserId())) return null;
  const { data } = await supabase().from("style_sets").select(SET_COLS).eq("day", day).not("chosen", "is", null).order("chosen_at", { ascending: false }).limit(1).maybeSingle();
  return data ? setOf(data as SetRow) : null;
}

// Looks you wore, newest first.
export async function wornLooks(limit = 12): Promise<LookSet[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("style_sets").select(SET_COLS).not("chosen", "is", null).order("chosen_at", { ascending: false }).limit(limit);
  return ((data ?? []) as SetRow[]).map(setOf);
}

export type LooksReply = { set?: LookSet; notice?: string; limited?: boolean };

// A new set of 3 looks for an outing (after "What's off?" or "3 more", the
// next set number, avoiding what was shown).
export async function newSet(f: LookFor, day: string, cityId: string, setNo: number, avoid: string[], city: City | null): Promise<LooksReply> {
  const res = await post<{ looks?: Look[]; notice?: string; limited?: boolean }>("/api/style/looks", { for: f, cityId, localTime: cityNow().localTime, avoid });
  if (!res) return { notice: "Feta couldn't reach the server. Check your connection and try again." };
  if (!res.looks?.length) return { notice: res.notice, limited: res.limited };
  const userId = await currentUserId();
  const row = { user_id: userId, day, for_key: f.key, for_text: f.text, for_detail: f, set_no: setNo, looks: res.looks, city_id: city?.id ?? null, country: city?.country ?? null, time_zone: city?.timeZone ?? null, currency: city?.currency ?? null };
  const { data, error } = await supabase().from("style_sets").upsert(row, { onConflict: "user_id,day,for_key,set_no" }).select(SET_COLS).single();
  if (error) console.error("Saving looks failed", error.message);
  return { set: data ? setOf(data as SetRow) : { id: "", day, forKey: f.key, forText: f.text, forDetail: f, setNo, looks: res.looks, chosen: null } };
}

// One piece changed, the rest kept; saved into the set.
export async function swapInSet(set: LookSet, f: LookFor, cityId: string, lookIndex: number, pieceIndex: number, tried: string[]): Promise<{ set?: LookSet; notice?: string }> {
  const res = await post<{ look?: Look; notice?: string }>("/api/style/looks", { for: f, cityId, localTime: cityNow().localTime, swap: { look: set.looks[lookIndex], index: pieceIndex, tried } });
  if (!res?.look) return { notice: res?.notice ?? "Couldn't find another one just now." };
  // A new id: the picture shows the new piece.
  const look = { ...res.look, id: `${set.looks[lookIndex].id}s${tried.length}` };
  const looks = set.looks.map((l, i) => (i === lookIndex ? look : l));
  if (set.id) await supabase().from("style_sets").update({ looks }).eq("id", set.id);
  return { set: { ...set, looks } };
}

// Wear this: one look a day (any earlier choice that day is let go).
export async function chooseLook(set: LookSet, index: number | null) {
  if (!set.id) return;
  if (index !== null) await supabase().from("style_sets").update({ chosen: null, chosen_at: null }).eq("day", set.day).not("chosen", "is", null);
  const { error } = await supabase().from("style_sets").update({ chosen: index, chosen_at: index === null ? null : new Date().toISOString() }).eq("id", set.id);
  if (error) console.error("Saving the look failed", error.message);
}

// A look's realistic picture, made once when it's shown (about ₹4) and kept
// on this phone under the look's id. On them when they added their photo.
const picturesAsked = new Map<string, Promise<string | null>>();
export function lookPicture(look: Look, wears: Wears): Promise<string | null> {
  const key = `pic:${look.id}`;
  const waiting = picturesAsked.get(key);
  if (waiting) return waiting;
  const work = (async () => {
    const kept = await fromPhone(key);
    if (kept) return kept;
    // One that failed today isn't tried again on every visit (₹4 a go).
    const failedKey = `feta.picFailed:${key}`;
    try {
      if (sessionStorage.getItem(failedKey)) return null;
    } catch {
      // Tried again.
    }
    const photo = await fromPhone("selfie");
    const r = await post<{ image?: string; spots?: ([number, number] | null)[] | null }>("/api/style/picture", { look, wears, photo });
    if (r?.image) await keepOnPhone(key, r.image);
    if (r?.image && r.spots) await keepOnPhone(`spots:${look.id}`, JSON.stringify(r.spots));
    else
      try {
        sessionStorage.setItem(failedKey, "1");
      } catch {
        // Tried again next time.
      }
    return r?.image ?? null;
  })();
  picturesAsked.set(key, work);
  return work;
}
// Their photo added after a look's picture was made: that picture goes, so
// the next one is made on them.
export async function forgetPicture(look: Look) {
  const key = `pic:${look.id}`;
  picturesAsked.delete(key);
  await keepOnPhone(key, null);
  await keepOnPhone(`spots:${look.id}`, null);
  try {
    sessionStorage.removeItem(`feta.picFailed:${key}`);
  } catch {
    // Nothing to clear.
  }
}
// Where each piece sits in the look's picture (x, y as fractions), when known.
export async function keptSpots(look: Look): Promise<([number, number] | null)[] | null> {
  try {
    const v = JSON.parse((await fromPhone(`spots:${look.id}`)) ?? "null");
    return Array.isArray(v) && v.length === look.pieces.length ? v : null;
  } catch {
    return null;
  }
}
export async function keptPicture(look: Look): Promise<string | null> {
  return fromPhone(`pic:${look.id}`);
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
  price: BrandPrice; // from a checked price in their currency, else "explore"
  link: { href: string; label: string }; // their country's store, never another's
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
  brands: { id: string; name: string; website: string | null; logo_url: string | null; origin_country: string | null; wears: string | null; brand_markets: Market[] };
};
type Market = { country: string; presence_type: string; presence_url: string | null; presence_ok: boolean | null; price_feel: string | null; sample_price: number | null; sample_currency: string | null; checked_date: string | null };
const MARKET = "country, presence_type, presence_url, presence_ok, price_feel, sample_price, sample_currency, checked_date";

// Research notes meant for the founder, not for people ("(MX URL live,
// bot-blocked to scripts)", "Viewed catalog:"), taken out of what's shown.
// The research's notes, as a line about the clothes: no prices or where
// it's stocked (audit, 20 Nov 2026: "2,499 to 3,499 INR; Shoppers Stop…").
function cleanCues(t: string) {
  return t
    .replace(/\([^)]*(url|bot|script|verified|evidence|blocked|checked|pending|inspected|own page|document)[^)]*\)/gi, "")
    .replace(/^(viewed catalog|inspected|observed)\s*:\s*/i, "")
    .split(/;\s*/)
    .map((part) => part.replace(/[,(]?\s*(?:[₹$€£]|\b(?:INR|USD|EUR|GBP|AED|Rs\.?)\b)\s*[\d,.]+.*$|[,(]?\s*\b[\d,.]+\s*(?:to|–|-)\s*[\d,.]+\s*(?:INR|USD|EUR|GBP|AED|Rs)\b.*$/i, "").trim())
    .filter((part) => part && !/\b(stocked|sold at|available at|retail(?:er|s)?|stockists?|marketplace|price[sd]?)\b/i.test(part))
    // A part that is only names ("Shoppers Stop and Myntra") is where it's sold.
    .filter((part) => !/^(?:[A-Z][\w'&.-]*(?:\s+|$)|(?:and|&)\s+|,\s*)+$/.test(part))
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Brands above their clothes budget are left out, as places above their
// spend are (founder, 21 Nov 2026: a tester saw brands over her budget), and
// so is one with no price and no price level (founder, 22 Nov 2026: shown
// only when research puts it in their range); one they love themselves
// stays. Priced ones come before "prices not checked" ones (`brandPrice`).
export type BrandCity = { country: string; countryName: string; currency: Currency };
export async function brandsFor(styles: string[], city: BrandCity, wears: Wears, budget: string[]): Promise<BrandCard[]> {
  const { country, countryName, currency } = city;
  if (!styles.length || !(await currentUserId())) return [];
  const { data, error } = await supabase()
    .from("brand_styles")
    .select(`style_id, association, visible_cues, review_status, brands!inner (id, name, website, logo_url, origin_country, wears, brand_markets!inner (${MARKET}))`)
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
      why: cleanCues(r.visible_cues),
      style: r.style_id,
      priceFeel: market!.price_feel,
      price: brandPrice(market!, budget, currency),
      link: shopLink(r.brands, market!, country, countryName, wears),
      approved: r.review_status === "approved",
    }));
  // Feta Picks (the founder's brands) first, then the ones people love most;
  // within those, the order above.
  // Their own tag changes: a style they removed from a brand hides it there;
  // a style they added shows the brand there too.
  const votes = await myTagVotes();
  const removed = new Set(votes.filter((v) => v.vote === -1).map((v) => `${v.brand_id}|${v.style_id}`));
  const added = votes.filter((v) => v.vote === 1 && styles.includes(v.style_id) && !cards.some((c) => c.id === v.brand_id && c.style === v.style_id));
  if (added.length) {
    const { data: extra } = await supabase().from("brands").select(`id, name, website, logo_url, origin_country, wears, brand_markets!inner (${MARKET})`).in("id", [...new Set(added.map((v) => v.brand_id))]).eq("brand_markets.country", country);
    for (const v of added) {
      const b = (extra ?? []).find((x) => x.id === v.brand_id) as unknown as Row["brands"] | undefined;
      const market = b?.brand_markets?.[0];
      if (b && market && market.presence_type !== "ships from abroad")
        cards.push({ id: b.id, name: b.name, website: b.website, logo: b.logo_url, homegrown: b.origin_country === country, why: "You tagged it", style: v.style_id, priceFeel: market.price_feel, price: brandPrice(market, budget, currency), link: shopLink(b, market, country, countryName, wears), approved: true });
    }
  }
  for (let i = cards.length - 1; i >= 0; i--) if (removed.has(`${cards[i].id}|${cards[i].style}`)) cards.splice(i, 1);
  const [love, mine] = await Promise.all([brandLove(cards.map((c) => c.id)), lovedBrandIds()]);
  const ranked: BrandCard[] = cards.map((c) => ({ ...c, ...love.get(c.id), youLove: mine.has(c.id) })).filter((c) => c.youLove || c.price.fit !== "above");
  // A stable sort keeps the order above within each group.
  return ranked.sort((a, b) => Number(!!b.fetaPick) - Number(!!a.fetaPick) || (b.lovers ?? 0) - (a.lovers ?? 0) || Number(b.price.fit === "fits") - Number(a.price.fit === "fits"));
}

export async function savedBrandIds(): Promise<Set<string>> {
  if (!(await currentUserId())) return new Set();
  const { data } = await supabase().from("saved_brands").select("brand_id");
  return new Set((data ?? []).map((r) => r.brand_id as string));
}

export async function toggleSavedBrand(b: Pick<BrandCard, "id" | "style">, on: boolean, country: string) {
  const userId = await currentUserId();
  if (!userId) return;
  const db = supabase().from("saved_brands");
  const { error } = on ? await db.upsert({ user_id: userId, brand_id: b.id, style_id: b.style, country }) : await db.delete().eq("brand_id", b.id);
  if (error) console.error("Saving brand failed", error.message);
}

export type SavedBrand = { id: string; name: string; website: string | null; logo: string | null; style: string | null; country: string | null; link: { href: string; label: string } | null };

export async function loadSavedBrands(): Promise<SavedBrand[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("saved_brands").select(`style_id, country, brands (id, name, website, logo_url, brand_markets (${MARKET}))`).order("created_at", { ascending: false });
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  // The link for the country it was saved in, never the brand's other sites.
  return ((data ?? []) as unknown as { style_id: string | null; country: string | null; brands: { id: string; name: string; website: string | null; logo_url: string | null; brand_markets: Market[] } }[]).map((r) => {
    const market = r.brands.brand_markets?.find((m) => m.country === r.country);
    return {
      id: r.brands.id,
      name: r.brands.name,
      website: r.brands.website,
      logo: r.brands.logo_url,
      style: r.style_id,
      country: r.country,
      link: r.country ? shopLink(r.brands, market ?? { presence_url: null }, r.country, names.of(r.country) ?? r.country) : null,
    };
  });
}

// Feta's own research for every style in their country (founder, 20 Nov
// 2026). Each style is claimed and researched on the server in the
// background (about 2 minutes), so nobody waits on the screen: their own
// styles, thinnest first, all at once. Only styles someone there chose
// (founder, 21 Nov 2026: three more per visit for styles nobody chose cost
// most of a day's Gemini credit). While the screen is open it checks back
// every 30 seconds and shows new brands.
// Once per country per visit (it was once per visit: opening London then
// Berlin never started Berlin, tester 22 Nov 2026).
const started = new Set<string>();

async function startResearch(style: string, cityId: string, more = false) {
  const r = await post<{ started?: boolean; skipped?: string }>("/api/style/research", { style, cityId, more });
  return r?.started ? "started" : (r?.skipped ?? "failed");
}

// Checks back while research runs: calls onDone with styles that finished.
function watch(country: string, styles: string[], onDone: (style: string) => void, onResearching: (styles: string[]) => void) {
  const left = new Set(styles);
  onResearching([...left]);
  const since = Date.now();
  const tick = async () => {
    if (!left.size || Date.now() - since > 6 * 60000) {
      onResearching([]);
      return;
    }
    if (!document.hidden) {
      const { data } = await supabase().from("style_research").select("style_id, done, researched_at").eq("country", country).in("style_id", [...left]);
      for (const r of data ?? []) {
        if (r.done && new Date(r.researched_at).getTime() >= since - 5000) {
          left.delete(r.style_id as string);
          onDone(r.style_id as string);
        }
      }
      onResearching([...left]);
    }
    setTimeout(tick, 30000);
  };
  setTimeout(tick, 30000);
}

export async function researchCountry(cityId: string, country: string, mine: { style: string; brands: number }[], onDone: (style: string) => void, onResearching?: (styles: string[]) => void) {
  if (started.has(country) || !(await currentUserId())) return;
  started.add(country);
  const { data } = await supabase().from("style_research").select("style_id, researched_at, done").eq("country", country);
  const fresh = new Set((data ?? []).filter((r) => r.done && Date.now() - new Date(r.researched_at).getTime() < 120 * 86400000).map((r) => r.style_id as string));
  const myOrder = [...mine].sort((a, b) => a.brands - b.brands).map((m) => m.style).filter((id) => !fresh.has(id));
  const results = await Promise.all(myOrder.map(async (id) => [id, await startResearch(id, cityId)] as const));
  const running = results.filter(([, r]) => r === "started" || r === "done or running").map(([id]) => id);
  if (running.length) watch(country, running, onDone, onResearching ?? (() => {}));
}

// "Find more brands" for one style: another round now, for brands Feta
// doesn't have yet. Returns what happened, in plain words.
export async function findMoreBrands(style: string, cityId: string, country: string, onDone: (style: string) => void, onResearching: (styles: string[]) => void): Promise<string | null> {
  const r = await startResearch(style, cityId, true);
  if (r === "started" || r === "done or running") {
    watch(country, [style], onDone, onResearching);
    return null;
  }
  return r === "budget" ? "Feta has done all its brand research for today. Try again tomorrow." : "Feta couldn't start looking just now. Try again in a bit.";
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

// People's own style tags on a brand (founder, 20 Nov 2026: "users can add
// or edit the tags associated with the brands"). Their change shows to them
// at once; when 2 people agree, the database changes it for everyone.
export async function brandTags(brandId: string): Promise<{ tags: string[]; mine: Record<string, 1 | -1> }> {
  const [{ data: rows }, { data: votes }] = await Promise.all([
    supabase().from("brand_styles").select("style_id").eq("brand_id", brandId).neq("review_status", "rejected"),
    supabase().from("brand_tag_votes").select("style_id, vote").eq("brand_id", brandId),
  ]);
  const mine = Object.fromEntries((votes ?? []).map((v) => [v.style_id as string, v.vote as 1 | -1]));
  const base = (rows ?? []).map((r) => r.style_id as string);
  const tags = [...new Set([...base.filter((t) => mine[t] !== -1), ...Object.keys(mine).filter((t) => mine[t] === 1)])];
  return { tags, mine };
}

export async function setTagVote(brandId: string, styleId: string, vote: 1 | -1 | null) {
  const userId = await currentUserId();
  if (!userId) return;
  const db = supabase().from("brand_tag_votes");
  const { error } = vote === null ? await db.delete().eq("brand_id", brandId).eq("style_id", styleId) : await db.upsert({ user_id: userId, brand_id: brandId, style_id: styleId, vote });
  if (error) console.error("Saving tag failed", error.message);
}

// Their own tag changes, applied to a brand list for them.
async function myTagVotes(): Promise<{ brand_id: string; style_id: string; vote: number }[]> {
  const { data, error } = await supabase().from("brand_tag_votes").select("brand_id, style_id, vote");
  return error ? [] : ((data ?? []) as { brand_id: string; style_id: string; vote: number }[]);
}

// Whether they recommend the brands they shop from (asked once, on the first
// ♥; switchable in My style). null: not asked yet.
export async function recommendSetting(): Promise<boolean | null> {
  if (!(await currentUserId())) return null;
  const { data } = await supabase().from("loved_brands").select("recommend").limit(1).maybeSingle();
  return data ? !!data.recommend : null;
}

// Wear it again (from Looks you wore): today's look, no new looks and no new
// picture to make (the picture is kept under the same look id).
export async function wearAgain(look: Look, city: City | null): Promise<LookSet | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const day = cityDay();
  const f: LookFor = { key: `again:${look.id}`, text: `Again: ${look.title}`, where: "day", stops: [], walkKm: null };
  await supabase().from("style_sets").update({ chosen: null, chosen_at: null }).eq("day", day).not("chosen", "is", null);
  const row = { user_id: userId, day, for_key: f.key, for_text: f.text, for_detail: f, set_no: 0, looks: [look], chosen: 0, chosen_at: new Date().toISOString(), city_id: city?.id ?? null, country: city?.country ?? null, time_zone: city?.timeZone ?? null, currency: city?.currency ?? null };
  const { data, error } = await supabase().from("style_sets").upsert(row, { onConflict: "user_id,day,for_key,set_no" }).select(SET_COLS).single();
  if (error) console.error("Saving the look failed", error.message);
  setLookFor(f);
  return data ? setOf(data as SetRow) : null;
}
