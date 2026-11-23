import { FAKE } from "@/lib/server/fake-places";
import { cityById } from "@/lib/server/cities";
import { askIs, limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { makeLooks, swapPiece, type LookAsk } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { SLOTS, WHERES, styleById, type Look, type LookFor, type Slot, type Where } from "@/lib/style";

export const maxDuration = 45;

// What to wear (founder, 22–23 Nov 2026, docs/style-spec.md): 3 complete
// looks for one outing, or one piece of a look changed. What they are,
// their wardrobe, usual brands and what was off are read here from their
// account, not taken from the phone.
const t = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function forOf(x: unknown): LookFor | null {
  const f = x as Partial<LookFor> | null;
  if (!f || typeof f !== "object") return null;
  const where = f.where === "plan" || WHERES.some((w) => w.id === f.where) ? (f.where as Where | "plan") : null;
  if (!where) return null;
  return {
    key: t(f.key, 200),
    text: t(f.text, 120),
    where,
    stops: (Array.isArray(f.stops) ? f.stops : []).slice(0, 5).map((s) => ({ name: t(s.name, 60), kind: t(s.kind, 40), time: s.time ? t(s.time, 12) : undefined })),
    walkKm: typeof f.walkKm === "number" && Number.isFinite(f.walkKm) ? f.walkKm : null,
    place: f.place ? t(f.place, 160) : undefined,
    setting: (Array.isArray(f.setting) ? f.setting : []).slice(0, 4).map((s) => t(s, 30)),
    avoid: f.avoid ? t(f.avoid, 160) : undefined,
    own: f.own ? t(f.own, 80) : undefined,
    tomorrow: !!f.tomorrow,
  };
}

function lookOf(x: unknown): Look | null {
  const l = x as Partial<Look> | null;
  if (!l || !Array.isArray(l.pieces) || !styleById(String(l.style))) return null;
  return {
    id: t(l.id, 40),
    style: String(l.style),
    title: t(l.title, 60),
    why: t(l.why, 220),
    pieces: l.pieces.slice(0, 6).filter((p) => SLOTS.includes(p.slot as Slot)).map((p) => ({ slot: p.slot as Slot, name: t(p.name, 60) })),
  };
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  const userId = token && db ? await userIdFor(db, token) : null;
  if (!db || !userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { for?: unknown; cityId?: string; localTime?: string; avoid?: string[]; swap?: { look?: unknown; index?: number; tried?: string[] } };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const lookFor = forOf(body.for);
  if (!lookFor) return Response.json({ error: "Bad request" }, { status: 400 });
  const [{ data: p }, { data: loved }, { data: worn }] = await Promise.all([
    db.from("style_profiles").select("*").maybeSingle(),
    db.from("loved_brands").select("brands (name)"),
    db.from("style_sets").select("looks, chosen").not("chosen", "is", null).order("chosen_at", { ascending: false }).limit(8),
  ]);
  const styles: string[] = (p?.styles ?? []).filter((s: string) => styleById(s)).slice(0, 6);
  if (!styles.length) return Response.json({ error: "No styles" }, { status: 400 });
  if (!FAKE && (await overBudget(db))) return Response.json({ notice: await limitNoticeHere("style"), limited: true });
  const ask: LookAsk = {
    styles,
    wears: p?.wears === "men" || p?.wears === "both" ? p.wears : "women",
    for: lookFor,
    city: cityById(body.cityId)?.name ?? "their city",
    localTime: t(body.localTime, 48),
    count: 3,
    wardrobe: (p?.wardrobe ?? []).slice(0, 30),
    usuals: ((loved ?? []) as unknown as { brands: { name: string } | null }[]).map((r) => r.brands?.name).filter((n): n is string => !!n),
    cues: (p?.cues ?? []).slice(0, 8),
    worn: ((worn ?? []) as { looks: Look[]; chosen: number }[]).map((r) => r.looks?.[r.chosen]?.title).filter((x): x is string => !!x),
    off: (p?.off_notes ?? []).slice(-6),
    avoid: (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 9).map((a) => t(a, 160)),
  };
  if (body.swap) {
    const look = lookOf(body.swap.look);
    const index = Number(body.swap.index);
    if (!look || !Number.isInteger(index) || !look.pieces[index]) return Response.json({ error: "Bad request" }, { status: 400 });
    return withCosts(db, "style_swap", async () => {
    askIs({ key: [look.id, index, (body.swap?.tried ?? []).length], label: `swap a ${look.pieces[index].slot}` });
      try {
        return Response.json({ look: await swapPiece(ask, look, index, (body.swap?.tried ?? []).slice(0, 6).map((x) => t(x, 60))) });
      } catch (error) {
        console.error(error);
        return Response.json({ notice: "Couldn't find another one just now." });
      }
    });
  }
  return withCosts(db, "style_looks", async () => {
    askIs({ key: [lookFor.key, ask.avoid.length], label: `looks · ${lookFor.where}${lookFor.tomorrow ? " · tomorrow" : ""}` });
    try {
      return Response.json({ looks: await makeLooks(ask) });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Feta couldn't put looks together just now. Try again in a moment." });
    }
  });
}
