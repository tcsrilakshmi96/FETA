// One real user test (founder, 24 Nov 2026): a browser goes through Feta as
// one tester from Notion (👥 Testers & User Acquisition), screenshots every
// screen for the UI/UX audit, and prints what Feta picked and where each pick
// came from. Run against a server you start yourself:
//   made-up places (₹0):  FAKE_PLACES=1 npx next dev -p 3400
//   real data (paid):     TEST_USER_DAILY_BUDGET_INR=130 npx next dev -p 3400
//   then: node --env-file=.env.local scripts/user-test.mjs
// Opens Feta with the tester code, so it's a test account (its own budget,
// never counted as a person), and deletes the account at the end.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.TEST_BASE ?? "http://localhost:3400";
const OUT = process.env.TEST_OUT ?? "/tmp/user-test";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const { NEXT_PUBLIC_SUPABASE_URL: DB, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY, QA_CODE: QA } = process.env;
// TEST_ONLY=style: chooses only What to wear, and goes straight to Style.
const STYLE_ONLY = process.env.TEST_ONLY === "style";
const P = {
  name: process.env.TEST_NAME ?? "Barbara",
  city: process.env.TEST_CITY ?? "London",
  // Barbara, London (founder, 24 Nov 2026): vegan; chic and classic,
  // minimalist but classy and luxurious; no loud places; likes to explore
  // new things to do; studied fashion, knows her brands.
  diet: /^Vegan$/,
  loves: (process.env.TEST_LOVES ?? "Mildreds|Kew Gardens").split("|"),
  cuisines: new RegExp(process.env.TEST_CUISINES ?? "^(Japanese|Italian|Middle Eastern|Mediterranean)", "i"),
  own: process.env.TEST_OWN ?? "quiet, elegant places, nothing loud",
  interests: new RegExp(process.env.TEST_INTERESTS ?? "^(Art and galleries|Classes and workshops|Tastings|Wellness)$", "i"),
  vibe: /quiet|calm|cosy|cozy|intimate|elegant|low-key/i,
  styles: /^(Minimalist|Polished|Tailoring)$/,
};
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (s) => {
  log.push(s);
  console.log(s);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const p = await browser.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await p.emulateTimezone("Europe/London");
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let n = 0;
const shot = async (name, full = false) => {
  n++;
  await p.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${name}.png`, fullPage: full });
};
const text = () => p.evaluate(() => document.body.innerText);
const click = (re) =>
  p.evaluate((src) => {
    const el = [...document.querySelectorAll("button, a")].find((b) => new RegExp(src, "i").test((b.textContent ?? "").trim()) && !b.disabled);
    el?.click();
    return !!el;
  }, re.source);
// Buttons only, exact case, as the Style walk-through taps.
const tap = (re) =>
  p.evaluate((src) => {
    const el = [...document.querySelectorAll("button")].find((b) => new RegExp(src).test((b.textContent ?? "").trim()) && !b.disabled);
    el?.click();
    return !!el;
  }, re.source);
const until = (re, ms = 20000) => p.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: ms }, re.source).then(() => true).catch(() => false);
const settled = async (ms = 90000) => {
  await p.waitForFunction(() => !/Finding|Looking for/i.test(document.body.innerText) && !document.querySelector("[data-waiting]"), { timeout: ms }).catch(() => null);
  await wait(1500);
};
const token = () => p.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
  return k ? JSON.parse(localStorage.getItem(k)).access_token : null;
});
const spend = async () => {
  const t = await token();
  if (!t) return null;
  const r = await fetch(`${DB}/rest/v1/rpc/budget_today`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" });
  const b = await r.json();
  return Math.round(Number(b?.mine ?? 0));
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    note(`! ${name} didn't finish: ${String(e).slice(0, 160)}`);
    await shot(`${name}-stuck`).catch(() => null);
  }
  const s = await spend().catch(() => null);
  note(`· ${name} done${s !== null ? ` · spent so far ₹${s}` : ""}`);
};

try {
  await step("welcome", async () => {
    await p.goto(`${BASE}/?qa=${QA}`, { waitUntil: "networkidle0" });
    await shot("welcome");
    await click(/^Next$/);
    await wait(400);
    await click(/^Next$/);
    await wait(400);
    await shot("welcome-3");
    await click(/I'm 18 or older/);
    await click(/Let's start/);
    await p.waitForSelector("input[aria-label='Your first name']", { timeout: 15000 });
    await p.type("input[aria-label='Your first name']", P.name);
    if (!STYLE_ONLY) {
      await click(/Places to eat and drink/);
      await click(/Things to do/);
    }
    await click(/What to wear/);
    await shot("start");
    await click(/^(Continue|Next)/);
    await p.waitForFunction(() => location.pathname === "/location", { timeout: 15000 });
  });

  await step("location", async () => {
    const box = await p.waitForSelector("input[placeholder^='Type a city']", { timeout: 30000 });
    await shot("location");
    await box.type(P.city);
    await p.waitForFunction((c) => [...document.querySelectorAll("button")].some((b) => new RegExp(`^${c}`).test((b.textContent ?? "").trim())), { timeout: 20000 }, P.city);
    await click(new RegExp(`^${P.city}`));
    await wait(1200);
    await shot("location-area");
    await click(/^Anywhere in /);
    await p.waitForFunction(() => /^\/(questions|home|style)/.test(location.pathname), { timeout: 20000 });
  });

  if (!STYLE_ONLY) await step("questions", async () => {
    for (let screen = 0; screen < 7 && p.url().includes("/questions"); screen++) {
      await wait(800);
      const heading = (await p.evaluate(() => document.querySelector("h1, h2")?.textContent ?? "")).trim();
      await shot(`questions-${screen + 1}`);
      if (await p.$("[aria-label='Another cuisine'], [class*=cuisines]")) {
        // One tap at a time, as a person does.
        const tapEach = async (src, scope, max) => {
          const labels = await p.evaluate((src, scope) => [...document.querySelectorAll(scope)].map((b) => (b.textContent ?? "").trim()).filter((t) => new RegExp(src, "i").test(t)), src, scope);
          for (const l of labels.slice(0, max)) {
            await click(new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
            await wait(400);
          }
          return labels.slice(0, max);
        };
        note(`  cuisines: ${(await tapEach(P.cuisines.source, "[class*=cuisines] button", 3)).join(", ")}`);
        note(`  things to do: ${(await tapEach(P.interests.source, "button", 4)).join(", ")}`);
        const own = await p.$("input[placeholder*='own words'], textarea[placeholder*='own words']");
        if (own) await own.type(P.own);
        await shot(`questions-${screen + 1}-chosen`, true);
      } else if (/places/i.test(heading)) {
        for (const place of P.loves) {
          await p.click("input[aria-label='A place you love']", { clickCount: 3 }).catch(() => null);
          await p.type("input[aria-label='A place you love']", place);
          await p.waitForFunction((pl) => [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").toLowerCase().includes(pl.toLowerCase().split(" ")[0])), { timeout: 15000 }, place).catch(() => null);
          await p.evaluate((pl) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").toLowerCase().includes(pl.toLowerCase().split(" ")[0]) && !/Remove/.test(b.getAttribute("aria-label") ?? ""))?.click(), place);
          await wait(1500);
        }
        await shot(`questions-${screen + 1}-loved`, true);

      } else if (/basics/i.test(heading)) {
        await click(P.diet);
        await wait(600);
        // Confirm a diet when asked.
        await click(/^(Yes|Confirm|That's right)/);
        // The two highest spend levels (classy, luxurious).
        await p.evaluate(() => { const b = [...document.querySelectorAll("button")].filter((b) => /^\D*[\d,]+(–[\d,]+|\+)$/.test((b.textContent ?? "").trim())); b.slice(-2).forEach((x) => x.click()); });
        await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Short ride/.test(b.textContent ?? ""))?.click());
        await click(/^Sometimes$/);
        await shot(`questions-${screen + 1}-basics`, true);
      } else {
        // A vibe card or anything else: the calm one, else the first choice.
        await p.evaluate((src) => { const all = [...document.querySelectorAll("main button")].filter((b) => !/Continue|Next|Save|Back|Skip/.test(b.textContent ?? "")); (all.find((b) => new RegExp(src, "i").test(b.textContent ?? "")) ?? all[0])?.click(); }, P.vibe.source);
      }
      await click(/^(Continue|Next|Save|Done)/);
      await wait(1500);
      // "Recommend them to people like you?" comes after the places.
      if (await click(/^Yes, recommend them/)) await wait(1500);
    }
  });

  if (!STYLE_ONLY) await step("home", async () => {
    await p.waitForFunction(() => location.pathname === "/home", { timeout: 30000 });
    await shot("home-loading");
    await settled();
    await wait(25000); // events arriving late join the list
    await shot("home");
    await shot("home-full", true);
  });

  if (!STYLE_ONLY) await step("food-list", async () => {
    await p.goto(`${BASE}/picks?c=food_drinks`, { waitUntil: "networkidle0" });
    await settled();
    await shot("food-list");
    await shot("food-list-full", true);
    writeFileSync(`${OUT}/food.txt`, await text());
  });

  if (!STYLE_ONLY) await step("details", async () => {
    await p.evaluate(() => (document.querySelector("[class*=card] button, article button, [role=button]"))?.click());
    await wait(2500);
    await shot("details");
    await shot("details-full", true);
    await click(/^(Save|Want to try|♡)/);
    await wait(1000);
    if (await click(/Send to the group|Tell your friends/)) {
      await until(/Open WhatsApp|Copy/, 15000);
      await shot("share-ready");
    }
  });

  if (!STYLE_ONLY) await step("todo-list", async () => {
    await p.goto(`${BASE}/picks?c=experiences`, { waitUntil: "networkidle0" });
    await settled();
    await wait(25000);
    await shot("todo-list");
    await shot("todo-list-full", true);
    writeFileSync(`${OUT}/todo.txt`, await text());
  });

  if (!STYLE_ONLY) await step("saved", async () => {
    await p.goto(`${BASE}/lists`, { waitUntil: "networkidle0" });
    await wait(4000);
    await shot("saved");
  });

  if (!STYLE_ONLY) await step("you", async () => {
    await p.goto(`${BASE}/you`, { waitUntil: "networkidle0" });
    await wait(2500);
    await shot("you");
    await shot("you-full", true);
  });

  await step("style", async () => {
    await p.goto(`${BASE}/style`, { waitUntil: "networkidle0" });
    await p.waitForFunction(() => location.pathname.startsWith("/style"), { timeout: 20000 });
    await wait(1500);
    await shot("style-intro");
    await tap(/^Let's start/);
    await wait(700);
    await tap(/^Womenswear$/);
    await wait(700);
    await p.evaluate((src) => [...document.querySelectorAll("button[aria-pressed]")].filter((x) => new RegExp(src).test((x.querySelector("[class*=tileName]")?.textContent ?? "").trim())).forEach((x) => x.click()), P.styles.source);
    await wait(500);
    await shot("style-line");
    await tap(/^Next · /);
    await wait(1500);
    await shot("style-lineup");
    await tap(/^Continue with/);
    await wait(800);
    // The two highest clothes budgets (luxurious).
    await p.evaluate(() => { const b = [...document.querySelectorAll("button[aria-pressed]")]; b.slice(-2).forEach((x) => x.click()); });
    await shot("style-budget");
    await tap(/^See my style/);
    await p.waitForFunction(() => location.pathname === "/style", { timeout: 20000 }).catch(() => null);
    await until(/Where are you/);
    await wait(4000); // as a person would (a dev server starts each screen twice)
    await shot("style-where");
    await tap(/^Tonight$/);
    await tap(/^Dinner$/);
    note(`  tapped Show my looks: ${await tap(/^Show my looks/)}`);
    await wait(3000);
    await shot("style-after-show");
    await until(/1 of 3/, 30000);
    await shot("style-look-1");
    writeFileSync(`${OUT}/style.txt`, await text());
    await tap(/See this exact look/);
    await wait(600);
    await shot("style-choice");
    await tap(/^Just the outfit/);
    await p.waitForFunction(() => ![...document.images].some((i) => /\/style\/boards\//.test(i.src)), { timeout: 95000 }).catch(() => null);
    await wait(2000);
    await shot("style-exact");
    await tap(/^Wear this$/);
    await wait(1500);
    await shot("style-wearing");
  });

  await step("brands", async () => {
    await p.goto(`${BASE}/style/brands`, { waitUntil: "networkidle0" });
    await wait(4000);
    await shot("brands");
    writeFileSync(`${OUT}/brands.txt`, await text());
  });

  if (!STYLE_ONLY) await step("ask", async () => {
    await p.goto(`${BASE}/ask`, { waitUntil: "networkidle0" });
    await wait(1500);
    await shot("ask");
    const box = await p.$("textarea, input[type=text]");
    if (box) {
      await box.type("Somewhere nice for a drink after work on Friday?");
      await p.keyboard.press("Enter");
      await wait(30000);
      await shot("ask-reply", true);
      writeFileSync(`${OUT}/ask.txt`, await text());
    }
  });

  await step("home-again", async () => {
    await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
    await wait(3000);
    await shot("home-again");
  });

  // Where each pick came from, from the kept sets (place IDs and Feta's own words).
  const t = await token();
  if (t) {
    const sets = await (await fetch(`${DB}/rest/v1/pick_sets?select=category,when_slot,searched,banner,picks&order=created_at.desc&limit=6`, { headers: { apikey: KEY, Authorization: `Bearer ${t}` } })).json();
    writeFileSync(`${OUT}/sets.json`, JSON.stringify(sets, null, 1));
    for (const s of sets) {
      const shown = (s.picks ?? []).filter((x) => !x.spare);
      const from = (x) => (x.event ? `event (${x.event.fromList ? "her guide list" : "web"})` : x.fetaNote !== undefined ? "Feta Pick" : x.local ? "local favourite" : x.featured ? `Featured in ${x.featured.guide}` : x.lovedBy ? "loved by Feta users" : "Google");
      note(`\n${s.category} · ${s.when_slot} · searched: ${(s.searched ?? []).join(", ")}`);
      for (const x of shown) note(`  - [${from(x)}] ${x.because || "(no reason)"} · ${x.verdict}`);
      if (s.banner) note(`  banner: ${s.banner}`);
    }
  }
  note(`\nTotal spent: ₹${await spend()}`);
  note(`Page errors: ${errors.length ? errors.join(" | ").slice(0, 400) : "none"}`);
} finally {
  const t = await token().catch(() => null);
  if (t && !process.env.TEST_KEEP) await fetch(`${DB}/rest/v1/rpc/delete_my_data`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" });
  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  await browser.close();
}
