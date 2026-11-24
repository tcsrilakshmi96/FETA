// Google's Search chip (searchEntryPoint) is shown as Google gives it, minus
// anything that could run code (security audit, 24 Nov 2026: the chip is
// read from the shared events cache, so a planted row would have run on
// every phone in a city). Google's chip is styles, links and text only.
export function safeChip(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|meta|link|base)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|xlink:href)\s*=\s*("|')?\s*(javascript|data|vbscript):[^"'\s>]*\2?/gi, "$1=\"#\"");
}
