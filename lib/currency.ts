// Local currency for the spend question. It comes from the chosen city's
// country; if there is no city yet, it is guessed from the phone's time zone,
// which needs no permission and is never stored. Unknown zones fall back to
// US dollars.

// An ISO 4217 code: "INR", "EUR", "CZK"…
export type Currency = string;

// Upper bounds of spend levels 1–4 per person; level 5 is anything above.
// Roughly matched in what they buy, not converted at the exchange rate.
type Bounds = [number, number, number, number];
const HAND_TUNED: Record<string, Bounds> = {
  INR: [300, 500, 1500, 3000],
  USD: [15, 30, 60, 120],
  CAD: [20, 40, 80, 150],
  GBP: [10, 20, 45, 90],
  EUR: [12, 25, 50, 100],
  CHF: [20, 40, 80, 150],
  CZK: [250, 500, 1000, 2000],
  AED: [40, 80, 200, 400],
  SGD: [15, 30, 75, 150],
  HKD: [80, 150, 400, 800],
  THB: [150, 400, 1000, 2500],
  AUD: [20, 40, 80, 150],
  NZD: [20, 40, 80, 150],
  JPY: [1000, 2500, 6000, 12000],
  KRW: [12000, 25000, 60000, 120000],
};

// Rough units per US dollar, only to scale the US bands for currencies
// without their own. Close enough for "under / around / over".
const PER_USD: Record<string, number> = {
  CNY: 7.2, TWD: 32, MYR: 4.5, IDR: 16000, PHP: 57, VND: 25000, LKR: 300, NPR: 135, PKR: 280, BDT: 120,
  SAR: 3.75, QAR: 3.64, KWD: 0.31, OMR: 0.385, BHD: 0.376, JOD: 0.71, ILS: 3.7, TRY: 40, EGP: 48, MAD: 10,
  ZAR: 18, KES: 130, NGN: 1500, SEK: 10.5, NOK: 10.8, DKK: 6.9, PLN: 4, HUF: 370, RON: 4.6, BGN: 1.8,
  RSD: 105, ISK: 138, MXN: 18, BRL: 5.5, CLP: 950, COP: 4000, PEN: 3.7, ARS: 1000, MVR: 15.4, MUR: 46,
};

// Two significant figures: 1,834 → 1,800.
function nice(n: number) {
  if (n < 10) return Math.max(1, Math.round(n));
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

export function spendBounds(currency: Currency): Bounds {
  if (HAND_TUNED[currency]) return HAND_TUNED[currency];
  const rate = PER_USD[currency];
  if (!rate) return HAND_TUNED.USD;
  return HAND_TUNED.USD.map((b) => nice(b * rate)) as Bounds;
}

// Currencies Feta can label prices in (others fall back to US dollars).
export function knownCurrency(code: string | undefined | null): Currency {
  return code && (HAND_TUNED[code] || PER_USD[code]) ? code : "USD";
}

const EURO_ZONES = [
  "Amsterdam", "Athens", "Berlin", "Bratislava", "Brussels", "Dublin", "Helsinki",
  "Lisbon", "Ljubljana", "Luxembourg", "Madrid", "Malta", "Monaco", "Paris",
  "Riga", "Rome", "Tallinn", "Vienna", "Vilnius", "Zagreb",
].map((city) => `Europe/${city}`);

const ZONE_CURRENCY: Record<string, Currency> = {
  "Asia/Kolkata": "INR", "Asia/Calcutta": "INR", "Europe/London": "GBP", "Asia/Dubai": "AED",
  "Asia/Singapore": "SGD", "Asia/Hong_Kong": "HKD", "Asia/Bangkok": "THB", "Asia/Tokyo": "JPY",
  "Asia/Seoul": "KRW", "Europe/Prague": "CZK", "Europe/Zurich": "CHF", "Pacific/Auckland": "NZD",
};

export function currencyForTimeZone(timeZone: string): Currency {
  if (ZONE_CURRENCY[timeZone]) return ZONE_CURRENCY[timeZone];
  if (EURO_ZONES.includes(timeZone)) return "EUR";
  if (timeZone.startsWith("Australia/")) return "AUD";
  if (["Toronto", "Vancouver", "Edmonton", "Winnipeg", "Halifax", "Regina"].some((c) => timeZone === `America/${c}`)) return "CAD";
  return "USD";
}

export function detectCurrency(): Currency {
  try {
    return currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "USD";
  }
}

// "₹1,500", "$60", "€50": whole amounts with local digit grouping.
export function formatMoney(amount: number, currency: Currency) {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en")}`;
  }
}

// Labels for the spend chips, e.g. "Under ₹300", "₹500–1,500", "₹3,000+".
export function spendLabels(currency: Currency): string[] {
  const [a, b, c, d] = spendBounds(currency);
  const range = (low: number, high: number) =>
    `${formatMoney(low, currency)}–${formatMoney(high, currency).replace(/^\D+/, "")}`;
  return [
    `Under ${formatMoney(a, currency)}`,
    range(a, b),
    range(b, c),
    range(c, d),
    `${formatMoney(d, currency)}+`,
  ];
}
