// What Feta says about its daily limits (founder, 21 Nov 2026: "for the
// initial testers it's better to have that pop up", and to say it's because
// Feta is in testing, never about money). Used on the phone and the server.

// The limits reset at midnight India time (the database counts the day that
// way), said in the person's own time: "midnight", "6:30 pm" in London
// before then, and "tomorrow at 6:30 pm" after it (tester, 23 Nov 2026:
// "more from 6:30 pm" in the evening, when the reset was the next day).
export function resetTime(timeZone?: string, now = Date.now()): string {
  const ist = new Date(now + 330 * 60000);
  const next = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - 330 * 60000);
  let zone = timeZone ?? "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "Asia/Kolkata";
  }
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).formatToParts(next);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const [hour, minute, period] = [get("hour"), get("minute"), get("dayPeriod").toLowerCase()];
  if (hour === "12" && minute === "00" && period === "am") return "midnight";
  const day = (d: number | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
  return `${day(next) !== day(now) ? "tomorrow at " : ""}${hour}${minute === "00" ? "" : `:${minute}`} ${period}`;
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
