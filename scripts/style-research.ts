// Feta's own style research, run by hand (founder, 20 Nov 2026: test it
// before any screens). For each style, finds brands people can buy from in
// the country, checks each one's current collection, and writes a table to
// judge. Uses Google Search through Gemini (paid); saves to the library as
// "proposed" only with --save.
//
//   npm run style-research -- IN India minimalist,streetwear,coquette [--save]
//   npm run style-research -- IN India minimalist --save-only   (saves an earlier run's results)
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadBrief, researchStyle, saveResearch } from "@/lib/server/style-research";
import { anonDb, withCosts } from "@/lib/server/costs";

const [code, name, styles, flag] = process.argv.slice(2);
if (!code || !name || !styles) {
  console.error("Usage: npm run style-research -- <country code> <country name> <style,style> [--save]");
  process.exit(1);
}
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  await db.auth.signInAnonymously();

  if (flag === "--save-only") {
    for (const styleId of styles.split(",")) {
      const r = JSON.parse(readFileSync(`style-research-${code}-${styleId}.json`, "utf8"));
      await saveResearch(db, code, styleId, r);
      console.log(`${styleId}: ${r.brands.length} saved as proposed`);
    }
    await db.rpc("delete_my_data");
    return;
  }
  const out: string[] = [`# Style research: ${name}`, ""];
  for (const styleId of styles.split(",")) {
    const brief = await loadBrief(db, styleId);
    if (!brief) {
      console.error(`No style "${styleId}" (has the reference workbook been loaded?)`);
      continue;
    }
    const started = Date.now();
    const r = await researchStyle(brief, { code, name });
    console.log(`${brief.name}: ${r.brands.length} brands, ${r.dropped.length} left out, ${Math.round((Date.now() - started) / 1000)} s`);
    out.push(`## ${brief.name}`, "", "| Brand | Homegrown | Main or nearby | What's visible | Price feel | Sample price | Wears | Sells here (proof) | Collection | Resembles | Confidence |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const b of r.brands)
      out.push(`| [${b.brand_name}](${b.website}) | ${b.homegrown ? "yes" : "no"} | ${b.association} | ${b.visible_cues} | ${b.price_feel ?? ""} | ${b.sample_price ? `${b.sample_price} ${b.sample_currency} (${b.sample_item})` : ""} | ${b.wears ?? ""} | [${b.presence_type}](${b.presence_url}) | [link](${b.collection_url}) | ${b.similar_reference ?? ""} | ${b.confidence} |`);
    if (r.dropped.length) out.push("", `Left out: ${r.dropped.map((d) => `${d.name} (${d.why})`).join("; ")}`);
    out.push("");
    writeFileSync(`style-research-${code}.md`, out.join("\n"));
    writeFileSync(`style-research-${code}-${styleId}.json`, JSON.stringify(r, null, 1));
    if (flag === "--save") {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await saveResearch(db, code, styleId, r);
          console.log(`  saved as proposed`);
          break;
        } catch (error) {
          console.error(`  saving failed (try ${attempt}): ${(error as Error).message}`);
          await new Promise((done) => setTimeout(done, 3000));
        }
      }
    }
  }
  await db.rpc("delete_my_data");
  const file = `style-research-${code}.md`;
  writeFileSync(file, out.join("\n"));
  console.log(`Written to ${file}`);
}

// Paid (about ₹30–60 a style): only with her OK, and logged as route "script".
withCosts(anonDb(), "script", main, { limit: "route" });
