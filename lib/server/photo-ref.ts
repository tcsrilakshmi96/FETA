import "server-only";
import { createHmac } from "node:crypto";

// A pick's photo is fetched only when it comes on screen (Google charges per
// photo). The phone gets a signed reference to Google's photo name, so
// /api/photo can't be used to fetch other photos on Feta's bill.
function sign(name: string) {
  return createHmac("sha256", process.env.GOOGLE_PLACES_API_KEY ?? "").update(name).digest("hex").slice(0, 20);
}

export function photoRef(name: string) {
  return `${name}|${sign(name)}`;
}

export function photoName(ref: string): string | null {
  const [name, sig] = ref.split("|");
  return name && sig && sign(name) === sig && /^places\/[^/]+\/photos\/[^/]+$/.test(name) ? name : null;
}
