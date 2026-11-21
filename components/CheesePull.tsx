"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import TopPill, { pillWidth, type PillPart } from "@/components/TopPill";
import type { Pick } from "@/lib/picks-client";
import styles from "./CheesePull.module.css";

// Pull down for a fresh set (founder, 16 Nov 2026: "like a cheese is being
// pulled, a cheese string"). A little cheese hangs from the pill at the top
// on five strings that thin as you pull and snap one by one, the last right
// where letting go refreshes. It bounces on the two left while Feta looks,
// is slurped back up, and the pill says what's new. Too short a pull
// springs back and nothing loads. Drawn on a canvas; with reduced motion
// the pill just says "Finding a fresh set…".
//
// onRefresh does the work and returns what the pill should say.

// What the pill says after a fresh set: "8 new picks · ★ 1 Feta Pick".
export function whatsNew(fresh: Pick[]): PillPart[] {
  if (fresh.length === 0) return [{ text: "That's everything that fits" }];
  const feta = fresh.filter((p) => p.fetaNote !== undefined).length;
  const loved = fresh.filter((p) => p.lovedBy).length;
  return [
    { text: `${fresh.length} new ${fresh.length === 1 ? "pick" : "picks"}`, tone: "count" },
    ...(feta ? [{ text: `★ ${feta} Feta ${feta === 1 ? "Pick" : "Picks"}`, tone: "star" as const }] : loved ? [{ text: `♥ ${loved} loved by Feta users`, tone: "star" as const }] : []),
  ];
}

// How far to pull before letting go refreshes: a deliberate pull, not a
// flick back to the top (founder, 21 Nov 2026: scrolling kept refreshing).
const THRESH = 125;
const MAX = 170;
const REST = 72; // where the cheese hangs while Feta looks
const MIN_WAIT = 1400; // the bounce plays at least this long
const SIZE = 1.3; // the cheese's size
const GAP = REST + 60; // how far the list moves down while Feta looks
const OFF = [-28, -15, -2, 11, 25]; // where the strings leave the pill
const SNAP = [62, Infinity, 92, Infinity, 76]; // how long each can stretch
const SHOW_MS = 2600;

const CH = "#ffc83d";
const CH_TOP = "#ffe07a";
const CH_EDGE = "#e2a227";
const CH_HOLE = "#eaa92a";
const HI = "rgba(255, 246, 205, 0.75)";
const FACE = "#3a2410";
const LIMB = "#e08c00"; // arms and legs, as in Mascot.tsx

type Phase = "idle" | "pulling" | "back" | "loading" | "absorb" | "showing";
type Bit = { off: number; top: boolean; sx: number; sy: number; w: number; t0: number };
type Drip = { x: number; y: number; vy: number; r: number; a: number };

export default function CheesePull({ scroller, onRefresh, enabled }: { scroller: RefObject<HTMLElement | null>; onRefresh: () => Promise<PillPart[]>; enabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<"hidden" | "dot" | "open">("hidden");
  const [parts, setParts] = useState<PillPart[]>([]);
  const refresh = useRef(onRefresh);
  const on = useRef(enabled);
  useEffect(() => {
    refresh.current = onRefresh;
    on.current = enabled;
  });

  useEffect(() => {
    const el = scroller.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, CX = 0, ANCHOR = 34;
    let phase: Phase = "idle";
    let pull = 0, startY = 0, tracking = false, t0 = 0, last = 0, raf = 0, absorbFrom = 0;
    let result: PillPart[] | null = null;
    let pillNow: "hidden" | "dot" | "open" = "hidden";
    const strands = OFF.map((off, i) => ({ off, snap: SNAP[i], gone: false }));
    let bits: Bit[] = [];
    let drips: Drip[] = [];
    const cheese = { x: 0, y: 0, rot: 0, sc: 0, mood: "smile" as "smile" | "o" | "wink", look: 0 };
    const timers: number[] = [];

    const setPillOnce = (s: "hidden" | "dot" | "open") => {
      if (s !== pillNow) setPill((pillNow = s));
    };

    function size() {
      const d = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      CX = W / 2;
      cv!.width = W * d;
      cv!.height = H * d;
      ctx!.setTransform(d, 0, 0, d, 0, 0);
      // Under the pill (its top follows the phone's safe area).
      ANCHOR = (pillRef.current?.offsetTop ?? 8) + 26;
    }

    // A string's end on the cheese's top face.
    function attach(off: number) {
      const lx = off * 0.33, ly = 3, c = Math.cos(cheese.rot), s = Math.sin(cheese.rot);
      return { x: cheese.x + (lx * c - ly * s) * cheese.sc, y: cheese.y + (lx * s + ly * c) * cheese.sc };
    }
    const top = (off: number) => ({ x: CX + off, y: ANCHOR + 2 });
    const widthFor = (len: number) => Math.max(1.2, 8 * Math.pow(20 / Math.max(20, len), 0.75));

    // A string: thick where it sticks, thin in the middle, a little sag.
    function drawString(ax: number, ay: number, bx: number, by: number, w: number, wiggle: number) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const sag = wiggle + w * 0.8;
      const cx = mx + (-dy / len) * sag, cy = my + (dx / len) * sag + w * 0.6;
      const L: [number, number][] = [], R: [number, number][] = [], N = 16;
      for (let k = 0; k <= N; k++) {
        const t = k / N, u = Math.abs(2 * t - 1);
        const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
        const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
        const tx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx), ty = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy), tl = Math.hypot(tx, ty) || 1;
        const hw = (w / 2) * (0.45 + 0.55 * u * u) + 2.4 * Math.pow(u, 7);
        L.push([px - (ty / tl) * hw, py + (tx / tl) * hw]);
        R.push([px + (ty / tl) * hw, py - (tx / tl) * hw]);
      }
      ctx!.beginPath();
      ctx!.moveTo(L[0][0], L[0][1]);
      for (let k = 1; k <= N; k++) ctx!.lineTo(L[k][0], L[k][1]);
      for (let k = N; k >= 0; k--) ctx!.lineTo(R[k][0], R[k][1]);
      ctx!.closePath();
      ctx!.fillStyle = CH;
      ctx!.fill();
      ctx!.beginPath();
      ctx!.moveTo(ax, ay);
      ctx!.quadraticCurveTo(cx - 0.6, cy, bx, by);
      ctx!.strokeStyle = HI;
      ctx!.lineWidth = Math.max(0.5, w * 0.22);
      ctx!.stroke();
    }

    // Feta's cheese (components/Mascot.tsx): a wedge with holes and a small
    // face, its arms up holding the strings and its legs swinging.
    function drawCheese() {
      if (cheese.sc <= 0.02) return;
      const c = ctx!;
      c.save();
      c.translate(cheese.x, cheese.y);
      c.rotate(cheese.rot);
      c.scale(cheese.sc, cheese.sc);
      const swing = Math.sin(performance.now() / 180) * 2;
      c.strokeStyle = LIMB;
      c.lineWidth = 1.8;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(-7, 26);
      c.lineTo(-7.5 + swing, 33);
      c.lineTo(-10.5 + swing, 33);
      c.moveTo(7, 26);
      c.lineTo(7.5 - swing, 33);
      c.lineTo(10.5 - swing, 33);
      c.stroke();
      c.beginPath();
      c.moveTo(-16, 8);
      c.lineTo(16, 8);
      c.quadraticCurveTo(17, 8, 17, 10);
      c.lineTo(17, 24);
      c.quadraticCurveTo(17, 27, 14, 27);
      c.lineTo(-14, 27);
      c.quadraticCurveTo(-17, 27, -17, 24);
      c.lineTo(-17, 10);
      c.quadraticCurveTo(-17, 8, -16, 8);
      c.closePath();
      c.fillStyle = CH;
      c.fill();
      c.strokeStyle = CH_EDGE;
      c.lineWidth = 1;
      c.stroke();
      c.beginPath();
      c.moveTo(-17, 9);
      c.lineTo(17, 9);
      c.lineTo(-8, -3);
      c.closePath();
      c.fillStyle = CH_TOP;
      c.fill();
      c.stroke();
      c.fillStyle = CH_HOLE;
      c.beginPath();
      c.ellipse(-6, 4, 2.6, 1.2, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(12, 21, 2.3, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(-12.5, 22, 1.7, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = FACE;
      c.strokeStyle = FACE;
      c.lineWidth = 1.4;
      c.lineCap = "round";
      const lx = cheese.look;
      c.beginPath();
      if (cheese.mood === "wink") {
        c.moveTo(-6.5, 15);
        c.lineTo(-3.5, 15);
        c.stroke();
      } else {
        c.arc(-5 + lx, 15, 1.6, 0, Math.PI * 2);
        c.fill();
      }
      c.beginPath();
      c.arc(4 + lx, 15, 1.6, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      if (cheese.mood === "o") c.ellipse(-0.5 + lx * 0.5, 20.5, 1.8, 2.3, 0, 0, Math.PI * 2);
      else c.arc(-0.5 + lx * 0.5, 18, 3, 0.2 * Math.PI, 0.8 * Math.PI);
      c.stroke();
      c.fillStyle = "rgba(255, 79, 123, 0.35)";
      c.beginPath();
      c.ellipse(-9.5, 19, 2.2, 1.3, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(8.5, 19, 2.2, 1.3, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = LIMB;
      c.fillStyle = LIMB;
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(-16.5, 15);
      c.quadraticCurveTo(-21, 8, -10, 2);
      c.moveTo(16.5, 15);
      c.quadraticCurveTo(21, 8, 10, 2);
      c.stroke();
      for (const x of [-10, 10]) {
        c.beginPath();
        c.arc(x, 2, 1.5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    function render(now: number) {
      ctx!.clearRect(0, 0, W, H);
      if (reduce) return;
      const vis = cheese.sc;
      if (vis > 0.02) {
        // Melted cheese clinging under the pill.
        const g = Math.min(1, vis * 1.2);
        ctx!.fillStyle = CH;
        ctx!.beginPath();
        ctx!.ellipse(CX, ANCHOR - 1, 36 * g, 6 * g, 0, 0, Math.PI * 2);
        ctx!.fill();
        strands.forEach((s, i) => {
          if (s.gone) return;
          const a = top(s.off), b = attach(s.off);
          drawString(a.x, a.y, b.x, b.y, widthFor(Math.hypot(b.x - a.x, b.y - a.y)) * Math.min(1, vis * 1.3), Math.sin(now / 300 + i * 1.7) * 1.6 + (i - 2) * 0.8);
        });
      }
      // Snapped strings springing back.
      bits = bits.filter((p) => {
        const u = Math.min(1, (now - p.t0) / 260), e = 1 - Math.pow(1 - u, 3);
        const a = p.top ? top(p.off) : attach(p.off);
        if (u < 1) drawString(a.x, a.y, p.sx + (a.x - p.sx) * e, p.sy + (a.y - p.sy) * e, p.w * (1 + e * 1.4), 0);
        return u < 1;
      });
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drips = drips.filter((d) => {
        d.vy += 900 * dt;
        d.y += d.vy * dt;
        d.a -= dt * 1.4;
        ctx!.globalAlpha = Math.max(0, d.a);
        ctx!.fillStyle = CH;
        ctx!.beginPath();
        ctx!.ellipse(d.x, d.y, d.r * 0.8, d.r * 1.25, 0, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.globalAlpha = 1;
        return d.a > 0 && d.y < H;
      });
      drawCheese();
    }

    function snapCheck(now: number) {
      for (const s of strands) {
        if (s.gone) continue;
        const a = top(s.off), b = attach(s.off), len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= s.snap) continue;
        s.gone = true;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w = widthFor(len);
        bits.push({ off: s.off, top: true, sx: mx, sy: my, w, t0: now }, { off: s.off, top: false, sx: mx, sy: my, w, t0: now });
        drips.push({ x: mx, y: my, vy: 40, r: 2.2, a: 1 });
      }
    }

    const move = (y: number) => (el!.style.transform = y ? `translateY(${y}px)` : "");

    function posePull(p: number, now: number) {
      cheese.sc = Math.min(1, p / 30) * SIZE;
      cheese.x = CX + Math.sin(now / 420) * Math.min(4, p / 25);
      cheese.y = ANCHOR + 4 + p * 0.95;
      cheese.rot = Math.sin(now / 520) * 0.06;
      cheese.mood = p > THRESH * 0.75 ? "o" : "smile";
      cheese.look = 0;
      // The list stays below the cheese.
      move(p * 0.95 + Math.min(p, 40) * 0.6);
      setPillOnce(p > 6 ? "dot" : "hidden");
    }

    function reset() {
      strands.forEach((s) => (s.gone = false));
      cheese.sc = 0;
      pull = 0;
      move(0);
    }

    function frame(now: number) {
      const t = (now - t0) / 1000;
      if (phase === "pulling") {
        posePull(pull, now);
        snapCheck(now);
      } else if (phase === "back") {
        const k = Math.max(0, 1 - t / 0.35);
        posePull(pull * k * k, now);
        if (k === 0) {
          reset();
          phase = "idle";
        }
      } else if (phase === "loading") {
        // Bounces on the strings that held, swings, looks around.
        const from = ANCHOR + 4 + pull * 0.95, rest = ANCHOR + 4 + REST;
        cheese.y = rest + (from - rest) * Math.exp(-3.5 * t) * Math.cos(10 * t) + Math.sin(t * 6) * 2.5 * (1 - Math.exp(-2 * t));
        cheese.x = CX + Math.sin(t * 3.4) * 9;
        cheese.rot = Math.sin(t * 3.4 + 0.6) * 0.16;
        cheese.sc = SIZE;
        cheese.mood = "smile";
        cheese.look = Math.sin(t * 2.6) * 1.4;
        const e = 1 - Math.pow(1 - Math.min(1, t / 0.45), 3);
        move((pull * 0.95 + 24) * (1 - e) + GAP * e);
        if (Math.random() < 0.02) drips.push({ x: cheese.x + (Math.random() - 0.5) * 20, y: cheese.y + 26 * SIZE, vy: 20, r: 1.8, a: 0.9 });
        if (result && t * 1000 >= MIN_WAIT) {
          phase = "absorb";
          t0 = now;
          absorbFrom = cheese.y;
        }
      } else if (phase === "absorb") {
        // Slurped back up into the pill.
        const u = Math.min(1, t / 0.38), e = u * u * u;
        cheese.y = absorbFrom + (ANCHOR - 18 - absorbFrom) * e;
        cheese.x += (CX - cheese.x) * 0.3;
        cheese.rot *= 0.8;
        cheese.sc = SIZE * (1 - 0.6 * e);
        cheese.mood = "wink";
        cheese.look = 0;
        move(GAP * (1 - e));
        if (u === 1) {
          reset();
          show(result ?? []);
        }
      }
      render(now);
      if (phase === "pulling" || phase === "back" || phase === "loading" || phase === "absorb" || bits.length || drips.length) raf = requestAnimationFrame(frame);
      else ctx!.clearRect(0, 0, W, H);
    }

    function kick() {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    // The pill says what's new, then closes; pulls wait until it has.
    function show(said: PillPart[]) {
      phase = "showing";
      setParts(said);
      setPillOnce(said.length ? "open" : "hidden");
      timers.push(
        window.setTimeout(() => {
          setPillOnce("hidden");
          phase = "idle";
        }, said.length ? SHOW_MS : 0),
      );
    }

    function startRefresh() {
      result = null;
      phase = "loading";
      t0 = performance.now();
      if (reduce) {
        reset();
        setParts([{ text: "Finding a fresh set…" }]);
        setPillOnce("open");
      }
      refresh
        .current()
        .catch(() => [{ text: "Couldn't refresh. Try again." }])
        .then((said) => {
          result = said;
          if (reduce) timers.push(window.setTimeout(() => show(said), 300));
        });
      if (!reduce) kick();
    }

    // Only a pull that starts once the list has rested at the top: a
    // finger still flicking back up the list never refreshes it.
    let topSince = el!.scrollTop > 0 ? Infinity : 0;
    function onScroll() {
      if (el!.scrollTop > 0) topSince = Infinity;
      else if (topSince === Infinity) topSince = performance.now();
    }

    function onStart(e: TouchEvent) {
      if (phase !== "idle" || !on.current || el!.scrollTop > 0 || e.touches.length !== 1 || performance.now() - topSince < 450) return;
      tracking = true;
      startY = e.touches[0].clientY;
    }

    function onMove(e: TouchEvent) {
      if (!tracking) return;
      const dy = (e.touches[0].clientY - startY) * 0.75;
      if (phase !== "pulling") {
        if (dy <= 0) {
          tracking = false; // scrolling up the list, as usual
          return;
        }
        size();
        phase = "pulling";
        kick();
      }
      e.preventDefault();
      pull = Math.max(0, Math.min(MAX, dy - Math.max(0, dy - THRESH) * 0.5));
    }

    function onEnd() {
      if (!tracking) return;
      tracking = false;
      if (phase !== "pulling") return;
      if (pull >= THRESH) startRefresh();
      else {
        phase = "back";
        t0 = performance.now();
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      el.style.transform = "";
    };
  }, [scroller]);

  return (
    <>
      <canvas ref={canvas} className={styles.cheese} aria-hidden="true" />
      <TopPill state={pill} parts={parts} width={pillWidth(parts)} pillRef={pillRef} />
    </>
  );
}
