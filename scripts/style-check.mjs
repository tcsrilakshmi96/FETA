// Style walkthrough, one check per row of the mock-up (founder, 22–23 Nov
// 2026, docs/style-spec.md; earlier: screens that couldn't scroll, a hidden
// Continue, Home searching places for someone who chose only Style). Needs a
// FAKE_PLACES=1 dev server on port 3000 (made-up looks, no pictures), ₹0:
//   FAKE_PLACES=1 npx next dev -p 3000   then   npm run style-check
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
// The tester code (QA_CODE in .env.local), so the account is a test one.
const QA = (readFileSync(".env.local", "utf8").match(/^QA_CODE=(.*)$/m)?.[1] ?? "").trim();
const prefix = process.argv[2] ?? "/tmp/style-check";
const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let looksCalls = 0;
p.on("request", (r) => r.url().includes("/api/style/looks") && r.method() === "POST" && looksCalls++);
const click = (re) => p.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll("button")].find((x) => r.test((x.textContent ?? "").trim()) && !x.disabled); el?.click(); return !!el; }, re.source);
const text = () => p.evaluate(() => document.body.innerText);
const checks = [];
const ok = (name, pass) => checks.push(`${pass ? "✓" : "✗"} ${name}`);
const shot = async (n) => { await wait(900); await p.screenshot({ path: `${prefix}-${n}.png` }); };
const scrollEnd = () => p.evaluate(async () => { const m = document.querySelector("main"); if (!m) return { scrolls: false, moved: false, missing: true }; const before = m.scrollTop; m.scrollTo({ top: m.scrollHeight }); await new Promise((r) => setTimeout(r, 600)); const moved = m.scrollTop > before; m.scrollTo({ top: 0 }); return { scrolls: m.scrollHeight > m.clientHeight, moved }; });
const buttonVisible = (re) => p.evaluate((src) => { const el = [...document.querySelectorAll("button")].find((x) => new RegExp(src).test((x.textContent ?? "").trim())); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, re.source);
const until = (re, ms = 15000) => p.waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), { timeout: ms }, re.source).then(() => true).catch(() => false);
// A swipe on the look card (pointer events, as on a phone).
const swipe = (dx) => p.evaluate((dx) => { const el = document.querySelector("[class*=deck]"); if (!el) return false; const r = el.getBoundingClientRect(); const y = r.top + 200; const x = r.left + r.width / 2; el.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, bubbles: true })); el.dispatchEvent(new PointerEvent("pointerup", { clientX: x + dx, clientY: y, bubbles: true })); return true; }, dx);

await p.goto(`${BASE}/?qa=${QA}`, { waitUntil: "networkidle0" });
const city = { id: "gn:1277333", name: "Bengaluru", region: "Karnataka", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 12.97, lng: 77.59 };
await p.evaluate((city) => { sessionStorage.setItem("feta.origin", JSON.stringify({ lat: city.lat, lng: city.lng, label: "Anywhere in Bengaluru", source: "city", city })); localStorage.setItem("feta.city", JSON.stringify(city)); localStorage.setItem("feta.name", "Check"); localStorage.setItem("feta.wants", JSON.stringify(["style"])); }, city);

await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
await wait(2500);
const home = await text();
ok("Home (only Style chosen) shows What to wear", /What to wear/.test(home));
ok("Home doesn't search food or things to do", !/Finding your picks/.test(home) && /Tell Feta what you like/.test(home));

// A · First time: the intro, then what they shop for, then the clothesline.
await p.goto(`${BASE}/style`, { waitUntil: "networkidle0" });
await p.waitForFunction(() => location.pathname === "/style/setup", { timeout: 20000 });
await until(/wherever you/);
await shot("a-intro");
ok("A: the intro says what Style does", /Looks made for your plans/.test(await text()) && /Brands for your styles/.test(await text()));
ok("A: Let's start is on screen", await buttonVisible(/^Let's start/));
await click(/^Let's start/);
await wait(600);
ok("A: shop for comes first; Next waits for it", /What do you/.test(await text()) && (await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Pick what you shop for/.test(x.textContent))?.disabled)) === true);
await click(/^Womenswear$/);
await wait(600);
ok("A: then the clothesline and Feta's looks", /Hang up looks/.test(await text()) && /Tap Feta/.test(await text()));
// IF NO photos: tap Feta's looks.
for (const i of [0, 3]) {
  await p.evaluate((i) => [...document.querySelectorAll("button[aria-pressed]")].filter((x) => x.querySelector("img"))[i]?.click(), i);
  await wait(300);
}
await wait(500);
await shot("a-line");
ok("A: Next counts the looks tapped", await buttonVisible(/^Next · 2 looks/));
ok("A: tapped looks hang on the line (2 / 8)", /2\s*\/ 8/.test(await text()));
ok("A: the button sits at the bottom of the screen", await p.evaluate(() => { const el = [...document.querySelectorAll("button")].find((x) => /^Next · 2 looks/.test(x.textContent.trim())); return !!el && innerHeight - el.getBoundingClientRect().bottom < 60; }));
await click(/^Next · 2 looks/);
await wait(1200);
ok("A: tapped looks go straight to the lineup (no reading)", /Continue with 2 styles/.test(await text()));
const s3 = await scrollEnd();
ok("A: the styles screen scrolls", s3.scrolls ? s3.moved : true);
await click(/^Continue with/);
await wait(800);
ok("A: budget comes after styles, nothing ticked", await buttonVisible(/^Tick at least one/));
await click(/^Easy/);
await click(/^Treat/);
ok("A: two budget levels can be ticked", await buttonVisible(/^See my style/) && (await p.evaluate(() => document.querySelectorAll("button[aria-pressed=true]").length)) === 2);
await click(/^See my style/);
await p.waitForFunction(() => location.pathname === "/style", { timeout: 20000 }).catch(() => null);

let pictureAsks = 0;
p.on("request", (r) => { if (r.url().includes("/api/style/picture")) pictureAsks++; });

// B · No plan: Where are you going?
ok("B: no plan asks where they're going", await until(/Where are you/));
await shot("b-where");
// After 10 pm (city time) it asks tonight or tomorrow first.
await click(/^Tonight$/);
await click(/^Dinner$/);
await click(/^Show my looks/);
ok("C: 3 looks, the first one on screen", await until(/1 of 3/, 20000));
await shot("c-look1");
const pieces = await p.evaluate(() => document.querySelectorAll("[class*=pieceRow] button").length);
ok(`C: the lookbook lists every piece (${pieces})`, pieces >= 3);
// Never a sketch (founder, 23 Nov 2026): every picture is a real one.
ok("C: no sketch anywhere on the look", await p.evaluate(() => ![...document.images].some((i) => /\/style\/looks\//.test(i.src)) && !/Feta's sketch/.test(document.body.innerText)));
// Each look's outfit picture is made as it comes on screen; never on their
// photo (founder, 25 Nov 2026).
for (let i = 0; i < 20 && pictureAsks === 0; i++) await wait(200);
ok("C: the look on screen has its picture made", pictureAsks > 0);
await wait(800);
ok("C: no On me choice or switch", !(await buttonVisible(/^On me/)) && !(await buttonVisible(/^Show it on me$/)));
ok("C: test mode makes no picture, so the style's library picture stands in, said so", await p.evaluate(() => [...document.images].some((i) => /\/style\/boards\//.test(i.src))) && /not this exact one/.test(await text()));
ok("C: Wear this and the swipe hint show", await buttonVisible(/^Wear this$/) && /Swipe to wear/.test(await text()));
await swipe(-120);
ok("C: swipe left shows the next look", await until(/2 of 3/, 3000));
await click(/^‹$/);
ok("C: ‹ goes back to the last one", await until(/1 of 3/, 3000));
// A piece: I have one, Show me another.
await p.evaluate(() => document.querySelector("[class*=pieceRow] button")?.click());
await wait(500);
ok("C: tapping a piece opens its sheet", /I have one like this/.test(await text()));
await click(/^I have one like this/);
ok("C: I have one marks it as theirs", await until(/YOURS/, 4000));
await p.evaluate(() => document.querySelectorAll("[class*=pieceRow] button")[1]?.click());
await wait(400);
await click(/^Show me another/);
ok("C: Show me another changes only that piece", await until(/the rest stays/, 15000));
// Seen all 3 → What's off?
await click(/^✕$/); await wait(500);
await click(/^✕$/); await wait(500);
await click(/^✕$/);
ok("C: after all 3, Feta asks what's off", await until(/What's off/, 4000));
await shot("c-off");
const before = looksCalls;
await click(/^Too dressy$/);
ok("C: What's off makes 3 new looks", await until(/1 of 3/, 20000) && looksCalls === before + 1);
// Wear this (swipe right).
await swipe(140);
ok("C: swipe right wears it", await until(/You're wearing/, 5000));
await shot("c-worn");
await click(/^Done$/);
await p.waitForFunction(() => location.pathname === "/home", { timeout: 10000 }).catch(() => null);
ok("C: Home's tile shows the look", await until(/YOU'RE WEARING/i, 10000));
await shot("home-wearing");

// D · Coming back: the look stays put, no new looks asked.
const calls = looksCalls;
await p.goto(`${BASE}/style`, { waitUntil: "networkidle0" });
ok("D: coming back opens on the look they're wearing", await until(/You're wearing this/, 10000));
ok("D: coming back asks for no new looks", looksCalls === calls);
ok("D: coming back asks whether to change the outfit", /Changing your outfit\?/.test(await text()));
await click(/^Yes, where are you going/);
ok("D: yes asks where they're going again", await until(/Where are you going/, 5000));
await click(/^Keep what I'm wearing/);
ok("D: keeping it goes back to the look", await until(/You're wearing this/, 5000));
await click(/^Or another of today/);
ok("D: Pick a different look goes back to the 3", await until(/of 3/, 5000) && looksCalls === calls);
// Where to buy keeps the look.
await swipe(-120);
await until(/2 of 3/, 3000);
await p.evaluate(() => document.querySelector("[class*=pieceRow] button")?.click());
await wait(400);
await click(/^Where to buy/);
ok("E: Where to buy opens brands for the piece", await until(/Where to buy/, 8000) && /Back to your look/.test(await text()));
await shot("e-piece");
await click(/Back to your look/);
ok("E: back to the same look", await until(/2 of 3/, 10000) && looksCalls === calls);
await swipe(140);
ok("D: wearing another one replaces the day's look", await until(/You're wearing/, 5000));

// E · Brands: For you, a ♥ asks once about recommending.
await p.goto(`${BASE}/style/brands`, { waitUntil: "networkidle0" });
ok("E: Brands opens on For you with Your usuals", await until(/Your usuals/, 8000) && /For you/.test(await text()));
await shot("e-brands");
const hearts = await p.evaluate(() => document.querySelectorAll("button[aria-label^='I shop at']").length);
if (hearts) {
  await p.evaluate(() => document.querySelector("button[aria-label^='I shop at']")?.click());
  ok("E: the first ♥ asks whether to recommend", await until(/Recommend the brands you shop from/, 3000));
  await click(/^Yes, recommend them/);
  ok("E: the brand joins Your usuals", await until(/added to your usuals/, 4000));
} else ok("E: (no brands in the library here to ♥)", true);
const sb = await scrollEnd();
ok("E: Brands scrolls", sb.scrolls ? sb.moved : true);

// F · My style: one page.
await p.goto(`${BASE}/style/me`, { waitUntil: "networkidle0" });
ok("F: My style shows the wardrobe and looks worn", await until(/Your wardrobe · 1/, 8000) && /Wear it again/.test(await text()));
await shot("f-me");
await click(/^Menswear$/);
ok("F: changing what they shop for says so", await until(/Every look now shows menswear/, 4000));
await click(/^Womenswear$/);
const sm = await scrollEnd();
ok("F: My style scrolls", sm.scrolls ? sm.moved : true);
await click(/^Wear it again/);
ok("F: Wear it again opens it in Today, no new looks", await until(/You're wearing this/, 10000) && looksCalls === calls);

ok("No page errors", errors.length === 0);
// Its test account is deleted at the end, as the journey's is (24 Nov 2026).
await deleteAccount(p);
console.log(checks.join("\n"));
if (errors.length) console.log(errors);
await b.close();
process.exit(checks.some((c) => c.startsWith("✗")) ? 1 : 0);

async function deleteAccount(page) {
  const env = readFileSync(".env.local", "utf8");
  const DB = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
  const KEY = env.match(/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.*)$/m)?.[1]?.trim();
  const token = await page
    .evaluate(() => {
      const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
      return k ? JSON.parse(localStorage.getItem(k) ?? "{}").access_token ?? null : null;
    })
    .catch(() => null);
  if (DB && KEY && token) await fetch(`${DB}/rest/v1/rpc/delete_my_data`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
}
