"use client";

import { useEffect, useState } from "react";
import ItineraryView from "@/components/ItineraryView";
import PickPhoto from "@/components/PickPhoto";
import { useToast } from "@/components/Toast";
import type { City } from "@/lib/cities";
import { formatMoney } from "@/lib/currency";
import type { Pick } from "@/lib/picks-client";
import type { Itinerary } from "@/lib/server/itinerary";
import { hotelBudgets, loadTrip, tripAction, type DaysReply, type Stay, type Trip, type TripTransport } from "@/lib/trip-client";
import styles from "./TripCard.module.css";

// The trip planner, as one card in Ask Feta (founder, 14 Nov 2026):
// 1) the route, cities with nights and a two-line story each, to change;
// 2) getting around, with rough costs; 3) where to stay, 3 hotels a city for
// a budget asked here; 4) day by day, one city at a time, 3 days per tap
// (each costs real searches, so nothing is planned until they ask).

const MODE_ICON: Record<string, string> = { train: "🚆", flight: "✈️", bus: "🚌", ferry: "⛴", car: "🚗" };
const WHO: Record<string, string> = { solo: "on your own", partner: "with your partner", friends: "with friends", family: "with family", kids: "with the kids" };

const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);

export default function TripCard({ id, home, onStop }: { id: string; home: City | null; onStop: (pick: Pick) => void }) {
  const toast = useToast();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [cities, setCities] = useState<Trip["cities"]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [stays, setStays] = useState<Stay[][] | null>(null);
  const [days, setDays] = useState<Record<number, Itinerary[]>>({});

  useEffect(() => {
    let live = true;
    loadTrip(id).then((t) => {
      if (!live || !t) return;
      setTrip(t);
      setCities(t.cities);
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (!trip) return null;
  const currency = trip.home_currency ?? home?.currency ?? "USD";
  const nights = cities.reduce((n, c) => n + c.nights, 0);
  const start = trip.start_date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${trip.start_date}T12:00:00Z`)) : null;

  function edit(next: Trip["cities"]) {
    setCities(next);
    setDirty(true);
  }

  async function saveRoute() {
    setBusy("save");
    const r = await tripAction<{ trip: Trip }>({ id, action: "save", cities });
    setBusy(null);
    if (!r?.trip) return toast("Couldn't save that just now. Try again.");
    setTrip(r.trip);
    setCities(r.trip.cities);
    setDirty(false);
    setStays(null);
    setDays({});
  }

  async function getAround() {
    if (dirty) await saveRoute();
    setBusy("transport");
    const r = await tripAction<{ transport: TripTransport }>({ id, action: "transport", home: home?.id ?? null });
    setBusy(null);
    if (!r?.transport) return toast(r?.error ?? "Couldn't work out the travel just now. Try again.");
    setTrip((t) => t && { ...t, transport: r.transport });
  }

  async function findStays(budget: string) {
    setBusy("stays");
    const r = await tripAction<{ stays: Stay[][] }>({ id, action: "stays", budget });
    setBusy(null);
    if (!r?.stays) return toast("Couldn't find hotels just now. Try again.");
    setStays(r.stays);
    setTrip((t) => t && { ...t, hotel_budget: budget, stays: Object.fromEntries(r.stays.map((s, i) => [String(i), { shown: s.map((x) => x.placeId), chosen: null }])) });
  }

  function choose(index: number, stay: Stay) {
    const current = trip!.stays[String(index)];
    const chosen = current?.chosen === stay.placeId ? null : stay.placeId;
    setTrip((t) => t && { ...t, stays: { ...t.stays, [String(index)]: { shown: current?.shown ?? [], chosen } } });
    tripAction({ id, action: "choose", index, placeId: chosen });
  }

  async function planDays(index: number) {
    const done = (days[index] ?? []).reduce((n, it) => n + it.days.length, 0);
    const chosenId = trip!.stays[String(index)]?.chosen;
    const hotel = stays?.[index]?.find((s) => s.placeId === chosenId);
    setBusy(`days-${index}`);
    const r = await tripAction<DaysReply>({ id, action: "days", index, fromDay: done, hotel: hotel ? { lat: hotel.lat, lng: hotel.lng } : null });
    setBusy(null);
    if (!r?.itinerary) return toast(r?.notice ?? "Couldn't plan those days just now. Try again.");
    setDays((d) => ({ ...d, [index]: [...(d[index] ?? []), r.itinerary!] }));
  }

  const transport = trip.transport;
  const total = transport?.legs.reduce((n, l) => n + l.cost, 0) ?? 0;

  return (
    <div className={styles.card}>
      <p className={styles.kick}>✈ Trip</p>
      <h3 className={styles.title}>{trip.title}</h3>
      <p className={styles.meta}>{[start && `From ${start}`, trip.who && WHO[trip.who], `${nights} nights`].filter(Boolean).join(" · ")}</p>

      {/* 1. The route */}
      <p className={styles.step}>1 · The route</p>
      <ol className={styles.cities}>
        {cities.map((c, i) => (
          <li key={`${c.name}-${i}`} className={styles.city}>
            <div className={styles.cityHead}>
              <span className={styles.num}>{i + 1}</span>
              <strong>{c.name}</strong>
              <span className={styles.nights}>
                <button type="button" aria-label={`One night less in ${c.name}`} disabled={c.nights <= 1} onClick={() => edit(cities.map((x, j) => (j === i ? { ...x, nights: x.nights - 1 } : x)))}>
                  −
                </button>
                {c.nights} {c.nights === 1 ? "night" : "nights"}
                <button type="button" aria-label={`One night more in ${c.name}`} onClick={() => edit(cities.map((x, j) => (j === i ? { ...x, nights: x.nights + 1 } : x)))}>
                  ＋
                </button>
              </span>
            </div>
            {c.story && <p className={styles.story}>{c.story}</p>}
            <div className={styles.cityTools}>
              {c.focus && <span className={styles.focus}>{c.focus}</span>}
              <span className={styles.moves}>
                <button type="button" aria-label={`Move ${c.name} earlier`} disabled={i === 0} onClick={() => edit(cities.map((x, j) => (j === i - 1 ? cities[i] : j === i ? cities[i - 1] : x)))}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${c.name} later`} disabled={i === cities.length - 1} onClick={() => edit(cities.map((x, j) => (j === i + 1 ? cities[i] : j === i ? cities[i + 1] : x)))}>
                  ↓
                </button>
                <button type="button" aria-label={`Drop ${c.name}`} disabled={cities.length <= 1} onClick={() => edit(cities.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      <p className={styles.hint}>To add a city or change the plan, just tell me below, e.g. “add Nara” or “more days in Kyoto”.</p>
      {dirty && (
        <button type="button" className={styles.secondary} onClick={saveRoute} disabled={!!busy}>
          {busy === "save" ? "Saving…" : "Save these changes"}
        </button>
      )}
      {!transport && (
        <button type="button" className={styles.primary} onClick={getAround} disabled={!!busy}>
          {busy === "transport" ? "Working out trains and flights…" : "Looks good. How do we get around?"}
        </button>
      )}

      {/* 2. Getting around */}
      {transport && (
        <>
          <p className={styles.step}>2 · Getting around</p>
          <p className={styles.summary}>
            {[transport.trains && `${transport.trains} train ${transport.trains === 1 ? "ride" : "rides"}`, transport.flights && `${transport.flights} ${transport.flights === 1 ? "flight" : "flights"}`, transport.legs.length - transport.trains - transport.flights > 0 && `${transport.legs.length - transport.trains - transport.flights} by road or sea`]
              .filter(Boolean)
              .join(" · ")}
            {total > 0 && <>, about {formatMoney(total, transport.currency)} each in all</>}
          </p>
          <ul className={styles.legs}>
            {transport.legs.map((l, i) => (
              <li key={i}>
                <span aria-hidden="true">{MODE_ICON[l.mode] ?? "🚆"}</span>
                <span>
                  {l.from} → {l.to}
                  <small>
                    {hours(l.minutes)}
                    {l.cost > 0 && ` · about ${formatMoney(l.cost, transport.currency)}`}
                    {l.note && ` · ${l.note}`}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          {transport.tip && <p className={styles.tip}>💡 {transport.tip}</p>}
          <p className={styles.hint}>Rough estimates per person. Check prices and times before you book.</p>
        </>
      )}

      {/* 3. Where to stay */}
      {transport && (
        <>
          <p className={styles.step}>3 · Where to stay</p>
          {!stays ? (
            <>
              <p className={styles.ask}>{trip.hotel_budget ? "Show hotels again for your budget?" : "Hotel budget per night?"}</p>
              <div className={styles.chips}>
                {hotelBudgets(currency).map((b) => (
                  <button key={b.id} type="button" className={trip.hotel_budget === b.id ? styles.on : ""} disabled={!!busy} onClick={() => findStays(b.id)}>
                    {b.label}
                  </button>
                ))}
              </div>
              {busy === "stays" && <p className={styles.hint}>Finding hotels in every city…</p>}
            </>
          ) : (
            <>
              {cities.map((c, i) => (
                <div key={`${c.name}-stay`} className={styles.stayCity}>
                  <p className={styles.stayCityName}>{c.name}</p>
                  {(stays[i] ?? []).length === 0 && <p className={styles.hint}>No well-reviewed stays found here. Try another budget.</p>}
                  {(stays[i] ?? []).map((s) => {
                    const chosen = trip.stays[String(i)]?.chosen === s.placeId;
                    return (
                      <div key={s.placeId} className={`${styles.stay} ${chosen ? styles.stayOn : ""}`}>
                        <span className={styles.stayPic}>
                          <PickPhoto photo={s.photo} />
                        </span>
                        <span className={styles.stayText}>
                          <strong>{s.name}</strong>
                          <small>{[s.rating && `★ ${s.rating.toFixed(1)}${s.ratingCount ? ` (${s.ratingCount >= 1000 ? `${(s.ratingCount / 1000).toFixed(1)}k` : s.ratingCount})` : ""}`, s.area].filter(Boolean).join(" · ")}</small>
                          <small>
                            <a href={s.mapsUri} target="_blank" rel="noopener noreferrer" translate="no">
                              Google Maps
                            </a>
                            {s.website && (
                              <>
                                {" · "}
                                <a href={s.website} target="_blank" rel="noopener noreferrer">
                                  Website
                                </a>
                              </>
                            )}
                          </small>
                        </span>
                        <button type="button" className={styles.choose} onClick={() => choose(i, s)} aria-pressed={chosen}>
                          {chosen ? "✓ Chosen" : "Choose"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
              <button type="button" className={styles.link} onClick={() => setStays(null)}>
                Different budget
              </button>
            </>
          )}
        </>
      )}

      {/* 4. Day by day */}
      {transport && (
        <>
          <p className={styles.step}>4 · Day by day</p>
          <p className={styles.hint}>Real places for each city, open on those days{stays ? ", near the hotel you choose" : ""}. One city at a time.</p>
          {cities.map((c, i) => {
            const planned = (days[i] ?? []).reduce((n, it) => n + it.days.length, 0);
            const next = Math.min(c.nights, planned + 3);
            return (
              <div key={`${c.name}-days`} className={styles.dayCity}>
                {(days[i] ?? []).map((it, k) => (
                  <ItineraryView key={k} itinerary={it} onStop={onStop} />
                ))}
                {planned < c.nights && (
                  <button type="button" className={styles.secondary} onClick={() => planDays(i)} disabled={!!busy}>
                    {busy === `days-${i}` ? `Planning ${c.name}…` : `${c.name}: plan ${planned === 0 ? "" : "the next "}days ${planned + 1}–${next}`}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
