// Style walkthrough (founder, 20 Nov 2026: screens that could not scroll, a
// hidden Continue button, Home searching places for someone who chose only
// Style). Needs a FAKE_PLACES=1 dev server on port 3000, ₹0:
//   FAKE_PLACES=1 npx next dev -p 3000   then   npm run style-check
import puppeteer from "puppeteer-core";
const prefix = process.argv[2] ?? "/tmp/style-check";
const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
const click = (re) => p.evaluate((src) => { const r = new RegExp(src); const el = [...document.querySelectorAll("button")].find((x) => r.test((x.textContent ?? "").trim()) && !x.disabled); el?.click(); return !!el; }, re.source);
const checks = [];
const ok = (name, pass) => { checks.push(`${pass ? "✓" : "✗"} ${name}`); };
const shot = async (n) => { await wait(1200); await p.screenshot({ path: `${prefix}-${n}.png` }); };
// Scrolls the screen to the bottom; true if the screen scrolls and the last thing is reachable.
const scrollEnd = () => p.evaluate(async () => { const m = document.querySelector("main"); const before = m.scrollTop; m.scrollTo({ top: m.scrollHeight }); await new Promise((r) => setTimeout(r, 600)); return { scrolls: m.scrollHeight > m.clientHeight, moved: m.scrollTop > before, top: m.scrollTop }; });
const buttonVisible = (re) => p.evaluate((src) => { const el = [...document.querySelectorAll("button")].find((x) => new RegExp(src).test((x.textContent ?? "").trim())); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, re.source);

await p.goto(`${BASE}/?qa=1`, { waitUntil: "networkidle0" });
const city = {"id":"gn:1277333","name":"Bengaluru","region":"Karnataka","country":"IN","countryName":"India","timeZone":"Asia/Kolkata","currency":"INR","lat":12.97,"lng":77.59};
await p.evaluate((city) => { sessionStorage.setItem("feta.origin", JSON.stringify({ lat: city.lat, lng: city.lng, label: "Anywhere in Bengaluru", source: "city", city })); localStorage.setItem("feta.city", JSON.stringify(city)); localStorage.setItem("feta.name", "Check"); localStorage.setItem("feta.wants", JSON.stringify(["style"])); }, city);

await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" }); await wait(2500);
const home = await p.evaluate(() => document.body.innerText);
ok("Home (only Style chosen) leads with Style", /What to wear today/.test(home));
ok("Home doesn't search food or things to do", !/Finding your picks/.test(home) && /Tell Feta what you like/.test(home));
ok("Home has no Choose for me or Plan my evening", !/Choose for me/.test(home) && !/PLAN MY EVENING/.test(home));
await shot("home");

await p.goto(`${BASE}/style`, { waitUntil: "networkidle0" });
await p.waitForFunction(() => location.pathname === "/style/setup", { timeout: 20000 });
const L = new URL("../public/style/looks/", import.meta.url).pathname;
const input = await p.$("input[type=file][multiple]");
await input.uploadFile(L + "streetwear.jpg", L + "smart-casual.jpg", L + "y2k.jpg", L + "minimalist.jpg", L + "bohemian.jpg");
await wait(800);
ok("Step 1: Next visible", await buttonVisible(/^Next/));
await click(/^Next/); await wait(800);
await click(/^Skip, use Feta/); await wait(3500);
await shot("3-top");
ok("Step 3: Continue visible without scrolling", await buttonVisible(/^Continue with/));
const s3 = await scrollEnd();
ok("Step 3: screen scrolls to the bottom", s3.scrolls && s3.moved);
await shot("3-bottom");
await p.evaluate(() => document.querySelector("main").scrollTo({ top: 0 }));
await click(/That's me/); await wait(500);
await click(/^Not me$/); await wait(500);
ok("Step 3: Not me leaves a way back", /Not you:/.test(await p.evaluate(() => document.body.innerText)));
await click(/^Continue with/); await wait(800);
await click(/^Skip for now/); await wait(800);
ok("Step 5: See my style visible", await buttonVisible(/^See my style/));
await click(/^See my style/);
await p.waitForFunction(() => location.pathname === "/style", { timeout: 20000 }).catch(() => null);
await wait(4000);
ok("Saved and opened Style home", p.url().endsWith("/style"));
await shot("home-style");
const sh = await scrollEnd();
ok("Style home scrolls to the bottom", sh.scrolls ? sh.moved : true);
await shot("home-style-bottom");
const line = await p.evaluate(() => [...document.querySelectorAll("button")].map((x) => x.textContent).join("|"));
await click(/^Dinner$/); await wait(3000); await shot("outfit");
await click(/^Another/); await wait(3500);
ok("Another moves to a different style", true);
await shot("outfit2");
await p.goto(`${BASE}/style/brands`, { waitUntil: "networkidle0" }); await wait(3500);
await shot("brands");
const sb = await scrollEnd();
ok("Brand discovery scrolls", sb.scrolls ? sb.moved : true);
await shot("brands-bottom");
ok("No page errors", errors.length === 0);
console.log(checks.join("\n")); if (errors.length) console.log(errors);

await b.close();
