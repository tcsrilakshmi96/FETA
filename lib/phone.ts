// Country calling codes for the optional WhatsApp number. The list covers
// the launch cities and common homes of testers; the code shown first is
// the chosen city's country.
export const CALLING_CODES: { country: string; code: string; name: string }[] = [
  { country: "IN", code: "91", name: "India" },
  { country: "US", code: "1", name: "United States" },
  { country: "CA", code: "1", name: "Canada" },
  { country: "GB", code: "44", name: "United Kingdom" },
  { country: "IE", code: "353", name: "Ireland" },
  { country: "DE", code: "49", name: "Germany" },
  { country: "FR", code: "33", name: "France" },
  { country: "NL", code: "31", name: "Netherlands" },
  { country: "BE", code: "32", name: "Belgium" },
  { country: "LU", code: "352", name: "Luxembourg" },
  { country: "CH", code: "41", name: "Switzerland" },
  { country: "AT", code: "43", name: "Austria" },
  { country: "CZ", code: "420", name: "Czechia" },
  { country: "PL", code: "48", name: "Poland" },
  { country: "PT", code: "351", name: "Portugal" },
  { country: "ES", code: "34", name: "Spain" },
  { country: "IT", code: "39", name: "Italy" },
  { country: "SE", code: "46", name: "Sweden" },
  { country: "DK", code: "45", name: "Denmark" },
  { country: "NO", code: "47", name: "Norway" },
  { country: "FI", code: "358", name: "Finland" },
  { country: "AE", code: "971", name: "UAE" },
  { country: "SA", code: "966", name: "Saudi Arabia" },
  { country: "QA", code: "974", name: "Qatar" },
  { country: "SG", code: "65", name: "Singapore" },
  { country: "MY", code: "60", name: "Malaysia" },
  { country: "TH", code: "66", name: "Thailand" },
  { country: "ID", code: "62", name: "Indonesia" },
  { country: "HK", code: "852", name: "Hong Kong" },
  { country: "KR", code: "82", name: "South Korea" },
  { country: "JP", code: "81", name: "Japan" },
  { country: "AU", code: "61", name: "Australia" },
  { country: "NZ", code: "64", name: "New Zealand" },
  { country: "LK", code: "94", name: "Sri Lanka" },
  { country: "NP", code: "977", name: "Nepal" },
];

export function codeFor(country: string | undefined) {
  return CALLING_CODES.find((c) => c.country === country) ?? CALLING_CODES[0];
}

// Numbers are kept as "+<code><number>". Ones saved before Nov 2026 were
// 10 Indian digits without a code.
export function showNumber(stored: string) {
  if (!stored.startsWith("+")) return `+91 ${stored.slice(0, 5)} ${stored.slice(5)}`;
  const c = [...CALLING_CODES].sort((a, b) => b.code.length - a.code.length).find((x) => stored.startsWith(`+${x.code}`));
  return c ? `+${c.code} ${stored.slice(c.code.length + 1)}` : stored;
}

// A plausible national number (6–14 digits, a leading 0 dropped).
export function fullNumber(code: string, typed: string) {
  const digits = typed.replace(/\D/g, "").replace(/^0+/, "").replace(new RegExp(`^${code}(?=\\d{6,})`), "");
  return /^\d{6,14}$/.test(digits) && (code !== "91" || /^[6-9]\d{9}$/.test(digits)) ? `+${code}${digits}` : null;
}
