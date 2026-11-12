import { bestPhoto, photoUri, placeDetails } from "@/lib/server/places";

// For the public share page (/p/<place id>): the place's name, area and a
// photo, fetched live from Google (nothing stored). No personal data.
// ?lite=1: name and area only, without the photo (for "How was it?").
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_.-]{10,300}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const place = await placeDetails(id, false, true);
  if (!place) return Response.json({ error: "Not found" }, { status: 404 });
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types?.includes(type))?.longText;
  const lite = new URL(request.url).searchParams.get("lite") === "1";
  const photo = lite ? undefined : bestPhoto(place);
  return Response.json({
    name: place.displayName?.text ?? "A place",
    area: [pick("sublocality_level_1") ?? pick("neighborhood"), pick("locality")].filter(Boolean).join(", "),
    mapsUri: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${id}`,
    photo: photo?.name ? await photoUri(photo.name) : null,
    credit: photo?.authorAttributions?.[0]?.displayName ?? null,
  });
}
