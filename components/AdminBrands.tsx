"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { STYLES, styleById } from "@/lib/style";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./AdminBrands.module.css";

// Admin → Brands (founder, 20 Nov 2026): every brand Feta found (her AI's
// library and Feta's own research) starts as proposed and shows as "New
// find". Here she approves or rejects each brand for each style, country by
// country, fixes a logo, and marks her own favourites as ★ Feta Pick with a
// note. Admins can change these rows (brands, brand_styles); her Feta Picks
// are her own loved_brands.
type Status = "proposed" | "approved" | "rejected" | "all";
type Row = {
  brand_id: string;
  style_id: string;
  association: string;
  visible_cues: string;
  collection_url: string | null;
  confidence: string;
  found_by: string;
  review_status: string;
  brands: { id: string; name: string; website: string | null; logo_url: string | null; origin_country: string | null; brand_markets: { country: string; presence_type: string; presence_url: string | null; price_feel: string | null }[] };
};

const PAGE = 30;
const names = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (c: string) => {
  try {
    return names.of(c) ?? c;
  } catch {
    return c;
  }
};

export default function AdminBrands() {
  const toast = useToast();
  const [countries, setCountries] = useState<[string, number][]>([]);
  const [country, setCountry] = useState("IN");
  const [style, setStyle] = useState("");
  const [status, setStatus] = useState<Status>("proposed");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [picks, setPicks] = useState<Map<string, string>>(new Map()); // her ★ Feta Picks and notes
  const [editingLogo, setEditingLogo] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState("");

  // How many brands each country has, for the country menu.
  useEffect(() => {
    (async () => {
      const counts = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase().from("brand_markets").select("country").range(from, from + 999);
        for (const r of data ?? []) counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
        if (!data || data.length < 1000) break;
      }
      setCountries([...counts].sort((a, b) => b[1] - a[1]));
    })();
    supabase()
      .from("loved_brands")
      .select("brand_id, note")
      .then(({ data }) => setPicks(new Map((data ?? []).map((r) => [r.brand_id as string, (r.note as string) ?? ""]))));
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase()
      .from("brand_styles")
      .select("brand_id, style_id, association, visible_cues, collection_url, confidence, found_by, review_status, brands!inner (id, name, website, logo_url, origin_country, brand_markets!inner (country, presence_type, presence_url, price_feel))", { count: "exact" })
      .eq("brands.brand_markets.country", country)
      .order("brand_id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (status !== "all") q = q.eq("review_status", status);
    if (style) q = q.eq("style_id", style);
    if (query.trim()) q = q.ilike("brands.name", `%${query.trim().replace(/[%_,()]/g, "")}%`);
    const { data, count, error } = await q;
    if (error) {
      toast(`Couldn't load brands: ${error.message}`);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Row[]);
    setTotal(count ?? 0);
  }, [country, style, status, query, page, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list for the filters
    load();
  }, [load]);

  async function review(list: Row[], to: "approved" | "rejected" | "proposed") {
    // .select() returns the rows changed: none means the database didn't allow it (not signed in as admin).
    const results = await Promise.all(list.map((r) => supabase().from("brand_styles").update({ review_status: to }).eq("brand_id", r.brand_id).eq("style_id", r.style_id).select("brand_id")));
    const failed = results.filter((r) => r.error || !r.data?.length).length;
    if (failed) return toast(`${failed} couldn't be saved. Are you signed in as admin?`);
    else toast(list.length === 1 ? `${list[0].brands.name}: ${to}` : `${list.length} brands ${to}`);
    // In a filtered view the reviewed ones move out of it.
    if (list.length > 1) return load();
    setRows((rs) => (rs ?? []).map((r) => (list.includes(r) ? { ...r, review_status: to } : r)).filter((r) => status === "all" || r.review_status === status));
    setTotal((t) => (status === "all" ? t : t - list.length));
  }

  async function saveLogo(r: Row) {
    const url = logoUrl.trim();
    if (url && !/^https:\/\//.test(url)) return toast("Paste a link starting with https://");
    const { data, error } = await supabase().from("brands").update({ logo_url: url || null }).eq("id", r.brand_id).select("id");
    if (error || !data?.length) return toast(`Couldn't save the logo${error ? `: ${error.message}` : ". Are you signed in as admin?"}`);
    setRows((rs) => (rs ?? []).map((x) => (x.brand_id === r.brand_id ? { ...x, brands: { ...x.brands, logo_url: url || null } } : x)));
    setEditingLogo(null);
  }

  async function togglePick(r: Row) {
    const userId = await currentUserId();
    if (!userId) return;
    const next = new Map(picks);
    if (picks.has(r.brand_id)) {
      next.delete(r.brand_id);
      await supabase().from("loved_brands").delete().eq("brand_id", r.brand_id);
    } else {
      next.set(r.brand_id, "");
      await supabase().from("loved_brands").upsert({ user_id: userId, brand_id: r.brand_id, recommend: true, country });
    }
    setPicks(next);
  }

  async function saveNote(brandId: string, note: string) {
    const userId = await currentUserId();
    if (!userId) return;
    const { error } = await supabase().from("loved_brands").update({ note: note.trim() || null }).eq("brand_id", brandId);
    if (error) toast(`Couldn't save the note: ${error.message}`);
    else toast("Note saved");
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const proposedShown = (rows ?? []).filter((r) => r.review_status === "proposed");

  return (
    <div className={styles.wrap}>
      <p className={styles.sub}>
        Brands Feta found, for each style and country. They show to people as &ldquo;New find&rdquo; until you approve them; rejected ones never show. ★ marks your own favourites (Feta Pick, shown first, with your note).
      </p>

      <div className={styles.filters}>
        <select value={country} onChange={(e) => { setCountry(e.target.value); setPage(0); }} aria-label="Country">
          {countries.map(([c, n]) => (
            <option key={c} value={c}>
              {countryName(c)} ({n})
            </option>
          ))}
        </select>
        <select value={style} onChange={(e) => { setStyle(e.target.value); setPage(0); }} aria-label="Style">
          <option value="">All styles</option>
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className={styles.seg} role="tablist" aria-label="Status">
          {(["proposed", "approved", "rejected", "all"] as Status[]).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? styles.on : ""} onClick={() => { setStatus(s); setPage(0); }}>
              {s === "proposed" ? "To review" : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search a brand" aria-label="Search a brand" />
      </div>

      <div className={styles.bar}>
        <span>{rows === null ? "Loading…" : `${total} in ${countryName(country)}${style ? ` · ${styleById(style)?.name}` : ""}`}</span>
        {proposedShown.length > 1 && (
          <button type="button" className={styles.bulk} onClick={() => review(proposedShown, "approved")}>
            Approve all {proposedShown.length} shown
          </button>
        )}
      </div>

      <ul className={styles.list}>
        {(rows ?? []).map((r) => {
          const b = r.brands;
          const m = b.brand_markets.find((x) => x.country === country) ?? b.brand_markets[0];
          const isPick = picks.has(r.brand_id);
          return (
            <li key={`${r.brand_id}-${r.style_id}`} className={styles.card}>
              <div className={styles.head}>
                <button type="button" className={styles.logo} onClick={() => { setEditingLogo(r.brand_id); setLogoUrl(b.logo_url ?? ""); }} aria-label={`Change ${b.name}'s logo`}>
                  {b.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the brand's own logo
                    <img src={b.logo_url} alt="" />
                  ) : (
                    b.name.slice(0, 1)
                  )}
                </button>
                <div className={styles.name}>
                  {b.website ? (
                    <a href={b.website} target="_blank" rel="noopener noreferrer">
                      {b.name} ↗
                    </a>
                  ) : (
                    <strong>{b.name}</strong>
                  )}
                  <span className={styles.tags}>
                    <span>{styleById(r.style_id)?.short ?? r.style_id}</span>
                    <span>{r.association === "main" ? "main" : "nearby"}</span>
                    <span>{b.origin_country === country ? "homegrown" : "international"}</span>
                    <span>{m?.presence_type}</span>
                    {m?.price_feel && <span>{m.price_feel}</span>}
                    <span>{r.found_by === "feta" ? "Feta's research" : "your AI's list"}</span>
                    {r.confidence !== "verified_collection" && <span className={styles.warn}>not seen in collection</span>}
                  </span>
                </div>
                <button type="button" className={`${styles.star} ${isPick ? styles.starOn : ""}`} onClick={() => togglePick(r)} aria-pressed={isPick} aria-label={isPick ? `Remove ${b.name} from your Feta Picks` : `Make ${b.name} a Feta Pick`}>
                  ★
                </button>
              </div>
              <p className={styles.cues}>{r.visible_cues}</p>
              <p className={styles.links}>
                {m?.presence_url && (
                  <a href={m.presence_url} target="_blank" rel="noopener noreferrer">
                    Proof it sells here ↗
                  </a>
                )}
                {r.collection_url && (
                  <a href={r.collection_url} target="_blank" rel="noopener noreferrer">
                    Collection ↗
                  </a>
                )}
              </p>
              {editingLogo === r.brand_id && (
                <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); saveLogo(r); }}>
                  <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Link to the logo image (https://…)" aria-label="Logo link" />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setEditingLogo(null)}>Cancel</button>
                </form>
              )}
              {isPick && (
                <form className={styles.inline} onSubmit={(e) => { e.preventDefault(); saveNote(r.brand_id, (e.currentTarget.elements.namedItem("note") as HTMLInputElement).value); }}>
                  <input name="note" defaultValue={picks.get(r.brand_id) ?? ""} placeholder="Your note, shown with ★ Feta Pick" aria-label="Your note" maxLength={140} />
                  <button type="submit">Save note</button>
                </form>
              )}
              <div className={styles.actions}>
                <button type="button" className={r.review_status === "approved" ? styles.approved : ""} onClick={() => review([r], r.review_status === "approved" ? "proposed" : "approved")}>
                  {r.review_status === "approved" ? "✓ Approved" : "Approve"}
                </button>
                <button type="button" className={r.review_status === "rejected" ? styles.rejected : ""} onClick={() => review([r], r.review_status === "rejected" ? "proposed" : "rejected")}>
                  {r.review_status === "rejected" ? "✕ Rejected" : "Reject"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {rows !== null && rows.length === 0 && <p className={styles.sub}>Nothing here.</p>}

      {pages > 1 && (
        <div className={styles.pager}>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ Back
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
