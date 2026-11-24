// The first slot's name follows the city's clock (founder, 24 Nov 2026):
// "Today" from 5 am to 5 pm (open in the next few hours: breakfast, lunch,
// daytime places), "Tonight" from 5 pm to 5 am. Matches tonightMeansNow in
// lib/server/picks.ts. The value stays "tonight" in code.
// Before their city is known (the first render), "Tonight", so the server's
// page and the phone's agree.
export function firstSlotName(timeZone?: string): "Today" | "Tonight" {
  if (!timeZone) return "Tonight";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour >= 5 && hour < 17 ? "Today" : "Tonight";
}
