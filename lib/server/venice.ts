import "server-only";

// Venice AI (OpenAI-compatible), with the founder's credits. Used for chat
// and profile updates only; it never receives Google Maps or Places content.
// A mainstream model, not an "uncensored" one.
const MODEL = "claude-haiku-5-5";

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export async function veniceJson<T>(messages: ChatTurn[]): Promise<T> {
  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VENICE_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      venice_parameters: { include_venice_system_prompt: false },
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Venice failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "{}";
  const json = /\{[\s\S]*\}/.exec(text)?.[0] ?? "{}";
  return JSON.parse(json) as T;
}
