"use client";

import type { AskReply } from "@/app/api/ask/route";
import type { Origin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";
import { loadName } from "@/lib/profile";
import { loadOrigin } from "@/lib/origin";
import { firstSlotName } from "@/lib/slot-label";

export type { AskReply };

export async function askFeta(message: string, origin: Origin | null): Promise<AskReply> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  const offline: AskReply = { reply: "I can't reach the internet just now. Try again in a moment.", picks: [], added: [], trip: null };
  if (!token) return offline;
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, origin }),
    });
    // Took too long (the server stopped it): say so, not "no internet".
    if (res.status === 504) return { ...offline, reply: "That took me too long. Try asking again?" };
    return (await res.json()) as AskReply;
  } catch {
    return offline;
  }
}

// ---------- The chat on the phone ----------
// Ask Feta's conversation lives here, not in the screen (tester, 23 Nov
// 2026: answers were gone when Ask was reopened). The screen only showed
// what it had loaded itself: closing it threw away the place cards, plans,
// outfits and options of every answer, and an answer still on its way when
// Ask closed never reached the screen. Now the thread is kept in memory
// while the app is open (place cards and plans for an hour, like picks:
// Google's details are never stored), a reply on its way lands here even
// with Ask closed, and a fresh start rebuilds every answer's own words,
// options, profile and people cards and outfit from the account.

export type ChatMessage =
  | { id: number; role: "user"; text: string }
  | {
      id: number;
      role: "assistant";
      text: string;
      reply?: AskReply;
      at?: number; // when its live place cards and plan were checked
      earlier?: number; // places it showed before this visit (not kept: Google's details)
      undone?: boolean;
      notedUndone?: boolean;
      tripOnly?: boolean;
      todayOnly?: boolean;
      weekendUndone?: boolean;
      weekendId?: string;
      tripId?: string | null;
    };

export type ChatState = { messages: ChatMessage[]; trip: string | null; thinking: boolean; loaded: boolean };

export const GREETING =
  "Going somewhere, or out with someone new? Tell me and I'll adjust your picks. Anything I learn shows up in You, where you can change it.";

const KEEP_MS = 60 * 60000;
const EMPTY: ChatState = { messages: [{ id: 0, role: "assistant", text: GREETING }], trip: null, thinking: false, loaded: false };
let state: ChatState = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function update(change: (s: ChatState) => Partial<ChatState>) {
  state = { ...state, ...change(state) };
  listeners.forEach((l) => l());
}

export function subscribeChat(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function chatState(): ChatState {
  return state;
}

export function emptyChat(): ChatState {
  return EMPTY;
}

export function patchMessage(id: number, change: Partial<Extract<ChatMessage, { role: "assistant" }>>) {
  update((s) => ({ messages: s.messages.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...change } : m)) }));
}

// The text shown for a reply: with why nothing came back, when nothing did.
export function replyText(reply: Pick<AskReply, "reply" | "notice">, places: number) {
  return reply.notice && places === 0 ? `${reply.reply}\n${reply.notice}` : reply.reply;
}

// Someone coming back is greeted as someone Feta knows (founder, 26 Nov
// 2026, return-visit walk-through: the same first line every visit).
function welcomeBack(): string | null {
  try {
    if (Number(localStorage.getItem("feta.visits") ?? 0) < 2) return null;
  } catch {
    return null;
  }
  const name = loadName().trim();
  // The city's clock, as Home's Today / Tonight (design audit, 26 Nov 2026).
  const zone = loadOrigin()?.city.timeZone;
  const when = (zone ? firstSlotName(zone) : new Date().getHours() >= 17 ? "Tonight" : "Today").toLowerCase();
  return `Welcome back${name ? `, ${name}` : ""}. What are you up to ${when}? A new place, a plan with friends, anything on your mind: tell me and I'll sort it.`;
}

// Opening Ask: the kept thread (live cards older than an hour dropped),
// else the account's chat. openTrip: a saved trip opened from Saved, its
// card at the end.
export async function openChat(openTrip: string | null) {
  if (!state.loaded) {
    const past = await loadChat();
    update((s) => {
      if (s.loaded) return {};
      // Anything sent while the history loaded stays after it.
      const sent = s.messages.filter((m) => m.id !== 0);
      const back = welcomeBack();
      const fresh = back ? s.messages.map((m) => (m.id === 0 ? { ...m, text: back } : m)) : s.messages;
      return { messages: past.messages.length || sent.length ? [...past.messages, ...sent] : fresh, trip: s.trip ?? past.trip, loaded: true };
    });
  } else {
    const old = Date.now() - KEEP_MS;
    update((s) => ({
      messages: s.messages.map((m) =>
        m.role === "assistant" && m.reply && m.at && m.at < old && (m.reply.picks.length || m.reply.itinerary)
          ? { ...m, earlier: m.reply.picks.length + (m.reply.itinerary?.days.reduce((n, d) => n + d.stops.length, 0) ?? 0), reply: { ...m.reply, picks: [], itinerary: null } }
          : m,
      ),
    }));
  }
  if (openTrip) {
    update((s) => ({
      messages: [
        ...s.messages.map((m) => (m.role === "assistant" && m.tripId === openTrip ? { ...m, tripId: null } : m)),
        { id: nextId++, role: "assistant", text: "Here's your trip. Change anything, or carry on where you left off.", tripId: openTrip },
      ],
    }));
  }
}

export async function sendChat(text: string, origin: Origin | null) {
  const message = text.trim();
  if (!message || state.thinking) return;
  update((s) => ({ messages: [...s.messages, { id: nextId++, role: "user", text: message }], thinking: true }));
  const reply = await askFeta(message, origin);
  update((s) => ({
    thinking: false,
    trip: reply.trip ?? s.trip,
    messages: [...s.messages, { id: nextId++, role: "assistant", text: replyText(reply, reply.picks.length), reply, at: Date.now(), tripId: reply.tripId ?? null }],
  }));
}

// Earlier messages from the account: Feta's own words and cards. Place
// cards and day plans aren't stored (only their place IDs), so an answer
// that showed places says how many it showed.
async function loadChat(): Promise<{ messages: ChatMessage[]; trip: string | null }> {
  await currentUserId();
  const { data } = await supabase().from("chat_messages").select("role, content, extras").order("id", { ascending: false }).limit(30);
  const rows = (data ?? []).reverse();
  const messages = rows.map((m): ChatMessage => {
    if (m.role === "user") return { id: nextId++, role: "user", text: m.content };
    const x = (m.extras ?? {}) as Record<string, unknown> & Partial<AskReply> & { trip_id?: string; picks?: unknown[]; itinerary?: { days?: { stops?: unknown[] }[] } };
    const places = (x.picks?.length ?? 0) + (x.itinerary?.days ?? []).reduce((n, d) => n + (d.stops?.length ?? 0), 0);
    const reply: AskReply = {
      reply: m.content,
      picks: [],
      added: x.added ?? [],
      ...(x.noted ? { noted: x.noted } : {}),
      ...(x.today ? { today: true } : {}),
      trip: (x.trip as string | null) ?? null,
      ...(x.notice ? { notice: x.notice } : {}),
      ...(x.options ? { options: x.options } : {}),
      weekend: x.weekend ?? null,
      ...(x.outfit ? { outfit: x.outfit, brands: x.brands ?? [] } : {}),
    };
    return { id: nextId++, role: "assistant", text: replyText(reply, x.picks?.length ?? 0), reply, ...(places ? { earlier: places } : {}), tripId: x.trip_id ?? null };
  });
  return { messages, trip: rows.map((m) => (m.extras?.trip as string | null) ?? null).filter(Boolean).pop() ?? null };
}
