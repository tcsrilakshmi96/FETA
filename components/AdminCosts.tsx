"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./AdminUsage.module.css";

// Costs (founder, 23 Nov 2026: "which end points are costing a lot and which
// is being hit again and again… where the search is being duplicated"). Per
// route: how often it's hit, what it spends, and how much of that is the
// same person asking the same thing again within 30 minutes; per paid
// service, calls and spend; the asks repeated most. Estimates at list price,
// from api_hits and api_costs (cost_monitor(), admins only).

type Route = { route: string; hits: number; paid: number; cost: number; avg_cost: number; repeats: number; repeat_cost: number | null; people: number; avg_ms: number | null };
type Service = { sku: string; calls: number; cost: number; used_by: string };
type Repeat = { route: string; label: string; times: number; people: number; cost: number };
type MonthSku = { sku: string; calls: number; cost: number; test_cost: number };
type Monitor = { routes: Route[]; services: Service[]; repeated: Repeat[]; total: number; repeat_cost: number; month?: MonthSku[]; today?: { bill: string; cost: number }[] };

// Google Maps gives each paid kind of call a free number every month (per
// billing account, since March 2025): Essentials 10,000, Pro 5,000,
// Enterprise 1,000. Gemini and Venice have none here. An estimate: Google's
// own bill is the truth (founder, 24 Nov 2026: "where has this money gone").
const FREE_A_MONTH: Record<string, number> = {
  places_details_essentials: 10000,
  places_autocomplete: 10000,
  places_text_ids: 0,
  places_text_pro: 5000,
  places_details_pro: 5000,
  places_nearby: 1000,
  places_nearby_atmos: 1000,
  places_text: 1000,
  places_text_atmos: 1000,
  places_details: 1000,
  places_details_atmos: 1000,
  places_photo: 1000,
};
const BILL: Record<string, string> = { maps: "Google Maps (Cloud bill)", gemini: "Gemini (AI Studio credit)", venice: "Venice (Ask Feta)" };
const billOf = (sku: string) => (sku.startsWith("gemini") ? "gemini" : sku.startsWith("venice") ? "venice" : "maps");
function monthBills(month: MonthSku[]) {
  const rows = month.map((m) => {
    const free = FREE_A_MONTH[m.sku] ?? 0;
    const calls = Number(m.calls);
    const billed = calls ? (Number(m.cost) * Math.max(0, calls - free)) / calls : 0;
    return { ...m, calls, free, billed, bill: billOf(m.sku) };
  });
  const by = (b: string) => rows.filter((r) => r.bill === b);
  return { rows, totals: ["gemini", "maps", "venice"].map((b) => ({ bill: b, list: by(b).reduce((n, r) => n + Number(r.cost), 0), billed: by(b).reduce((n, r) => n + r.billed, 0), test: by(b).reduce((n, r) => n + Number(r.test_cost), 0) })).filter((t) => t.list > 0) };
}

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];
// What each route is, in plain words.
const WHAT: Record<string, string> = {
  picks: "Picks lists",
  place: "Live check of a place",
  photo: "Place photos",
  details: "What to order",
  lists: "Saved lists",
  area: "Typing an area",
  feta_picks: "★ Feta Picks sheet",
  plan: "Plan my evening",
  night_plan: "Plan a night",
  surprise: "Surprise me",
  ask: "Ask Feta reply",
  ask_search: "Ask Feta search",
  ask_place: "Ask Feta: find a place",
  ask_day_plan: "Ask Feta day plan",
  ask_trip_route: "Ask Feta trip route",
  ask_outfit: "Ask Feta outfit",
  trip_transport: "Trip: getting around",
  trip_stays: "Trip: stays",
  trip_days: "Trip: day plans",
  style_looks: "Style: 3 looks",
  style_swap: "Style: swap a piece",
  style_picture: "Style: look picture",
  style_read: "Style: read photos",
  style_rank: "Style: rank brands",
  style_research: "Style: brand research",
  style_brand: "Style: look up a brand",
  weekend: "Weekend email",
  script: "Run outside the app (Claude)",
  admin: "Admin",
};
const inr = (n: number | null | undefined) => `₹${Math.round(Number(n ?? 0)).toLocaleString("en-IN")}`;

export default function AdminCosts() {
  const [days, setDays] = useState(7);
  const [realOnly, setRealOnly] = useState(false);
  const [data, setData] = useState<Monitor | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    supabase()
      .rpc("cost_monitor", { days, real_only: realOnly })
      .then(({ data: d, error }) => {
        if (!live) return;
        if (error) {
          console.error(error.message);
          setFailed(true);
        } else {
          setFailed(false);
          setData(d as Monitor);
        }
      });
    return () => {
      live = false;
    };
  }, [days, realOnly]);

  if (failed) return <p className={styles.note}>Couldn&apos;t load costs. Has 20261123110000_cost_monitor.sql run?</p>;
  if (!data) return <p className={styles.note}>Adding up…</p>;
  const hits = data.routes.reduce((n, r) => n + Number(r.hits), 0);
  const repeats = data.routes.reduce((n, r) => n + Number(r.repeats), 0);
  const byHits = [...data.routes].sort((a, b) => b.hits - a.hits);
  const bills = monthBills(data.month ?? []);

  return (
    <div className={styles.usage}>
      <div className={styles.range} role="tablist" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.days} type="button" role="tab" aria-selected={days === r.days} className={days === r.days ? styles.on : ""} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>
      <button type="button" role="switch" aria-checked={realOnly} className={styles.real} onClick={() => setRealOnly(!realOnly)}>
        <span>
          Real people only
          <small>{realOnly ? "Test accounts left out, even deleted ones" : "Including test accounts"}</small>
        </span>
        <span className={`switch ${realOnly ? "on" : ""}`} />
      </button>

      <h3>This month&apos;s bills, everyone together</h3>
      <p className={styles.note}>Tests, Admin and scripts included, as Google bills them all. Estimates: Google&apos;s own bill is the final word.</p>
      <div className={styles.tiles}>
        {(data.today ?? []).map((t) => (
          <div key={`t${t.bill}`}>
            <b>{inr(t.cost)}</b>
            <span>today · {BILL[t.bill] ?? t.bill}</span>
            <small>since midnight India time, list prices</small>
          </div>
        ))}
        {bills.totals.map((t) => (
          <div key={t.bill}>
            <b>{inr(t.billed)}</b>
            <span>this month · {BILL[t.bill] ?? t.bill}</span>
            <small>{t.bill === "maps" ? `after the free monthly calls (${inr(t.list)} at list price)` : "no free allowance"} · tests {inr(t.test)}</small>
          </div>
        ))}
      </div>
      <table className={styles.table} aria-label="This month by paid service">
        <thead>
          <tr>
            <th>Service</th>
            <th>Calls</th>
            <th>Free a month</th>
            <th>Billed (est.)</th>
          </tr>
        </thead>
        <tbody>
          {[...bills.rows].sort((a, b) => b.billed - a.billed).map((r) => (
            <tr key={r.sku}>
              <td>{r.sku.replace(/_/g, " ")}</td>
              <td>{r.calls.toLocaleString("en-IN")}{r.free ? ` (${Math.max(0, r.free - r.calls).toLocaleString("en-IN")} free left)` : ""}</td>
              <td>{r.free ? r.free.toLocaleString("en-IN") : "none"}</td>
              <td>{inr(r.billed)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Spend</h3>
      <div className={styles.tiles}>
        <div>
          <b>{inr(data.total)}</b>
          <span>estimated spend</span>
          <small>list prices, before free allowances</small>
        </div>
        <div>
          <b>{hits.toLocaleString("en-IN")}</b>
          <span>requests</span>
          <small>to routes that can spend</small>
        </div>
        <div>
          <b>{repeats.toLocaleString("en-IN")}</b>
          <span>repeats</span>
          <small>same person, same ask, within 30 min</small>
        </div>
        <div>
          <b>{inr(data.repeat_cost)}</b>
          <span>spent on repeats</span>
          <small>{data.total ? `${Math.round((Number(data.repeat_cost) / Number(data.total)) * 100)}% of all spend` : "nothing yet"}</small>
        </div>
      </div>

      <h3>Routes, by what they cost</h3>
      <table className={styles.table} aria-label="Routes by cost">
        <thead>
          <tr>
            <th>Route</th>
            <th className={styles.num}>Cost</th>
            <th className={styles.num}>Hits</th>
            <th className={styles.num}>Each</th>
            <th className={styles.num}>Repeats</th>
          </tr>
        </thead>
        <tbody>
          {data.routes.map((r) => (
            <tr key={r.route}>
              <td>
                {WHAT[r.route] ?? r.route}
                <small style={{ display: "block", opacity: 0.6 }}>
                  {r.route} · {r.people} {Number(r.people) === 1 ? "person" : "people"}
                  {r.avg_ms ? ` · ${(Number(r.avg_ms) / 1000).toFixed(1)} s` : ""}
                </small>
              </td>
              <td className={styles.num}>{inr(r.cost)}</td>
              <td className={styles.num}>{r.hits}</td>
              <td className={styles.num}>{inr(r.avg_cost)}</td>
              <td className={styles.num} style={Number(r.repeats) > 0 ? { color: "var(--roseText)", fontWeight: 600 } : undefined}>
                {r.repeats}
                {Number(r.repeat_cost) > 0 ? ` · ${inr(r.repeat_cost)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Hit most often</h3>
      <p className={styles.note}>{byHits.slice(0, 6).map((r) => `${WHAT[r.route] ?? r.route} ${r.hits}`).join(" · ") || "Nothing yet."}</p>

      <h3>Asked again and again</h3>
      {data.repeated.length === 0 ? (
        <p className={styles.note}>No ask repeated in this period.</p>
      ) : (
        <table className={styles.table} aria-label="Repeated asks">
          <thead>
            <tr>
              <th>What</th>
              <th className={styles.num}>Times</th>
              <th className={styles.num}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.repeated.map((r, i) => (
              <tr key={i}>
                <td>
                  {WHAT[r.route] ?? r.route}
                  <small style={{ display: "block", opacity: 0.6 }}>
                    {r.label} · {r.people} {Number(r.people) === 1 ? "person" : "people"}
                  </small>
                </td>
                <td className={styles.num}>{r.times}</td>
                <td className={styles.num}>{inr(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Paid services</h3>
      <table className={styles.table} aria-label="Paid services">
        <thead>
          <tr>
            <th>Service</th>
            <th className={styles.num}>Calls</th>
            <th className={styles.num}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.services.map((s) => (
            <tr key={s.sku}>
              <td>
                {s.sku}
                <small style={{ display: "block", opacity: 0.6 }}>{s.used_by}</small>
              </td>
              <td className={styles.num}>{s.calls}</td>
              <td className={styles.num}>{inr(s.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>The same ask within 30 minutes should come from what Feta already has; a red Repeats number is where to cache or stop a double call.</p>
    </div>
  );
}
