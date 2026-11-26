"use client";

import { supabase } from "@/lib/supabase";

// Inspiration photos follow the person to their Google account (founder,
// 26 Nov 2026). Someone who hung up photos on this phone's anonymous account
// and then signs in to a Google account that already has Feta moves to that
// account; the anonymous one is left behind (or deleted), and its photos
// with it, out of their reach. So, just before going to Google, the photos
// are taken off the anonymous account and kept on this phone for a short
// while; back from Google, a Google account with no photos of its own gets
// them, with the styles chosen alongside them (founder, 26 Nov 2026: the
// photo came but its styles didn't): added after the account's own styles,
// or the whole Style setup when the account has none; an account with photos
// of its own keeps its whole Style as it is. The phone's copy goes either way. Only within 30 minutes, so an
// abandoned sign-in never hands them to whoever signs in on this phone later.
const DB = "feta-carry";
export const CARRY_KEY = "feta.carry";
const FOR = 30 * 60 * 1000;
type Profile = Record<string, unknown> & { styles?: string[]; cues?: string[] };
type Carried = { photos: string[]; reads: unknown[]; profile?: Profile | null };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kept");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(v: Carried) {
  const db = await open();
  await new Promise<void>((done, fail) => {
    const tx = db.transaction("kept", "readwrite");
    tx.objectStore("kept").put(JSON.stringify(v), "inspo");
    tx.oncomplete = () => done();
    tx.onerror = tx.onabort = () => fail(tx.error);
  }).finally(() => db.close());
}

async function take(): Promise<Carried | null> {
  const db = await open();
  return new Promise<Carried | null>((resolve) => {
    const get = db.transaction("kept").objectStore("kept").get("inspo");
    get.onsuccess = () => resolve(get.result ? (JSON.parse(get.result as string) as Carried) : null);
    get.onerror = () => resolve(null);
  }).finally(() => db.close());
}

export function forgetCarried() {
  try {
    localStorage.removeItem(CARRY_KEY);
    indexedDB.deleteDatabase(DB);
  } catch {
    // Nothing kept.
  }
}

// Still on the anonymous account, just before going to Google. alsoDelete:
// the anonymous account stays, so its copy is deleted here (when it's
// deleted whole, its photos go with it).
export async function carryInspiration({ alsoDelete }: { alsoDelete: boolean }) {
  try {
    const { data: s } = await supabase().auth.getSession();
    if (!s.session?.user.is_anonymous) return;
    const { data } = await supabase().from("style_inspiration").select("photos, reads").maybeSingle();
    const k = data as Carried | null;
    if (!k?.photos?.length) return;
    const { data: profile } = await supabase().from("style_profiles").select("*").maybeSingle();
    await put({ photos: k.photos, reads: Array.isArray(k.reads) ? k.reads : [], profile: profile as Profile | null });
    localStorage.setItem(CARRY_KEY, String(Date.now()));
    if (alsoDelete) await supabase().from("style_inspiration").delete().eq("user_id", s.session.user.id);
  } catch {
    // Then they stay on the anonymous account, as before.
  }
}

// Back on a Google account: its own photos win; else it gets the carried ones.
export async function adoptCarried(userId: string) {
  try {
    const at = Number(localStorage.getItem(CARRY_KEY));
    const k = at && Date.now() - at < FOR ? await take() : null;
    if (k?.photos?.length) {
      const { data: moved, error } = await supabase()
        .from("style_inspiration")
        .upsert({ user_id: userId, photos: k.photos.slice(0, 8), reads: k.reads.slice(0, 8), updated_at: new Date().toISOString() }, { onConflict: "user_id", ignoreDuplicates: true })
        .select("user_id");
      if (error) console.warn("Inspiration photos not moved to the account", error.message);
      if (moved?.length && k.profile?.styles?.length) await adoptStyles(userId, k.profile);
    }
  } catch {
    // Not moved; the phone's copy goes all the same.
  }
  forgetCarried();
}

// The styles chosen with the carried photos: after the account's own, never
// twice; the account's other Style answers (what they shop for, budget) stay.
async function adoptStyles(userId: string, carried: Profile) {
  const db = () => supabase().from("style_profiles");
  const { data: own } = await db().select("styles, cues").maybeSingle();
  const { user_id: _was, ...rest } = carried;
  void _was;
  const { error } = own
    ? await db()
        .update({ styles: [...new Set([...(own.styles ?? []), ...(carried.styles ?? [])])], cues: [...new Set([...(own.cues ?? []), ...(carried.cues ?? [])])].slice(0, 8), updated_at: new Date().toISOString() })
        .eq("user_id", userId)
    : await db().insert({ ...rest, user_id: userId, updated_at: new Date().toISOString() });
  if (error) console.warn("Styles not moved to the account", error.message);
}
