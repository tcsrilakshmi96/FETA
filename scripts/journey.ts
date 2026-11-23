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
// ?qa=1 so it never counts as a person, and deletes its account at the end.
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
const rest = async (token: string, path: string) => (await fetch(`${DB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } })).json();

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push((e as Error).message));
  let token: string | null = null;
  try {
    // Welcome: three cards, 18+, then the name and what they want.
    await p.goto(`${BASE}/?qa=1`, { waitUntil: "networkidle0" });
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
    check(/Hi Journey/.test(home), "Home says hello by name");
    check(!/Couldn't reach|didn't work/i.test(home), "Home has picks, not an error", home.slice(0, 300));

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

    // You shows what they shared.
    await p.goto(`${BASE}/you`, { waitUntil: "networkidle0" });
    await wait(2000);
    const you = await p.evaluate(() => document.body.innerText);
    check(new RegExp(typedKnown).test(you) && /Burmese/.test(you), `You shows "${typedKnown}" and "Burmese"`, you.slice(0, 400));

    // A change in You changes the picks (founder, 19 Nov 2026: "if the
    // choices in You are changed, is it impacting the choices given?").
    // Home's picks are kept on the phone, so this goes Home → You → Home
    // inside the app, the way a person does, not by reloading.
    const korean = /Seoul Kitchen|Hansik Bowl/;
    const turnOn = expectedCuisines.find((l) => /korean/i.test(l) && !ticked.includes(l));
    const foodList = async () => {
      await click(p, /^See all/);
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

    // Another account's things left on the phone (founder, 21 Nov 2026: "in
    // one phone even after memory deletion the data gets overlapped") go, and
    // this account's own come back.
    await p.evaluate(() => {
      localStorage.setItem("feta.owner", "someone-else");
      localStorage.setItem("feta.name", "Oldname");
    });
    await p.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
    await p.waitForFunction(() => location.pathname === "/home" && /Hi /.test(document.body.innerText), { timeout: 30000 }).catch(() => null);
    const mine = await p.evaluate(() => ({ text: document.body.innerText, owner: localStorage.getItem("feta.owner") }));
    check(/Hi Journey/.test(mine.text) && !/Oldname/.test(mine.text) && mine.owner !== "someone-else", "Another account's things on the phone are cleared and this account's come back", mine.text.slice(0, 200));

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
    await gps.close();

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
