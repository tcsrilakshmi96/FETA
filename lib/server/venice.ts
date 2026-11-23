import "server-only";
import { trackVenice } from "@/lib/server/costs";

// Venice AI (OpenAI-compatible), with the founder's credits: Ask Feta, trip
// routes, and Style's looks and brand order. It never receives Google Maps
// or Places content (that stays with Gemini). Claude Sonnet 5.5 since 23 Nov
// 2026 (founder: "use Venice credits, not more Gemini"; Haiku was too weak
// for judgement), about ₹1.5–2 a chat reply.
export const VENICE_MODEL = "claude-sonnet-5-5";

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

// maxTokens: a trip route with many cities needs room (a cut-off reply
// loses the route).
export async function veniceJson<T>(messages: ChatTurn[], maxTokens = 1500, model = VENICE_MODEL): Promise<T> {
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
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
  trackVenice(model, data.usage);
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
