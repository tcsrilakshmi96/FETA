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

export async function createShare(kind: ShareKind, payload: SharePayload | ChoicePayload): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase().from("shares").insert({ user_id: userId, kind, payload }).select("slug").single();
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
