// Brand research the founder ran elsewhere (founder, 20 Nov 2026: a free AI
// filled the library country by country with the prompt in
// docs/style-research-prompt.md), brought in as "proposed". Every link is
// opened (free, no Google call) and a brand whose own site and proof of
// presence both fail is left out; each brand's logo is taken from its own
// site. Marketplaces are never brands. Writes SQL for the Supabase SQL
// Editor (copied to the clipboard) and a report of what was left out.
//
//   npm run import-brands -- ~/Downloads/brands-india.csv [more.csv …]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const COLUMNS = ["country", "style_id", "association", "brand_name", "website", "instagram_handle", "origin_country", "homegrown", "wears", "presence_type", "presence_evidence_url", "collection_evidence_url", "editorial_mention_url", "visible_cues", "label_type", "price_feel", "sample_price", "sample_currency", "sample_item", "similar_reference_brands", "confidence", "checked_date"] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

const MARKETPLACES = /myntra|ajio|nykaa|amazon\.|flipkart|tatacliq|namshi|noon\.com|farfetch|asos\.|zalando|ssense|net-a-porter|mytheresa|shein|meesho|lazada|shopee/;
const PRESENCE = ["stores", "own site delivers here", "official local site", "ships from abroad"];
const FEEL = ["budget", "mid", "premium", "luxury"];
const WEARS = ["women", "men", "unisex", "women+men"];

// The style ids in the reference workbook (style_lenses).
const STYLES = new Set(["athleisure", "avant-garde", "balletcore", "blokecore", "bohemian", "coquette", "cottagecore", "dark-academia", "disco", "eclectic-grandpa", "egirl", "gorpcore", "goth", "grunge", "indian-fusion", "ivy", "kurta", "lolita", "maximalist", "minimalist", "mod", "modest", "polished-minimal", "preppy", "punk", "rockabilly", "sari", "skatewear", "smart-casual", "streetwear", "tailoring", "techwear", "utility", "western", "workwear", "y2k"]);

// Country names or codes to ISO codes.
const names = new Intl.DisplayNames(["en"], { type: "region" });
const CODES = new Map<string, string>();
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = names.of(code);
    if (name && name !== code) CODES.set(name.toLowerCase(), code);
  }
for (const [alias, code] of [["uae", "AE"], ["usa", "US"], ["uk", "GB"], ["england", "GB"], ["south korea", "KR"], ["korea", "KR"], ["turkey", "TR"], ["türkiye", "TR"], ["czech republic", "CZ"], ["russia", "RU"], ["vietnam", "VN"]]) CODES.set(alias, code);
const isoOf = (s: string) => (/^[A-Za-z]{2}$/.test(s.trim()) ? s.trim().toUpperCase() : (CODES.get(s.trim().toLowerCase()) ?? null));

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const nameKey = (n: string) => n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const url = (u: string) => (/^https?:\/\//.test(u.trim()) ? u.trim().replace(/^http:/, "https:") : u.trim() && !u.includes(" ") ? `https://${u.trim()}` : "");

async function fetchPage(u: string): Promise<{ ok: boolean; html: string }> {
  if (!u) return { ok: false, html: "" };
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (compatible; FetaLinkCheck/1.0)" } });
    const ok = res.status < 400 || [401, 403, 429].includes(res.status);
    const html = ok && (res.headers.get("content-type") ?? "").includes("html") ? (await res.text()).slice(0, 200000) : "";
    return { ok, html };
  } catch {
    return { ok: false, html: "" };
  }
}

// The brand's own logo or icon, from its home page.
function logoFrom(html: string, base: string): string | null {
  const pick = (re: RegExp) => re.exec(html)?.[1];
  const found =
    pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i) ??
    pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon/i) ??
    pick(/<img[^>]+(?:class|alt|id)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i) ??
    pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i);
  if (!found) return null;
  try {
    return new URL(found, base).toString();
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

const q = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''").trim()}'`);

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: npm run import-brands -- <file.csv> [more.csv …]");
    process.exit(1);
  }
  const rows: Row[] = [];
  const left: string[] = [];
  for (const f of files) {
    const [head, ...body] = parseCsv(readFileSync(f, "utf8").replace(/^﻿/, ""));
    const idx = head.map((h) => h.trim().toLowerCase());
    const missing = COLUMNS.filter((c) => !idx.includes(c));
    if (missing.length) {
      console.error(`${f}: missing columns ${missing.join(", ")}`);
      process.exit(1);
    }
    for (const r of body) rows.push(Object.fromEntries(COLUMNS.map((c) => [c, (r[idx.indexOf(c)] ?? "").trim()])) as Row);
  }

  // Rows that can't be used, before any link is opened.
  const usable = rows.filter((r) => {
    const why = !r.brand_name ? "no name" : !STYLES.has(r.style_id) ? `unknown style "${r.style_id}"` : !isoOf(r.country) ? `unknown country "${r.country}"` : MARKETPLACES.test(r.website) ? "a marketplace" : !url(r.website) ? "no website" : null;
    if (why) left.push(`${r.brand_name || "?"} · ${r.style_id} · ${r.country}: ${why}`);
    return !why;
  });

  // Each brand's site once, and each proof of presence once.
  const sites = [...new Set(usable.map((r) => url(r.website)))];
  const proofs = [...new Set(usable.map((r) => url(r.presence_evidence_url)).filter(Boolean))];
  const collections = [...new Set(usable.map((r) => url(r.collection_evidence_url)).filter(Boolean))];
  console.log(`Checking ${sites.length} sites, ${proofs.length} presence pages, ${collections.length} collection pages…`);
  const siteRes = new Map(sites.map((s, i) => [s, i]));
  const siteChecks = await pool(sites, 16, fetchPage);
  const proofOk = new Map((await pool(proofs, 16, async (u) => [u, (await fetchPage(u)).ok] as const)));
  const collOk = new Map((await pool(collections, 16, async (u) => [u, (await fetchPage(u)).ok] as const)));

  const sql: string[] = ["-- Brands researched elsewhere, imported as proposed (scripts/import-brands.ts).", "begin;"];
  const brandsDone = new Set<string>();
  let links = 0;
  for (const r of usable) {
    const site = url(r.website);
    const check = siteChecks[siteRes.get(site)!];
    const proof = url(r.presence_evidence_url);
    const presenceOk = proof ? !!proofOk.get(proof) : false;
    if (!check.ok && !presenceOk) {
      left.push(`${r.brand_name} · ${r.style_id} · ${r.country}: its site and proof don't open`);
      continue;
    }
    const key = nameKey(r.brand_name);
    const country = isoOf(r.country)!;
    if (!brandsDone.has(key)) {
      brandsDone.add(key);
      const logo = logoFrom(check.html, site);
      sql.push(`insert into public.brands (name, name_key, website, instagram, origin_country, wears, label_type, logo_url, link_ok, link_checked_at) values (${q(r.brand_name)}, ${q(key)}, ${q(site)}, ${q(r.instagram_handle.replace(/^@/, ""))}, ${q(isoOf(r.origin_country))}, ${WEARS.includes(r.wears) ? q(r.wears) : "null"}, ${q(r.label_type)}, ${q(logo)}, ${check.ok}, now()) on conflict (name_key) do update set website = coalesce(brands.website, excluded.website), logo_url = coalesce(brands.logo_url, excluded.logo_url), link_ok = excluded.link_ok, link_checked_at = now();`);
    }
    const price = Number(r.sample_price.replace(/[^0-9.]/g, ""));
    sql.push(`insert into public.brand_markets (brand_id, country, presence_type, presence_url, presence_ok, price_feel, sample_price, sample_currency, sample_item, checked_date) select id, ${q(country)}, ${q(PRESENCE.includes(r.presence_type) ? r.presence_type : "own site delivers here")}, ${q(proof || site)}, ${presenceOk}, ${FEEL.includes(r.price_feel) ? q(r.price_feel) : "null"}, ${Number.isFinite(price) && price > 0 ? price : "null"}, ${q(r.sample_currency.toUpperCase().slice(0, 3))}, ${q(r.sample_item)}, ${/^\d{4}-\d{2}-\d{2}$/.test(r.checked_date) ? q(r.checked_date) : "current_date"} from public.brands where name_key = ${q(key)} on conflict (brand_id, country) do nothing;`);
    const coll = url(r.collection_evidence_url);
    sql.push(`insert into public.brand_styles (brand_id, style_id, association, visible_cues, collection_url, collection_ok, editorial_url, similar_reference, confidence, found_by, checked_date) select id, ${q(r.style_id)}, ${q(r.association === "main" ? "main" : "adjacent")}, ${q(r.visible_cues || "—")}, ${q(coll)}, ${coll ? !!collOk.get(coll) : "null"}, ${q(url(r.editorial_mention_url))}, ${q(r.similar_reference_brands)}, ${q(r.confidence === "verified_collection" ? "verified_collection" : "written_evidence_only")}, 'import', ${/^\d{4}-\d{2}-\d{2}$/.test(r.checked_date) ? q(r.checked_date) : "current_date"} from public.brands where name_key = ${q(key)} on conflict (brand_id, style_id) do nothing;`);
    links++;
  }
  sql.push("commit;");
  writeFileSync("brands-import.sql", `${sql.join("\n")}\n`);
  writeFileSync("brands-import-left-out.txt", `${left.join("\n")}\n`);
  try {
    execSync("pbcopy < brands-import.sql");
  } catch {
    // Not on a Mac: the file is there.
  }
  console.log(`${brandsDone.size} brands, ${links} brand-style links ready (brands-import.sql, on the clipboard). ${left.length} left out (brands-import-left-out.txt).`);
}

main();
