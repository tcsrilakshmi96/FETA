// The new-person walk-through (founder, 18 Nov 2026): a browser goes
// through Feta the way someone new does, on made-up places (₹0), and checks
// what the quality check can't: that every option is on screen, that what
// they pick or type is saved, and that it shows in You and on Home.
// Caught too late before: only 8 of 12 cuisines showed in India, and a typed
// "Mexican" wasn't a chosen cuisine.
//
//   npm run journey
//
// Starts its own test server (FAKE_PLACES=1) on port 3100, opens Feta with
// ?qa=<tester code> so it never counts as a person, and deletes its account at the end.
// Needs Google Chrome on this Mac.
import { spawn, type ChildProcess } from "node:child_process";
import puppeteer, { type Page } from "puppeteer-core";
import { QUESTIONS } from "@/lib/onboarding";
import { cuisinesFor } from "@/lib/swipes";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const results: { ok: boolean; what: string; detail?: string }[] = [];
const check = (ok: boolean, what: string, detail?: string) => {
  results.push({ ok, what, detail });
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? `\n    ${detail}` : ""}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serverUp() {
  try {
    return (await fetch(`${BASE}/privacy`)).ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<ChildProcess | null> {
  if (await serverUp()) return null;
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], { env: { ...process.env, FAKE_PLACES: "1", DAILY_BUDGET_INR: "100000", PICKS_USER_DAILY_LIMIT: "1000" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 90 && !(await serverUp()); i++) await wait(1000);
  if (!(await serverUp())) {
    console.error("Couldn't start the test server. Is another `next dev` running in this folder? Stop it and try again.");
    process.exit(1);
  }
  return server;
}

// Clicks the first button whose words match.
const click = (p: Page, re: RegExp) =>
  p.evaluate((src) => {
    const r = new RegExp(src);
    const el = [...document.querySelectorAll("button")].find((b) => r.test((b.textContent ?? "").trim()) && !b.disabled);
    el?.click();
    return !!el;
  }, re.source);
const texts = (p: Page, selector: string) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.textContent ?? "").trim()), selector);
// The tester code (QA_CODE in .env.local), so the account is a test one.
const QA = process.env.QA_CODE ?? "";
const rest = async (token: string, path: string) => (await fetch(`${DB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } })).json();

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // A phone in another time zone than the server, as on Vercel, so a page
  // that reads the time zone while drawing shows up as a hydration error.
  await p.emulateTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/London" ? "Asia/Kolkata" : "Europe/London");
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push((e as Error).message));
  // The server's page and the phone's first draw must match (tester, 23 Nov 2026: React error #418 on /questions).
  p.on("console", (m) => m.type() === "error" && /hydrat|#418/i.test(m.text()) && errors.push(m.text().slice(0, 200)));
  let token: string | null = null;
  try {
    // Welcome: three cards, 18+, then the name and what they want.
    await p.goto(`${BASE}/?qa=${QA}`, { waitUntil: "networkidle0" });
    await click(p, /^Next$/);
    await wait(300);
    await click(p, /^Next$/);
    await wait(300);
    await click(p, /I'm 18 or older/);
    await click(p, /Let's start/);
    await p.waitForSelector("input[aria-label='Your first name']", { timeout: 15000 });
    check(p.url().includes("/start"), "Welcome leads to the start screen", p.url());
    await p.type("input[aria-label='Your first name']", "Journey");
    await click(p, /Places to eat and drink/);
    await click(p, /Things to do/);
    await click(p, /^(Continue|Next)/);
    await p.waitForFunction(() => location.pathname === "/location", { timeout: 15000 });
    // Where they are, before the questions (founder, 19 Nov 2026: the
    // questions show that city's money and cuisines).
    // "Where should Feta look?": type a city and pick it, then anywhere in it.
    const cityBox = await p.waitForSelector("input[placeholder^='Type a city']", { timeout: 30000 }).catch(() => null);
    if (cityBox) {
      await cityBox.type("Bengaluru");
      await p.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Bengaluru/.test((b.textContent ?? "").trim())), { timeout: 20000 }).catch(() => null);
      await click(p, /^Bengaluru/);
    }
    await p.waitForFunction(() => location.pathname === "/questions" || [...document.querySelectorAll("button")].some((b) => /^Anywhere in /.test(b.textContent ?? "")), { timeout: 20000 }).catch(() => null);
    await click(p, /^Anywhere in /);
    if (process.env.JOURNEY_DEBUG) {
      console.log("location buttons:", await texts(p, "button"));
      await p.screenshot({ path: "/tmp/journey-location.png" });
    }
    await p.waitForFunction(() => location.pathname === "/questions", { timeout: 20000 });
    check(true, "Start leads to the location screen, then the questions");
    // Opened fresh, as after a reload, so the server draws it too and any
    // difference from the phone's draw shows as a hydration error.
    await p.reload({ waitUntil: "networkidle0" });

    // The questions, screen by screen.
    const city = await p.evaluate(() => JSON.parse(localStorage.getItem("feta.city") ?? "null") as { country: string; name: string } | null);
    const expectedCuisines = cuisinesFor(city?.country).map((c) => c.label);
    // The broad things to do; a group's specifics show once it's chosen.
    const expectedInterests = QUESTIONS.find((q) => q.id === "interests")!.options.filter((o) => !o.parent).map((o) => o.label);
    const ticked = expectedCuisines.slice(0, 4);
    const typedKnown = expectedCuisines.find((l) => /mexican/i.test(l)) ?? expectedCuisines[expectedCuisines.length - 1];
    let sawTaste = false;
    for (let screen = 0; screen < 6 && p.url().includes("/questions"); screen++) {
      const heading = (await p.evaluate(() => document.querySelector("h1, h2")?.textContent ?? "")).trim();
      if (await p.$("[aria-label='Another cuisine'], [class*=cuisines]")) {
        sawTaste = true;
        const shown = (await texts(p, "[class*=cuisines] button")).map((t) => t.replace(/^＋\s*/, ""));
        const missing = expectedCuisines.filter((l) => !shown.includes(l));
        check(missing.length === 0, `All ${expectedCuisines.length} cuisines are on screen${city ? ` (${city.name})` : ""}`, `missing: ${missing.join(", ")}`);
        const chips = await texts(p, "button");
        const missingInterests = expectedInterests.filter((l) => !chips.includes(l));
        check(missingInterests.length === 0, `All ${expectedInterests.length} things to do are on screen`, `missing: ${missingInterests.join(", ")}`);
        for (const l of ticked) await click(p, new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        // A 5th cuisine says "up to 4" (tester, 23 Nov 2026: silently ignored).
        const fifth = expectedCuisines.find((l) => !ticked.includes(l) && l !== typedKnown)!;
        await click(p, new RegExp(`^${fifth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        check(/That's 4 already/.test(await p.evaluate(() => document.body.innerText)), "A 5th cuisine says up to 4");
        await click(p, /Something else/);
        await p.waitForSelector("input[aria-label='Another cuisine']");
        await p.type("input[aria-label='Another cuisine']", `${typedKnown}, Burmese`);
        await click(p, /^Live music$/);
        await click(p, /^Board games$/);
        await click(p, /^Classes and workshops$/);
        check((await texts(p, "button")).includes("Pottery"), "Choosing Classes and workshops shows Pottery and the other specifics");
        await click(p, /^Pottery$/);
        const own = await p.$("input[placeholder*='own words'], textarea[placeholder*='own words']");
        if (own) await own.type("pottery with friends");
      } else if (/places/i.test(heading)) {
        // A place added by mistake can be taken back (tester, 23 Nov 2026).
        await p.type("input[aria-label='A place you love']", "Corner Cafe");
        await p.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /test 1/.test(b.textContent ?? "")), { timeout: 15000 }).catch(() => null);
        await click(p, /test 1/);
        await p.waitForSelector("button[aria-label^='Remove ']", { timeout: 5000 }).catch(() => null);
        const added = !!(await p.$("button[aria-label^='Remove ']"));
        await p.evaluate(() => (document.querySelector("button[aria-label^='Remove ']") as HTMLButtonElement | null)?.click());
        await wait(300);
        check(added && !(await p.$("button[aria-label^='Remove ']")), "A place they love can be added and taken back with ✕");
      } else if (/basics/i.test(heading)) {
        await click(p, /^Everything$/);
        // Spend: the two middle levels, like most people ("₹500–1,500", "₹1,500–3,000").
        await p.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /^\D*[\d,]+–[\d,]+/.test((b.textContent ?? "").trim())).slice(1, 3).forEach((b) => b.click()));
        await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Short ride|Walking/.test(b.textContent ?? ""))?.click());
        await click(p, /^Sometimes$/);
      }
      await click(p, /^(Continue|Next|Save)$/);
      await wait(1500);
    }
    check(sawTaste, "The cuisine and things-to-do screen showed up");
    check(p.url().includes("/home"), "The questions lead to Home", p.url());

    // Saved the way they chose it.
    token = await p.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
      return k ? (JSON.parse(localStorage.getItem(k)!).access_token as string) : null;
    });
    check(!!token, "A private account was made");
    if (token) {
      const lines = (await rest(token, "profile_lines?select=line_key,text&removed_at=is.null")) as { line_key: string; text: string }[];
      const fav = lines.find((l) => l.line_key === "cuisines")?.text ?? "";
      check([...ticked, typedKnown].every((l) => fav.includes(l)), `Ticked cuisines and typed "${typedKnown}" are favourites`, `saved: ${fav}`);
      check(lines.some((l) => l.line_key === "food_other" && /Burmese/.test(l.text) && !new RegExp(typedKnown, "i").test(l.text)), 'Typed "Burmese" is kept in their own words', JSON.stringify(lines));
      const answers = ((await rest(token, "answers?select=diet,interests,spend")) as { diet: string; interests: string[]; spend: string[] }[])[0];
      check(answers?.diet === "everything" && answers.interests.includes("live_music") && answers.interests.includes("board_games") && answers.interests.includes("workshops") && answers.interests.includes("class_pottery") && answers.spend.length > 0, "Diet, spend and things to do are saved", JSON.stringify(answers));
    }

    await p.waitForFunction(() => location.pathname === "/home", { timeout: 20000 }).catch(() => null);
    await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
    await wait(3000);
    const home = await p.evaluate(() => document.body.innerText);
    // The first visit's one pop-up is "Save your taste", once the picks have had a moment (26 Nov 2026).
    const asked = await p.waitForSelector("[role=dialog][aria-label='Save your taste']", { timeout: 15000 }).then(() => true).catch(() => false);
    check(asked, "The first visit asks to Save your taste");
    await click(p, /^Later$/);
    await wait(500);
    // No greeting on Home since 24 Nov 2026: their initial is on the You button.
    check(await p.evaluate(() => (document.querySelector("button[aria-label^='You']")?.textContent ?? "").trim().startsWith("J")), "Home's You button shows their initial");

    // Opening Feta again (as the installed app does, at /) goes to Home
    // without showing Welcome's "Sign in" first (founder, 25 Nov 2026).
    {
      // A plain string: the test runner's compiled helpers don't exist in the page.
      const watcher = await p.evaluateOnNewDocument(`
        new MutationObserver(function () {
          if (document.body && /Already use Feta/.test(document.body.innerText)) sessionStorage.setItem("journey.welcomeShown", "1");
        }).observe(document, { childList: true, subtree: true, characterData: true });
      `);
      await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await p.waitForFunction(() => location.pathname === "/home", { timeout: 15000 }).catch(() => null);
      const flashed = await p.evaluate(() => sessionStorage.getItem("journey.welcomeShown"));
      check(!flashed && p.url().includes("/home"), "Opening Feta again goes to Home without showing Welcome's Sign in", p.url());
      await p.removeScriptToEvaluateOnNewDocument(watcher.identifier);
      await p.waitForFunction(() => !document.body.innerText.includes("Finding"), { timeout: 60000 }).catch(() => null);
      await wait(2500); // the tiles finish arriving before anything is measured
    }
    check(/EAT/.test(home) && /DO/.test(home) && /WEAR/.test(home) && /TRIP/.test(home), "Home shows Eat, Do, Wear and Trip side by side");
    check(!/Couldn't reach|didn't work/i.test(home), "Home has picks, not an error", home.slice(0, 300));

    // One Where sheet from Home's area (tester, 26 Nov 2026: "couldn't find
    // where to change location"): Near me and a search for any city, no setup screens.
    const areaBtn = await p.$("button[class*=area]");
    if (areaBtn) {
      await areaBtn.click();
      await p.waitForSelector("[role=dialog][aria-label='Where are you?']", { timeout: 5000 }).catch(() => null);
    }
    const whereText = await p.evaluate(() => document.querySelector("[role=dialog][aria-label='Where are you?']")?.textContent ?? "");
    check(/Near me/.test(whereText) && !!(await p.$("[role=dialog] input[type=search]")) && (await p.evaluate(() => location.pathname)) === "/home", "Home's area opens the Where sheet with Near me and a city search, staying on Home", whereText.slice(0, 200));
    await p.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent?.trim() === "Close")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await wait(400);

    // Search (founder, 23 Nov 2026): the round button on Home moves nothing,
    // a search shows its own list, and a search never changes their taste.
    const homeBefore = await p.evaluate(() => Math.round([...document.querySelectorAll("[class*=quad] > *")].at(-1)?.getBoundingClientRect().bottom ?? -1));
    const searchBtn = await p.$("button[aria-label^='Search a place']");
    check(!!searchBtn, "Home has a Search button");
    const linesBefore = token ? ((await rest(token, "profile_lines?select=line_key")) as unknown[]).length : 0;
    if (searchBtn) {
      await searchBtn.click();
      await p.waitForFunction(() => location.pathname === "/search", { timeout: 10000 }).catch(() => null);
      // One back arrow, top left (testers, 26 Nov 2026: "going back is poor").
      const arrow = await p.$("main button[aria-label='Back']");
      if (arrow) {
        await arrow.click();
        await p.waitForFunction(() => location.pathname === "/home", { timeout: 10000 }).catch(() => null);
      }
      check(!!arrow && (await p.evaluate(() => location.pathname)) === "/home", "Search's back arrow goes back to Home");
      await (await p.$("button[aria-label^='Search a place']"))?.click();
      await p.waitForFunction(() => location.pathname === "/search", { timeout: 10000 }).catch(() => null);
      await p.type("input[type=search]", "pottery");
      await p.keyboard.press("Enter");
      await p.waitForFunction(() => location.pathname === "/picks" && /pottery/.test(document.querySelector("h1")?.textContent ?? ""), { timeout: 15000 }).catch(() => null);
      await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      await wait(1500);
      const found = await p.evaluate(() => document.body.innerText);
      check(/“pottery”/.test(found) && /Clay Studio/.test(found) && !/Add to your taste/.test(found), "A search for pottery shows a list titled with it, without the taste box", found.slice(0, 300));
      const linesAfter = token ? ((await rest(token, "profile_lines?select=line_key")) as unknown[]).length : 0;
      check(linesAfter === linesBefore, "A search adds nothing to their taste", `${linesBefore} → ${linesAfter} lines`);
      await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
      await wait(2500);
      const homeAfter = await p.evaluate(() => Math.round([...document.querySelectorAll("[class*=quad] > *")].at(-1)?.getBoundingClientRect().bottom ?? -1));
      check(homeBefore > 0 && homeBefore === homeAfter, "Home's tiles sit where they did before the search", `${homeBefore} → ${homeAfter}`);
    }

    // The picks list scrolled just past where the header shrinks stays put
    // (tester video, 19 Nov 2026: the header flickered between big and small).
    await p.goto(`${BASE}/picks?c=food_drinks`, { waitUntil: "networkidle0" });
    await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
    await wait(1500);
    const steady = await p.evaluate(async () => {
      const list = [...document.querySelectorAll("main div")].find((d) => getComputedStyle(d).overflowY === "auto") as HTMLElement;
      // Just long enough to scroll past the shrink point: the case that flickered.
      const room = document.createElement("div");
      list.appendChild(room);
      room.style.height = `${list.clientHeight + 80 - room.offsetTop - parseFloat(getComputedStyle(list).paddingBottom)}px`;
      list.scrollTop = 75;
      const seen: number[] = [];
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        seen.push(list.scrollTop);
      }
      return { start: seen[2], end: seen[19], changes: new Set(seen.slice(2)).size };
    });
    check(steady.changes === 1 && steady.end >= 60, "The picks header shrinks once and the list stays still", JSON.stringify(steady));

    // Coming back after a plan (walk-through, 25 Nov 2026): "How was
    // tonight?" asks about a plan that started hours ago, the same night, and
    // never opens on top of another pop-up.
    if (token) {
      const sets = (await rest(token, "pick_sets?select=picks&category=eq.food_drinks&order=created_at.desc&limit=3")) as { picks: { placeId: string }[] }[];
      const ids = sets.flatMap((x) => x.picks.map((y) => y.placeId)).slice(0, 2);
      const me = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;
      // 200 minutes ago, on yesterday's date just after midnight.
      const d = new Date(Date.now() - 200 * 60000);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const started = d.getHours() * 60 + d.getMinutes();
      await fetch(`${DB}/rest/v1/saved_plans`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ user_id: me, day, start_minute: started, place_ids: ids, city_id: await p.evaluate(() => (JSON.parse(localStorage.getItem("feta.city") ?? "null") as { id: string } | null)?.id ?? null), country: "IN", time_zone: "Asia/Kolkata", currency: "INR" }) });
      // Sign-in has had its turn, so the testers' form is due too and the two race.
      await p.evaluate(() => localStorage.setItem("feta.saveTasteAsked", "1"));
      const again = await browser.newPage(); // a new visit: a fresh tab session, same phone
      await again.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      await again.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
      let most = 0;
      let asked = false;
      for (let i = 0; i < 24; i++) {
        await wait(500);
        const seen = await again.evaluate(() => ({ n: document.querySelectorAll('[role="dialog"]').length, how: /How was (tonight|\w+day)\?/.test(document.body.innerText) }));
        most = Math.max(most, seen.n);
        asked ||= seen.how;
      }
      check(asked, "Coming back asks how a plan went once it started hours ago");
      check(most <= 1, "Coming back, pop-ups open one at a time", `${most} at once`);
      // Left open in the background for 30 minutes is a new visit (founder,
      // 26 Nov 2026): back on Home, it reloads and the visit's pop-up is free again.
      await again.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Ask me later/.test(b.textContent ?? ""))?.click());
      await wait(500);
      const used = await again.evaluate(() => !!sessionStorage.getItem("feta.visit.popupShown"));
      const reloaded = again.waitForNavigation({ timeout: 8000 }).then(() => true).catch(() => false);
      // As a string, so the test runner adds nothing to it.
      await again.evaluate(`(() => {
        let state = "hidden";
        Object.defineProperty(document, "visibilityState", { get: () => state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        const real = Date.prototype.getTime;
        Date.prototype.getTime = function () { return real.call(this) + 31 * 60000; };
        state = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
      })()`);
      let picksAsked = 0;
      again.on("request", (r) => r.url().includes("/api/picks") && r.method() === "POST" && picksAsked++);
      const fresh = (await reloaded) && !(await again.evaluate(() => sessionStorage.getItem("feta.visit.popupShown")));
      await wait(3000);
      check(used && fresh, "30 minutes away starts a new visit", JSON.stringify({ used, fresh }));
      // Lists under an hour old come back from the phone: the reload searches nothing (tech audit, 26 Nov 2026).
      check(picksAsked === 0, "A new visit after 30 minutes searches nothing again", `${picksAsked} searches`);
      await again.close();
    }

    // You shows what they shared.
    await p.goto(`${BASE}/you`, { waitUntil: "networkidle0" });
    await wait(2000);
    const you = await p.evaluate(() => document.body.innerText);
    check(new RegExp(typedKnown).test(you) && /Burmese/.test(you), `You shows "${typedKnown}" and "Burmese"`, you.slice(0, 400));
    // The form from "Send feedback" (founder, 26 Nov 2026): once opened there,
    // neither "How's Feta so far?" nor the form card asks again.
    await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Send feedback/.test(b.textContent ?? ""))?.click());
    await wait(600);
    const formLink = await p.evaluate(() => { const a = [...document.querySelectorAll("a")].find((x) => /short form/.test(x.textContent ?? "")); a?.addEventListener("click", (e) => e.preventDefault()); a?.click(); return !!a; });
    const marks = await p.evaluate(() => ({ asked: !!localStorage.getItem("feta.feedbackAsked"), form: localStorage.getItem("feta.formOpened") }));
    check(formLink && marks.asked && marks.form === "1", "Opening the form from Send feedback stops both feedback pop-ups asking", JSON.stringify({ formLink, ...marks }));
    await p.keyboard.press("Escape");

    // A change in You changes the picks (founder, 19 Nov 2026: "if the
    // choices in You are changed, is it impacting the choices given?").
    // Home's picks are kept on the phone, so this goes Home → You → Home
    // inside the app, the way a person does, not by reloading.
    const korean = /Seoul Kitchen|Hansik Bowl/;
    const turnOn = expectedCuisines.find((l) => /korean/i.test(l) && !ticked.includes(l));
    const foodList = async () => {
      await p.evaluate(() => (document.querySelector("button[aria-label^='Food and drinks']") as HTMLButtonElement | null)?.click());
      await p.waitForFunction(() => location.pathname === "/picks", { timeout: 15000 }).catch(() => null);
      await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      await wait(1500);
      return p.evaluate(() => document.body.innerText);
    };
    if (turnOn) {
      await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
      await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      const before = await foodList();
      await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
      await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      await p.evaluate(() => (document.querySelector("button[aria-label^='You']") as HTMLButtonElement | null)?.click());
      await p.waitForFunction((l) => [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === l), { timeout: 20000 }, turnOn).catch(() => null);
      await click(p, new RegExp(`^${turnOn}$`));
      // Straight back, the way a person does: the search must wait for the save.
      await click(p, /Home$/);
      await p.waitForFunction(() => location.pathname === "/home" && !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      const after = await foodList();
      check(korean.test(after) && !korean.test(before), `Turning on ${turnOn} in You brings Korean places to the picks`, `before: ${korean.test(before)}, after: ${korean.test(after)}`);
    }

    // A reload on the picks list shows the list kept on the phone, with no new
    // ask to the server (audit, 24 Nov 2026: the list's first save wiped it).
    {
      await p.goto(`${BASE}/picks?c=food_drinks`, { waitUntil: "networkidle0" });
      await p.waitForFunction(() => !document.body.innerText.includes("Finding") && !document.querySelector("[data-waiting]"), { timeout: 60000 }).catch(() => null);
      await wait(1000);
      let asked = 0;
      const count = (r: { url: () => string }) => { if (r.url().includes("/api/picks")) asked++; };
      p.on("request", count);
      await p.reload({ waitUntil: "networkidle0" });
      await wait(2500);
      p.off("request", count);
      const text = await p.evaluate(() => document.body.innerText);
      check(asked === 0 && /★|Test Area/.test(text), "Reloading the picks list shows the list kept on the phone, without asking again", `asked ${asked}`);
      // A place saved here leaves every other list kept on the phone, even
      // ones this screen never showed (audit, 24 Nov 2026).
      type Kept = { slots?: Record<string, { picks: { placeId: string }[] }> };
      const first = await p.evaluate(() => {
        const kept = JSON.parse(localStorage.getItem("feta.picks.kept") ?? "{}") as Kept;
        return Object.entries(kept.slots ?? {}).find(([k]) => k.endsWith("tonight:food_drinks"))?.[1].picks[0]?.placeId ?? null;
      });
      await p.evaluate(() => (document.querySelector("button[aria-label='Save']") as HTMLButtonElement | null)?.click());
      await wait(800);
      const elsewhere = await p.evaluate((id) => {
        const kept = JSON.parse(localStorage.getItem("feta.picks.kept") ?? "{}") as Kept;
        return Object.entries(kept.slots ?? {}).filter(([k]) => !k.endsWith("tonight:food_drinks")).some(([, s]) => s.picks.some((x) => x.placeId === id));
      }, first);
      check(!!first && !elsewhere, "A place saved on the list leaves the other lists kept on the phone", String(first));
      // Let's go saves nothing and takes nothing off the list unless Save is
      // tapped (testers, 26 Nov 2026: the suggestion disappeared).
      const hero = await p.evaluate(() => (document.querySelector("button[aria-label$=': details']") as HTMLButtonElement | null)?.getAttribute("aria-label")?.replace(/: details$/, "") ?? null);
      await p.evaluate(() => (document.querySelector("button[aria-label$=': details']") as HTMLButtonElement | null)?.click());
      await wait(600);
      await click(p, /^Let.s go$/);
      await wait(600);
      const sheetSave = await p.evaluate(() => document.body.innerText.includes("Save to Want to try"));
      await click(p, /^Done$/);
      await wait(600);
      const stillThere = !!hero && (await p.evaluate((n) => document.body.innerText.includes(n), hero));
      check(sheetSave && stillThere, "Let's go keeps the pick on the list and offers Save to Want to try", `${hero} · save offered: ${sheetSave} · still there: ${stillThere}`);
    }

    // Another account's things left on the phone (founder, 21 Nov 2026: "in
    // one phone even after memory deletion the data gets overlapped") go, and
    // this account's own come back.
    await p.evaluate(() => {
      localStorage.setItem("feta.owner", "someone-else");
      localStorage.setItem("feta.name", "Oldname");
    });
    await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
    await p.waitForFunction(() => location.pathname === "/home" && /EAT/.test(document.body.innerText), { timeout: 30000 }).catch(() => null);
    const mine = await p.evaluate(() => ({ text: document.body.innerText, owner: localStorage.getItem("feta.owner"), name: localStorage.getItem("feta.name") }));
    check(mine.name === "Journey" && mine.owner !== "someone-else", "Another account's things on the phone are cleared and this account's come back", JSON.stringify({ name: mine.name, owner: mine.owner }));

    // "Use my location" during setup goes on to the questions (founder,
    // 23 Nov 2026: it went straight to Home, so nothing was asked).
    const gps = await browser.createBrowserContext();
    await gps.overridePermissions(BASE, ["geolocation"]);
    const g = await gps.newPage();
    await g.setGeolocation({ latitude: 12.97, longitude: 77.59 });
    await g.goto(`${BASE}/location?setup=1`, { waitUntil: "networkidle0" });
    await g.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Use my location/.test(b.textContent ?? ""))?.click());
    await g.waitForFunction(() => location.pathname !== "/location", { timeout: 20000 }).catch(() => null);
    const gpsPath = await g.evaluate(() => location.pathname);
    check(gpsPath === "/questions", "Use my location in setup leads to the questions, not Home", gpsPath);
    // Reopening finds them again (founder, 26 Nov 2026: back to "All of Bangalore"): the choice is kept, never the place.
    const kept = await g.evaluate(() => ({ choice: localStorage.getItem("feta.nearMe"), where: Object.keys(localStorage).filter((k) => /origin|area/.test(k)) }));
    check(kept.choice === "1" && !kept.where.length, "Near me is remembered as a choice, with no location kept on the phone", JSON.stringify(kept));
    await gps.close();

    // Someone who chose only Style (user test, 24 Nov 2026): setup skips the
    // places questions, and Home searches nothing (it paid for two unseen searches).
    const only = await browser.createBrowserContext();
    const o = await only.newPage();
    let picksAsked = 0;
    o.on("request", (r) => r.url().includes("/api/picks") && picksAsked++);
    await o.goto(`${BASE}/?qa=${QA}`, { waitUntil: "networkidle0" });
    await o.evaluate(() => {
      localStorage.setItem("feta.wants", JSON.stringify(["style"]));
      localStorage.setItem("feta.name", "Only");
    });
    await o.goto(`${BASE}/location?setup=1`, { waitUntil: "networkidle0" });
    const onlyBox = await o.waitForSelector("input[placeholder^='Type a city']", { timeout: 30000 }).catch(() => null);
    if (onlyBox) {
      await onlyBox.type("Bengaluru");
      await o.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Bengaluru/.test((b.textContent ?? "").trim())), { timeout: 20000 }).catch(() => null);
      await o.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Bengaluru/.test((b.textContent ?? "").trim()))?.click());
      await o.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /^Anywhere in /.test(b.textContent ?? "")), { timeout: 20000 }).catch(() => null);
      await o.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Anywhere in /.test(b.textContent ?? ""))?.click());
    }
    await o.waitForFunction(() => location.pathname === "/home", { timeout: 20000 }).catch(() => null);
    await wait(4000);
    check(o.url().includes("/home"), "Choosing only Style skips the places questions", o.url());
    // And coming back to Feta brings them Home, not Welcome (audit, 24 Nov
    // 2026: skipping the questions also skipped finishing setup).
    await o.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await o.waitForFunction(() => location.pathname === "/home", { timeout: 15000 }).catch(() => null);
    check(o.url().includes("/home"), "Someone who chose only Style comes back to Home, not Welcome", o.url());
    check(picksAsked === 0, "Home searches nothing for someone who chose only Style", `${picksAsked} searches`);
    const onlyToken = await o.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
      return k ? (JSON.parse(localStorage.getItem(k)!).access_token as string) : null;
    });
    if (onlyToken) await fetch(`${DB}/rest/v1/rpc/delete_my_data`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${onlyToken}`, "Content-Type": "application/json" }, body: "{}" });
    await only.close();

    check(errors.length === 0, "No errors on any screen", errors.join(" | "));
  } catch (error) {
    check(false, "The walk-through finished", String(error));
  } finally {
    if (token) await fetch(`${DB}/rest/v1/rpc/delete_my_data`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    await browser.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid);
      } catch {
        // Already stopped.
      }
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll journey checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
