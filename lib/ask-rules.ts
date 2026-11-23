// What code checks in Ask Feta's answers (app/api/ask/route.ts): only the
// things the chat model kept getting wrong. Kept apart so the quality check
// (npm run eval) can test them without calling the model.

// Whether a reply ends by asking them something, so it needs answers to tap.
export function asksQuestion(reply: string) {
  const sentences = reply.trim().split(/(?<=[.!?])\s+/);
  return /\?["”')]*\s*$/.test(sentences[sentences.length - 1] ?? "");
}
