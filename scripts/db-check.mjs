// The real database, as the app uses it (24 Nov 2026: three audits in a row
// found rules that only failed on the live database, like the share check
// that stopped WhatsApp sharing, while every check ran on made-up data).
// A test account (the tester code) makes the writes the app makes: shares
// of each kind, a kept list, a visit, its usual brands, and checks that
// what should be refused is. ₹0: no Google, Gemini or Venice. The account
// is deleted at the end. Run after any migration: npm run db-check.
import { createClient } from "@supabase/supabase-js";

const { NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY, QA_CODE } = process.env;
if (!URL || !KEY || !QA_CODE) {
  console.error("Needs .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, QA_CODE).");
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const ok = (name, pass, detail = "") => results.push(`${pass ? "✓" : "✗"} ${name}${!pass && detail ? ` (${detail})` : ""}`);

const { data: auth, error: signIn } = await db.auth.signInAnonymously();
if (signIn || !auth.user) {
  console.error("Couldn't sign in a test account:", signIn?.message);
  process.exit(1);
}
const me = auth.user.id;
try {
  const { error: test } = await db.rpc("mark_test", { p_code: QA_CODE });
  ok("A test account is marked as a test", !test, test?.message);

  // Shares exactly as the app builds them (PickDetails, LetsGo, PlanSheet, NightPlan).
  const place = "ChIJdbCheckPlace0000000001";
  const place2 = "ChIJdbCheckPlace0000000002";
  const share = async (kind, payload) => {
    const { data, error } = await db.from("shares").insert({ user_id: me, kind, payload }).select("slug").single();
    return { slug: data?.slug, error: error?.message };
  };
  const pick = await share("pick", { title: "A pick", stops: [{ placeId: place, kind: "EAT" }] });
  ok("Share a pick", !pick.error, pick.error);
  const at = new Date().toISOString();
  const plan = await share("plan", { title: "Tonight", travel: { km: 1.2, minutes: 15, mode: "walk" }, country: "IN", stops: [{ placeId: place, kind: "EAT", time: at }, { placeId: place2, kind: "DRINK", time: at }] });
  ok("Share a plan", !plan.error, plan.error);
  const night = await share("plan", { title: "Saturday", country: "PT", stops: [{ placeId: place, kind: "EAT", time: at }] });
  ok("Share a planned night", !night.error, night.error);
  const choice = await share("choice", { title: "Friday", country: "GB", options: [{ title: "Friday", stops: [{ placeId: place, kind: "EAT", time: at }] }, { title: "Friday", travel: { km: 2, minutes: 8, mode: "ride" }, stops: [{ placeId: place2, kind: "DO", time: at }] }] });
  ok("Share a choice of plans", !choice.error, choice.error);
  const dated = await share("pick", { title: "Fri 28 · 8:00 pm", stops: [{ placeId: place, kind: "DO" }] });
  ok("Share titled with an event's day and time", !dated.error, dated.error);

  // An event Feta found, shared as found.
  const { data: cached } = await db.from("events_cache").select("events").limit(200);
  const found = (cached ?? []).flatMap((r) => (Array.isArray(r.events) ? r.events : [])).find((e) => e && /^https?:\/\//.test(e.url ?? "") && e.title);
  if (found) {
    const ev = await share("pick", { title: "Soon", stops: [{ placeId: `event:${found.url}`, kind: "EVENT", event: { title: found.title, venueName: found.venueName ?? "", date: found.date ?? "", time: found.time ?? "", url: found.url, site: "Time Out" } }] });
    ok("Share an event Feta found", !ev.error, ev.error);
  } else results.push("· Share an event Feta found: no fresh events in the cache to try (skipped)");

  // What must be refused.
  const fake = await share("pick", { title: "Soon", stops: [{ placeId: "event:https://example.com/x", kind: "EVENT", event: { title: "Free tickets", venueName: "", date: "", time: "", url: "https://example.com/x", site: "Feta Pay" } }] });
  ok("A made-up event can't be shared", !!fake.error);
  const words = await share("pick", { title: "Call 9876543210 now", stops: [{ placeId: place, kind: "EAT" }] });
  ok("A share can't carry a phone number or own words", !!words.error);
  const note = await share("pick", { title: "A pick", stops: [{ placeId: place, kind: "EAT", fetaNote: "Pay at example.com" }] });
  ok("A share can't carry a made-up Feta note", !!note.error);
  const badge = await share("pick", { title: "A pick", stops: [{ placeId: place, kind: "EAT", fetaNote: "" }] });
  ok("A share can't put a ★ Feta pick badge on a place that isn't hers", !!badge.error);
  // A share can point only at the sharer's own saved plan (migration 20261126090000).
  const { data: mine } = await db.from("saved_plans").insert({ user_id: me, day: new Date().toISOString().slice(0, 10), start_minute: 1170, place_ids: [place, place2], country: "IN", time_zone: "Asia/Kolkata", currency: "INR" }).select("id").single();
  const own = await db.from("shares").insert({ user_id: me, kind: "pick", payload: { title: "A pick", stops: [{ placeId: place, kind: "EAT" }] }, plan_id: mine?.id }).select("slug").single();
  ok("A share of their own saved plan", !!mine?.id && !own.error, own.error?.message);
  const other = await db.from("shares").insert({ user_id: me, kind: "pick", payload: { title: "A pick", stops: [{ placeId: place, kind: "EAT" }] }, plan_id: "00000000-0000-4000-8000-000000000001" }).select("slug").single();
  ok("A share can't point at someone else's saved plan", !!other.error);

  // Marking replies seen still works on a share.
  if (plan.slug) {
    const { error } = await db.from("shares").update({ replies_seen_at: new Date().toISOString() }).eq("slug", plan.slug);
    ok("Marking a plan's replies as seen", !error, error?.message);
    const { error: rekind } = await db.from("shares").update({ kind: "choice" }).eq("slug", plan.slug);
    const { data: still } = await db.from("shares").select("kind").eq("slug", plan.slug).single();
    ok("A share's kind can't be changed", !!rekind || still?.kind === "plan");
  }
  if (pick.slug) {
    const { data: read } = await db.rpc("get_share", { share_slug: pick.slug });
    ok("A friend can open a share", Array.isArray(read) && read.length === 1);
    const { error: vote } = await db.rpc("cast_vote", { share_slug: pick.slug, voter_id: "db-check", voter_name: "Check", choice: "yes" });
    ok("A friend can reply In", !vote, vote?.message);
  }

  // A kept list: its places can change, its date can't.
  const { data: set, error: setErr } = await db.from("pick_sets").insert({ user_id: me, category: "food_drinks", when_slot: "tonight", origin_key: "db-check", city_id: "gn:1277333", country: "IN", time_zone: "Asia/Kolkata", currency: "INR", picks: [], searched: [], expires_at: new Date(Date.now() + 3600e3).toISOString() }).select("id, created_at").single();
  ok("A kept list is saved", !setErr, setErr?.message);
  if (set) {
    const { error: up } = await db.from("pick_sets").update({ picks: [{ placeId: place, kind: "EAT" }] }).eq("id", set.id);
    ok("A kept list's places can be updated (late events)", !up, up?.message);
    await db.from("pick_sets").update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", set.id);
    const { data: after } = await db.from("pick_sets").select("created_at").eq("id", set.id).single();
    ok("A kept list's date can't be changed", after?.created_at === set.created_at);
    const { error: del } = await db.from("pick_sets").delete().eq("id", set.id);
    const { data: gone } = await db.from("pick_sets").select("id").eq("id", set.id);
    ok("A kept list can't be deleted", !!del || (gone ?? []).length === 1);
  }

  // A visit is for today.
  const { error: visit } = await db.from("visits").insert({ user_id: me, day: "2020-01-01" });
  const { data: visits } = await db.from("visits").select("day").eq("user_id", me);
  ok("A visit is recorded for today", !visit && (visits ?? []).every((v) => v.day !== "2020-01-01"), visit?.message);

  // Brands as Style reads them.
  const { error: brands } = await db.from("brands").select("id, name").limit(5);
  ok("Brands can be read", !brands, brands?.message);
  const { error: loved } = await db.from("loved_brands").select("brands (id, name, logo_url, brand_styles (style_id, review_status))").limit(5);
  ok("Usual brands can be read", !loved, loved?.message);
  // Inspiration photos kept on the account (26 Nov 2026), as Style setup writes them.
  const photo = "data:image/jpeg;base64,/9j/" + "A".repeat(200000);
  const { error: inspo } = await db.from("style_inspiration").upsert({ photos: [photo, photo], reads: [{ saw: "linen shirt", styles: ["minimal"] }], updated_at: new Date().toISOString() });
  ok("Inspiration photos can be kept on the account", !inspo, inspo?.message);
  const { data: back, error: inspoRead } = await db.from("style_inspiration").select("photos, reads").maybeSingle();
  ok("Inspiration photos come back", !inspoRead && back?.photos?.length === 2, inspoRead?.message);
  const { error: tooMany } = await db.from("style_inspiration").upsert({ photos: Array(9).fill("data:x"), reads: [] });
  ok("More than 8 inspiration photos are refused", !!tooMany);

  // Server-only things stay server-only.
  const { error: cache } = await db.from("events_cache").insert({ key: "db-check", events: [], search_html: "", expires_at: new Date().toISOString() });
  ok("The events cache can't be written by an account", !!cache);
  const { error: cost } = await db.from("api_costs").insert({ route: "db-check", sku: "places_photo", units: 1, est_inr: 0 });
  ok("The cost log can't be written by an account", !!cost);
  const { error: count } = await db.rpc("feta_love_counts", { p_place_ids: [place] });
  ok("Love counts work for a signed-in account", !count, count?.message);
} finally {
  const { error } = await db.rpc("delete_my_data");
  ok("The test account is deleted", !error, error?.message);
}
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("✗")) ? 1 : 0);
