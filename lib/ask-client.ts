"use client";

import type { AskReply } from "@/app/api/ask/route";
import type { Origin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";

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
    return (await res.json()) as AskReply;
  } catch {
    return offline;
  }
}

// Earlier messages (text only; place cards are shown live, not stored).
export async function loadChat(): Promise<{ role: "user" | "assistant"; content: string; trip: string | null }[]> {
  await currentUserId();
  const { data } = await supabase()
    .from("chat_messages")
    .select("role, content, extras")
    .order("id", { ascending: false })
    .limit(30);
  return (data ?? []).reverse().map((m) => ({ role: m.role, content: m.content, trip: m.extras?.trip ?? null }));
}
