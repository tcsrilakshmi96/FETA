// Local currency for the spend question. Normally it comes from the chosen
// city; if there is none yet, it is guessed from the phone's time zone, which
// needs no permission and is never stored. Unknown zones fall back to US dollars.

export type Currency = "INR" | "USD" | "CAD" | "GBP" | "EUR" | "AED" | "SGD" | "AUD" | "JPY";

// Upper bounds of spend levels 1–3 per person; level 4 is anything above.
// Roughly matched in what they buy, not converted at the exchange rate.
export const SPEND_LEVELS: Record<Currency, [number, number, number]> = {
  INR: [500, 1500, 3000],
  USD: [20, 60, 120],
  CAD: [25, 75, 150],
  GBP: [15, 45, 90],
  EUR: [20, 50, 100],
  AED: [75, 200, 400],
  SGD: [25, 75, 150],
  AUD: [30, 80, 150],
  JPY: [2000, 6000, 12000],
};

const EURO_ZONES = [
  "Amsterdam", "Athens", "Berlin", "Bratislava", "Brussels", "Dublin", "Helsinki",
  "Lisbon", "Ljubljana", "Luxembourg", "Madrid", "Malta", "Monaco", "Paris",
  "Riga", "Rome", "Tallinn", "Vienna", "Vilnius", "Zagreb",
].map((city) => `Europe/${city}`);

const CANADA_ZONES = [
  "Toronto", "Vancouver", "Edmonton", "Winnipeg", "Halifax", "St_Johns", "Regina",
  "Montreal", "Moncton", "Whitehorse", "Yellowknife",
].map((city) => `America/${city}`);

const US_ZONES = [
  "New_York", "Chicago", "Denver", "Los_Angeles", "Phoenix", "Anchorage", "Detroit",
  "Boise", "Juneau", "Adak", "Menominee", "Nome", "Sitka", "Yakutat",
].map((city) => `America/${city}`);

export function currencyForTimeZone(timeZone: string): Currency {
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return "INR";
  if (timeZone === "Europe/London") return "GBP";
  if (EURO_ZONES.includes(timeZone)) return "EUR";
  if (CANADA_ZONES.includes(timeZone)) return "CAD";
  if (US_ZONES.includes(timeZone) || timeZone.startsWith("America/Indiana/") ||
      timeZone.startsWith("America/Kentucky/") || timeZone.startsWith("America/North_Dakota/") ||
      timeZone === "Pacific/Honolulu") return "USD";
  if (timeZone === "Asia/Dubai") return "AED";
  if (timeZone === "Asia/Singapore") return "SGD";
  if (timeZone.startsWith("Australia/")) return "AUD";
  if (timeZone === "Asia/Tokyo") return "JPY";
  return "USD";
}

export function detectCurrency(): Currency {
  try {
    return currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "USD";
  }
}

// "₹1,500", "$60", "¥6,000": whole amounts with local digit grouping.
export function formatMoney(amount: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Labels for the spend chips, e.g. "Under ₹500", "₹500–1,500", "₹3,000+".
export function spendLabels(currency: Currency): [string, string, string, string] {
  const [a, b, c] = SPEND_LEVELS[currency];
  const range = (low: number, high: number) =>
    `${formatMoney(low, currency)}–${formatMoney(high, currency).replace(/^\D+/, "")}`;
  return [
    `Under ${formatMoney(a, currency)}`,
    range(a, b),
    range(b, c),
    `${formatMoney(c, currency)}+`,
  ];
}
