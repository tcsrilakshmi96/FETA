// "This weekend" is keyed by its Saturday, in the city's own time zone:
// Monday to Saturday it is the coming Saturday; on Sunday, yesterday's.
export function weekendSaturday(timeZone = "UTC", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const local = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  local.setUTCDate(local.getUTCDate() + (day === 0 ? -1 : 6 - day));
  return local.toISOString().slice(0, 10);
}
