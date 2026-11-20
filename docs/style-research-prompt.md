# Style brand research prompt (founder, 20 Nov 2026)

For a free AI with web browsing. Attach `Feta_Global_Style_Brand_References_2026-11-19.xlsx`, run one country per run and 6 styles at a time, then import each CSV with `npm run import-brands -- <file.csv>` (opens every link, takes logos from the brands' own sites, writes SQL for the Supabase SQL Editor; everything comes in as "proposed" for Admin).

```
You are a fashion researcher building a brand-discovery library for an app called Feta.

ATTACHED: a reference workbook. Read "Start here", "Style guide" (36 style lenses with
definitions, visible signals and "keep separate" rules), "Brand directory", "Style finder"
and "Matching notes". The brands in it are EXAMPLES that show what kind of brand fits each
style. They are not the answer list.

TASK: For the country below, find real clothing brands that people living there can buy
from, for each style listed. Research live on the web: local fashion editorial (Vogue
<country>, Elle, GQ, Grazia, Harper's Bazaar, Hypebeast, Highsnobiety, local fashion blogs,
"best homegrown <style> brands in <country>" articles), brand websites, and store/mall
directories.

COUNTRY: <e.g. India>
STYLES (style_id from the Style guide): <e.g. minimalist, maximalist, preppy, ivy,
streetwear, skatewear>

FOR EACH STYLE: 8 to 15 brands. Mix homegrown labels from this country with international
brands that genuinely operate there (own stores or own website delivering there, e.g. Zara,
H&M, Uniqlo where present). At least half should be lesser-known or homegrown labels people
may not have heard of: that discovery is the point.

RULES
1. Brands only. Never a marketplace or multi-brand store as the answer (no Myntra, Ajio,
   Nykaa Fashion, Amazon, Namshi, Farfetch, ASOS, Zalando). A marketplace may support
   presence only if the brand also has its own site or stores.
2. Presence must be proven: physical stores in the country, OR an official local site,
   OR an official site that delivers from inside the country. Give the URL that proves it.
   A brand that only ships in from abroad may be listed, marked "ships from abroad".
3. Tag a style only from the brand's CURRENT collection: name the visible cues you saw
   (silhouette, fabric, pattern, details). Follow the Style guide's "keep separate" rules:
   a long dress is not automatically modest; technical fabric is not automatically
   techwear; culture, craft origin, coverage and aesthetic are separate.
4. Never invent a brand, URL, handle or price. If you can't verify something, leave it
   blank. Fewer real brands beat more guessed ones.
5. No comments about bodies, sizes or who "should" wear something.

OUTPUT: one CSV table, one row per brand-style link, with exactly these columns:
country, style_id, association (main | adjacent), brand_name, website, instagram_handle,
origin_country, homegrown (yes | no), wears (women | men | unisex | women+men),
presence_type (stores | official local site | own site delivers here (from inside
the country) | ships from abroad (international shipping only, duties may apply)),
presence_evidence_url, collection_evidence_url, editorial_mention_url,
visible_cues (one short line), label_type (homegrown designer-led | specialist |
large international | designer house | other), price_feel (budget | mid | premium |
luxury, relative to this country), sample_price (number), sample_currency,
sample_item, similar_reference_brands (Brand IDs or names from the workbook),
confidence (verified_collection | written_evidence_only), checked_date (YYYY-MM-DD)

After the table, list any brand you considered but left out, and why, in one line each.
```

## Updates (founder, 20 Nov 2026)

Add these lines to the RULES before the next run:

```
- Styles overlap, so one brand can appear under several styles. Big chains (Zara, H&M,
  Uniqlo, Mango, Jack & Jones, local chains) belong under every style a real part of their
  current range carries (a section, an edit, several pieces). Look across the range, never
  judge from one item.
- Denim brands count by cut: baggy → streetwear/skatewear; low-rise or bootcut → y2k; raw or
  selvedge → workwear; ripped → grunge; plain everyday denim → basics.
- New style_id "basics" (Everyday basics): plain tees, regular jeans, chinos, simple shirts,
  plain hoodies, everyday dresses, simple sneakers. Not minimalist, not streetwear.
- Look hard for outliers: small independent labels, new designers, city-specific and
  Instagram-first labels with their own site.
```
