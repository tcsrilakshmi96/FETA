import "server-only";
import { paidFetch } from "@/lib/server/costs";

// Venice AI (OpenAI-compatible), with the founder's credits: Ask Feta only
// (founder, 23 Nov 2026: her Venice credits are limited; everything else is
// on Gemini). Claude Opus 5.5 since 25 Nov 2026 (founder, after the same 10
// chats on both: Sonnet searched anyway after "we can skip that" and promised
// a Porto plan it never made), about ₹2 a reply, double Sonnet; Haiku was
// too weak for judgement. It never receives Google Maps or Places content.
export const VENICE_MODEL = "claude-opus-5-5";

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

// maxTokens: a trip route with many cities needs room (a cut-off reply
// loses the route).
export async function veniceJson<T>(messages: ChatTurn[], maxTokens = 1500, model = VENICE_MODEL): Promise<T> {
  const res = await paidFetch("venice_chat", "https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VENICE_API_KEY}` },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      venice_parameters: { include_venice_system_prompt: false },
      max_tokens: maxTokens,
    }),
    // A bigger model thinks a little longer.
    signal: AbortSignal.timeout(maxTokens > 1500 ? 50000 : 35000),
  });
  if (!res.ok) throw new Error(`Venice failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "{}";
  // Now and then it answers in plain words instead of JSON (after a tapped
  // option, 19 Nov 2026): those words are the reply.
  if (!text.includes("{")) return { reply: text.trim() } as T;
  const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? "{}";
  try {
    return JSON.parse(json) as T;
  } catch {
    // A cut-off or slightly malformed reply: keep at least the words.
    const reply = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
    return (reply ? { reply: JSON.parse(`"${reply}"`) } : {}) as T;
  }
}
