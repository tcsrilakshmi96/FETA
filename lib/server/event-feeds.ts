import "server-only";
import type { City } from "@/lib/cities";
import type { FoundEvent, EventSpan } from "@/lib/server/events";
import type { Intent } from "@/lib/server/intents";

// Free official event feeds (founder, 23 Nov 2026: "build all the free event
// feeds"; research the same day): where a city publishes its events as open
// data, Feta reads them directly instead of paying for a web search (about
// ₹3 each). Facts and links only, with the source credited. A feed answers
// only for the kinds it can tell apart; for anything else (or a city with no
// feed) this returns null and the usual search runs.
//   Paris: "Que faire à Paris", Ville de Paris, ODbL (credit the source).
//   Taiwan: Ministry of Culture open data (arts and culture), open licence.
// Ticketmaster, SeatGeek, Skiddle and Korea's TourAPI need a key in her name;
// they plug in here once she has one.

type Window = { from: string; to: string }; // YYYY-MM-DD, the city's days

const memo = new Map<string, { at: number; events: FoundEvent[] }>();
const HOUR = 3600 * 1000;

export async function feedEvents(city: City, intent: Intent | null, span: EventSpan, days: string[]): Promise<FoundEvent[] | null> {
  const id = intent?.id.replace(/^interest_/, "") ?? null;
  const window = { from: days[0], to: days[days.length - 1] };
  if (city.id === PARIS) {
    const kind = id ? PARIS_KINDS[id] : PARIS_ANY;
    return kind ? cached(`paris|${JSON.stringify(kind)}|${window.from}|${window.to}`, () => paris(kind, window)) : null;
  }
  if (city.country === "TW" && TW_CITY[city.name]) {
    const cats = id ? TW_CATEGORIES[id] : TW_ANY;
    return cats ? cached(`tw|${city.name}|${cats.join(",")}|${window.from}|${window.to}`, () => taiwan(cats, TW_CITY[city.name], window)) : null;
  }
  return null;
}

async function cached(key: string, load: () => Promise<FoundEvent[]>): Promise<FoundEvent[] | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.events;
  try {
    const events = await load();
    memo.set(key, { at: Date.now(), events });
    return events;
  } catch (error) {
    console.error("Event feed", key, error);
    return null; // the usual search runs instead
  }
}

// ---------- Paris ----------

const PARIS = "gn:2988507";
// Their interest, in the feed's own categories (qfap_tags) and, where a
// category is broad (Atelier), the French words in the title.
type ParisKind = { tags?: string[]; title?: string[] };
const PARIS_KINDS: Record<string, ParisKind> = {
  live_music: { tags: ["Concert"] },
  comedy: { tags: ["Humour"] },
  dancing: { tags: ["Danse"] },
  class_dance: { tags: ["Danse"], title: ["cours", "atelier", "initiation", "stage"] },
  art_culture: { tags: ["Expo", "Art contemporain", "Photo"] },
  markets: { title: ["marché", "brocante", "vide-grenier", "salon"] },
  popups: { title: ["éphémère", "pop-up", "pop up"] },
  workshops: { tags: ["Atelier"] },
  class_pottery: { tags: ["Atelier"], title: ["céramique", "poterie", "argile", "modelage"] },
  class_painting: { tags: ["Atelier"], title: ["peinture", "dessin", "aquarelle", "croquis"] },
  class_cooking: { tags: ["Atelier"], title: ["cuisine", "pâtisserie", "culinaire"] },
  tastings: { title: ["dégustation"] },
  taste_wine: { title: ["dégustation de vin", "oenolog", "œnolog"] },
  outdoors: { tags: ["Balade urbaine", "Nature"] },
  hike_easy: { tags: ["Balade urbaine", "Nature"] },
  wellness: { title: ["yoga", "méditation", "bien-être"] },
  well_yoga: { title: ["yoga"] },
  games_sports: { tags: ["Sport"] },
};
const PARIS_ANY: ParisKind = { tags: ["Concert", "Expo", "Théâtre", "Humour", "Danse", "Cirque"] };

async function paris(kind: ParisKind, w: Window): Promise<FoundEvent[]> {
  const q = (v: string) => `"${v.replace(/"/g, "")}"`;
  const parts = [
    `date_end >= ${q(w.from)}`,
    `date_start <= ${q(`${w.to}T23:59:59`)}`,
    // For grown-ups: not the children's programme.
    `not qfap_tags like ${q("%Enfants%")}`,
    ...(kind.tags ? [`(${kind.tags.map((t) => `qfap_tags like ${q(`%${t}%`)}`).join(" or ")})`] : []),
    ...(kind.title ? [`(${kind.title.map((t) => `title like ${q(`%${t}%`)}`).join(" or ")})`] : []),
  ];
  const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records?limit=40&order_by=rank%20desc&where=${encodeURIComponent(parts.join(" and "))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Paris feed ${res.status}`);
  const data = (await res.json()) as { results?: ParisRecord[] };
  return (data.results ?? []).map(fromParis).filter((e): e is FoundEvent => !!e);
}

type ParisRecord = { title?: string; url?: string; date_start?: string; date_end?: string; address_name?: string; address_city?: string; price_type?: string; price_detail?: string; contact_url?: string; qfap_tags?: string };

function fromParis(r: ParisRecord): FoundEvent | null {
  if (!r.title || !r.url || !r.date_start || !r.address_name) return null;
  // A whole season or a programme page isn't an event ("Saison Cabaret"),
  // except an exhibition, which is on for weeks.
  const longDays = r.date_end ? (new Date(r.date_end).getTime() - new Date(r.date_start).getTime()) / 86400000 : 0;
  if (longDays > 45 && !/Expo/.test(r.qfap_tags ?? "")) return null;
  // Programme pages, giveaways and the city's own reviews aren't events.
  if (/programme|découvrez le|saison |^(décrochez|remportez|gagnez|tentez|on a vu)/i.test(r.title)) return null;
  const start = local(r.date_start, "Europe/Paris");
  // Midnight in UTC means the listing gives no time.
  const noTime = /T00:00:00(\+00:00|Z)$/.test(r.date_start);
  const end = r.date_end ? local(r.date_end, "Europe/Paris") : null;
  const free = r.price_type === "gratuit";
  const euros = /(\d+(?:[.,]\d+)?)\s*€/.exec(r.price_detail ?? "")?.[1];
  return {
    title: r.title.slice(0, 120),
    venueName: [r.address_name, r.address_city].filter(Boolean).join(", ").slice(0, 120),
    date: start.date,
    ...(end && end.date > start.date ? { endDate: end.date } : {}),
    time: noTime || start.time === "00:00" ? "" : start.time,
    priceText: free ? "Free" : euros ? `From €${euros}` : "",
    minPrice: free ? 0 : euros ? Number(euros.replace(",", ".")) : null,
    url: r.url,
    fromList: true,
  };
}

// ---------- Taiwan ----------

// Ministry of Culture categories: 1 music, 2 theatre, 3 dance, 4 family,
// 5 independent music, 6 exhibitions, 7 talks, 8 film, 17 concerts.
const TW_CATEGORIES: Record<string, string[]> = {
  live_music: ["1", "5", "17"],
  dancing: ["3"],
  class_dance: ["3"],
  art_culture: ["6", "2", "7"],
  popups: ["6"],
};
const TW_ANY = ["1", "6", "2"];
// The city in the feed's addresses.
const TW_CITY: Record<string, RegExp> = {
  Taipei: /臺北|台北/,
  "New Taipei": /新北/,
  Kaohsiung: /高雄/,
  Taichung: /臺中|台中/,
  Tainan: /臺南|台南/,
  Taoyuan: /桃園/,
  Hsinchu: /新竹/,
};

type TwShow = { time?: string; endTime?: string; location?: string; locationName?: string; price?: string };
type TwRecord = { title?: string; showInfo?: TwShow[]; sourceWebPromote?: string; webSales?: string; startDate?: string; endDate?: string };

async function taiwan(cats: string[], place: RegExp, w: Window): Promise<FoundEvent[]> {
  const lists = await Promise.all(
    cats.map(async (c) => {
      const res = await fetch(`https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=${c}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Taiwan feed ${res.status}`);
      return (await res.json()) as TwRecord[];
    }),
  );
  const out: FoundEvent[] = [];
  for (const r of lists.flat()) {
    const url = r.webSales || r.sourceWebPromote;
    if (!r.title || !url || !/^https:\/\//.test(url)) continue;
    // Its first show in this city within the window.
    const show = (r.showInfo ?? []).find((s) => s.time && place.test(`${s.location ?? ""}${s.locationName ?? ""}`) && dayOf(s.time) >= w.from && dayOf(s.time) <= w.to);
    if (!show?.time) continue;
    out.push({
      title: r.title.slice(0, 120),
      venueName: [show.locationName, show.location].filter(Boolean).join(", ").slice(0, 120),
      date: dayOf(show.time),
      time: show.time.slice(11, 16) === "00:00" ? "" : show.time.slice(11, 16),
      priceText: "",
      minPrice: null,
      url,
      fromList: true,
    });
    if (out.length >= 40) break;
  }
  return out;
}

const dayOf = (t: string) => t.slice(0, 10).replace(/\//g, "-");

// A timestamp as that city's date and time.
function local(iso: string, timeZone: string) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
