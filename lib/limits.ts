// What Feta says about its daily limits (founder, 21 Nov 2026: "for the
// initial testers it's better to have that pop up", and to say it's because
// Feta is in testing, never about money). Used on the phone and the server.

// The limits reset at midnight India time (the database counts the day that
// way), said in the person's own time: "midnight", or "6:30 pm" in London.
export function resetTime(timeZone?: string): string {
  const ist = new Date(Date.now() + 330 * 60000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 330 * 60000);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).formatToParts(next);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).formatToParts(next);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const [hour, minute, period] = [get("hour"), get("minute"), get("dayPeriod").toLowerCase()];
  if (hour === "12" && minute === "00" && period === "am") return "midnight";
  return `${hour}${minute === "00" ? "" : `:${minute}`} ${period}`;
}

export type LimitWhat = "picks" | "kept" | "style" | "ask";

export function limitNotice(what: LimitWhat, timeZone?: string): string {
  const t = resetTime(timeZone);
  if (what === "kept") return `Feta's in early testing, so new searches are limited each day. Here are your latest picks; new ones from ${t}.`;
  if (what === "style") return `Feta's in early testing, so Style is limited each day. Come back from ${t} and it'll start from here.`;
  if (what === "ask") return `I'm in early testing, so I can only do so much each day. Ask me again from ${t}.`;
  return `Feta's in early testing, so picks are limited each day. New picks from ${t}. Your saved places and plans still work.`;
}

// Shown when 3 or fewer new searches are left today.
export function leftNotice(left: number, timeZone?: string): string {
  const t = resetTime(timeZone);
  return left > 0
    ? `Feta's in early testing, so picks are limited each day. ${left} new ${left === 1 ? "search" : "searches"} left · more from ${t}.`
    : `Feta's in early testing, so picks are limited each day. That was today's last new search · more from ${t}.`;
}
