"use client";

import { currentUserId, supabase } from "@/lib/supabase";

// Send to the group: a pick or a plan as a Feta link that friends can open
// and vote on without signing up. The share holds place IDs, event links
// and Feta's own words only (never diet).

export type ShareStop = {
  placeId: string;
  kind: string;
  time?: string; // ISO, for plans
  because?: string;
  fetaNote?: string;
  event?: { title: string; venueName: string; date: string; time: string; url: string; site: string };
};

export type SharePayload = {
  title: string; // "Tonight" or "Saturday"
  stops: ShareStop[];
  travel?: { km: number; minutes: number; mode: "walk" | "ride" };
  country?: string; // for km or miles
};

// "Let the group choose": 2-3 plans; friends vote for one ("1", "2", "3").
export type ChoicePayload = { title: string; options: SharePayload[]; country?: string };
export type ShareKind = "pick" | "plan" | "choice";
export type Vote = "yes" | "no" | "1" | "2" | "3";

// planId: the saved plan it was shared from, so its replies show there.
export async function createShare(kind: ShareKind, payload: SharePayload | ChoicePayload, planId?: string | null): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase().from("shares").insert({ user_id: userId, kind, payload, ...(planId ? { plan_id: planId } : {}) }).select("slug").single();
  if (error) {
    console.error("Creating share failed", error.message);
    return null;
  }
  return `${window.location.origin}/s/${data.slug}`;
}

export async function loadShare(slug: string) {
  const { data } = await supabase().rpc("get_share", { share_slug: slug });
  const row = (data ?? [])[0] as { kind: ShareKind; payload: SharePayload & ChoicePayload } | undefined;
  return row ?? null;
}

export async function loadVotes(slug: string) {
  const { data } = await supabase().rpc("share_votes_for", { share_slug: slug });
  return (data ?? []) as { name: string | null; vote: Vote }[];
}

// A random id kept in this browser, so a friend's vote can change but not repeat.
function voterId() {
  try {
    let id = localStorage.getItem("feta.voter");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("feta.voter", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export async function castVote(slug: string, name: string, vote: Vote) {
  const { error } = await supabase().rpc("cast_vote", { share_slug: slug, voter_id: voterId(), voter_name: name, choice: vote });
  if (error) console.error("Vote failed", error.message);
  return !error;
}

// Who's in (founder, 17 Nov 2026): my own shares with my friends' replies,
// newest first. A reply is new if it came after I last looked.
export type Reply = { name: string | null; vote: Vote; at: string };
export type MyShare = { slug: string; kind: ShareKind; payload: SharePayload & ChoicePayload; createdAt: string; planId: string | null; seenAt: string | null; replies: Reply[] };

export async function loadMyShares(): Promise<MyShare[]> {
  if (!(await currentUserId())) return [];
  const db = supabase();
  const [{ data: shares }, { data: replies }] = await Promise.all([
    db.from("shares").select("slug, kind, payload, created_at, plan_id, replies_seen_at").order("created_at", { ascending: false }).limit(30),
    db.rpc("my_share_replies"),
  ]);
  const bySlug = new Map<string, Reply[]>();
  for (const r of (replies ?? []) as { slug: string; name: string | null; vote: Vote; replied_at: string }[]) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), { name: r.name, vote: r.vote, at: r.replied_at }]);
  return (shares ?? []).map((s) => ({ slug: s.slug, kind: s.kind, payload: s.payload, createdAt: s.created_at, planId: s.plan_id ?? null, seenAt: s.replies_seen_at ?? null, replies: bySlug.get(s.slug) ?? [] }));
}

export const newReplies = (s: MyShare) => s.replies.filter((r) => !s.seenAt || r.at > s.seenAt);

export async function markRepliesSeen(slugs: string[]) {
  if (!slugs.length || !(await currentUserId())) return;
  await supabase().from("shares").update({ replies_seen_at: new Date().toISOString() }).in("slug", slugs);
}

export const shareLink = (slug: string) => `${window.location.origin}/s/${slug}`;
