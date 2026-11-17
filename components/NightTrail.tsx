"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { minuteClock, stopNote, type Night, type NightPlace } from "@/lib/night-plan";
import styles from "./NightTrail.module.css";

// The cheese trail (founder, 17 Nov 2026: "label 2, a bit smaller"): the
// stops where they really are, joined by a melted-cheese line that draws
// itself while a cheese rides along it. Each stop's label (time, name, why
// it's there) pops out when the cheese arrives, and the walk or ride
// between stops on the way. The streets behind are only a pattern, not a map.

const PAUSE = 500;
const LEG = 1500;
const PAD = { x: 64, top: 36, bottom: 30 };
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

type Pt = { x: number; y: number };

// Where each place sits in a box of this size, north up.
function project(places: NightPlace[], w: number, h: number, top: number): Pt[] {
  const k = Math.cos((places.reduce((s, p) => s + p.lat, 0) / places.length) * (Math.PI / 180));
  const xs = places.map((p) => p.lng * k);
  const ys = places.map((p) => -p.lat);
  const span = (v: number[]) => Math.max(Math.max(...v) - Math.min(...v), 0.0015);
  const scale = Math.min((w - PAD.x * 2) / span(xs), (h - top - PAD.bottom) / span(ys));
  const mid = (v: number[]) => (Math.max(...v) + Math.min(...v)) / 2;
  return places.map((_, i) => ({ x: w / 2 + (xs[i] - mid(xs)) * scale, y: top + (h - top - PAD.bottom) / 2 + (ys[i] - mid(ys)) * scale }));
}

// One gently curving piece of trail per leg.
function legPaths(pts: Pt[]) {
  return pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    const before = pts[i - 1] ?? a;
    const after = pts[i + 2] ?? b;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const bow = 0.18 * len * (i % 2 ? -1 : 1);
    const nx = (-(b.y - a.y) / len) * bow, ny = ((b.x - a.x) / len) * bow;
    const c1 = { x: a.x + (b.x - before.x) / 6 + nx, y: a.y + (b.y - before.y) / 6 + ny };
    const c2 = { x: b.x - (after.x - a.x) / 6 + nx, y: b.y - (after.y - a.y) / 6 + ny };
    return `M${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  });
}

// A label just left or right of its stop, as wide as the room on that side.
type Spot = { left: boolean; dy: number };
const LABEL_H = 44;
const room = (pt: Pt, left: boolean, w: number) => Math.max(100, (left ? pt.x : w - pt.x) - 22);
function beside(pt: Pt, spot: Spot, w: number): React.CSSProperties {
  const maxWidth = room(pt, spot.left, w);
  return spot.left ? { right: w - pt.x + 10, top: pt.y + spot.dy, maxWidth } : { left: pt.x + 10, top: pt.y + spot.dy, maxWidth };
}

// Stops close together (one neighbourhood) put their labels on top of each
// other (live run, 18 Nov 2026). Each label, top to bottom, takes the
// nearest free spot right beside its stop, on a side where it fits; a walk
// or ride chip under a label is left out (the times are in Edit too).
function layout(pts: Pt[], names: string[], w: number): { spots: Spot[]; boxes: Box[] } {
  const width = (i: number, left: boolean) => Math.min(room(pts[i], left, w), Math.max(70, names[i].length * 7.4) + 18);
  const box = (i: number, s: Spot): Box => {
    const wd = width(i, s.left);
    const x0 = s.left ? pts[i].x - 10 - wd : pts[i].x + 10;
    const y0 = pts[i].y + s.dy - LABEL_H / 2;
    return { x0, x1: x0 + wd, y0, y1: y0 + LABEL_H };
  };
  const placed: Box[] = [];
  const free = (b: Box) => placed.every((o) => !overlap(b, o));
  const spots: Spot[] = pts.map(() => ({ left: false, dy: 0 }));
  // A side only counts if the label fits there without being cut short.
  const fits = (i: number, left: boolean) => (left ? pts[i].x : w - pts[i].x) - 22 >= Math.min(140, Math.max(70, names[i].length * 7.4) + 18);
  for (const i of pts.map((_, i) => i).sort((a, b) => pts[a].y - pts[b].y)) {
    const natural = pts[i].x > w / 2;
    const sides = [natural, !natural].filter((left) => fits(i, left));
    let spot: Spot | null = null;
    // Nearest free spot: a little up or down, on a side where it fits.
    for (let n = 0; n <= 6 && !spot; n++) {
      const dy = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 8;
      for (const left of sides.length ? sides : [natural]) {
        if (!spot && free(box(i, { left, dy }))) spot = { left, dy };
      }
    }
    spots[i] = spot ?? { left: natural, dy: 0 };
    placed.push(box(i, spots[i]));
  }
  return { spots, boxes: placed };
}

type Box = { x0: number; x1: number; y0: number; y1: number };
const overlap = (a: Box, b: Box) => !(a.x1 + 4 < b.x0 || b.x1 + 4 < a.x0 || a.y1 + 4 < b.y0 || b.y1 + 4 < a.y0);

export default function NightTrail({ night, weekday, country, closed = [], room = 0 }: { night: Night; weekday: number; country: string; closed?: NightPlace[]; room?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const wedge = useRef<HTMLSpanElement>(null);
  const [legSpots, setLegSpots] = useState<Pt[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const all = [...night.stops.map((s) => s.place), ...closed];
  const pts = size && all.length ? project(all, size.w, size.h, PAD.top + room) : [];
  const stopPts = pts.slice(0, night.stops.length);
  const legs = legPaths(stopPts);
  const { spots, boxes } = size ? layout(pts, all.map((p) => p.name), size.w) : { spots: [], boxes: [] };
  const chipFree = (c: Pt) => boxes.every((b) => !overlap(b, { x0: c.x - 36, x1: c.x + 36, y0: c.y - 11, y1: c.y + 11 }));
  const key = `${night.stops.map((s) => `${s.place.placeId}@${s.at}`).join(",")}|${size?.w}x${size?.h}|${room}`;

  // The cheese rides each leg in turn; each stop appears as it arrives.
  useEffect(() => {
    if (!size || night.stops.length === 0) return;
    const els = paths.current.slice(0, legs.length).filter((p): p is SVGPathElement => !!p);
    const lengths = els.map((p) => p.getTotalLength());
    setLegSpots(els.map((p, i) => p.getPointAtLength(lengths[i] / 2)));
    const place = (pt: Pt) => wedge.current && (wedge.current.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -60%)`);
    const everything = new Set([...night.stops.map((_, i) => `s${i}`), ...legs.map((_, i) => `l${i}`)]);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || els.length !== legs.length) {
      els.forEach((p) => (p.style.strokeDashoffset = "0"));
      setShown(everything);
      if (stopPts.length) place(stopPts[stopPts.length - 1]);
      return;
    }
    els.forEach((p, i) => {
      p.style.strokeDasharray = `${lengths[i]}`;
      p.style.strokeDashoffset = `${lengths[i]}`;
    });
    setShown(new Set(["s0"]));
    place(stopPts[0]);
    let frame = 0;
    let t0 = -1; // the first frame's time
    const tick = (now: number) => {
      if (t0 < 0) t0 = now;
      const t = now - t0;
      const leg = Math.floor(t / (PAUSE + LEG));
      const inLeg = t - leg * (PAUSE + LEG) - PAUSE;
      if (leg >= els.length) {
        setShown(everything);
        place(stopPts[stopPts.length - 1]);
        return;
      }
      const f = inLeg <= 0 ? 0 : ease(Math.min(1, inLeg / LEG));
      for (let i = 0; i < leg; i++) els[i].style.strokeDashoffset = "0";
      els[leg].style.strokeDashoffset = `${lengths[leg] * (1 - f)}`;
      place(els[leg].getPointAtLength(lengths[leg] * f));
      const on = ["s0", ...Array.from({ length: leg }, (_, i) => [`l${i}`, `s${i + 1}`]).flat(), ...(f >= 0.5 ? [`l${leg}`] : []), ...(f >= 1 ? [`s${leg + 1}`] : [])];
      setShown((was) => (on.every((k) => was.has(k)) && was.size === on.length ? was : new Set(on)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replays when the stops, their times or the size change
  }, [key]);

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  return (
    <div ref={box} className={styles.map} aria-hidden="true">
      {size && (
        <>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            <rect className={styles.block} x={w * 0.04} y={h * 0.14} width={w * 0.3} height={h * 0.16} rx="10" />
            <rect className={styles.block} x={w * 0.74} y={h * 0.36} width={w * 0.22} height={h * 0.2} rx="10" />
            <rect className={styles.block} x={w * 0.07} y={h * 0.54} width={w * 0.28} height={h * 0.14} rx="10" />
            <rect className={styles.block} x={w * 0.7} y={h * 0.74} width={w * 0.26} height={h * 0.18} rx="10" />
            <path className={styles.street} d={`M-10 ${h * 0.7} C ${w * 0.3} ${h * 0.68}, ${w * 0.75} ${h * 0.66}, ${w + 10} ${h * 0.58}`} />
            <path className={styles.street} d={`M${w * 0.55} -10 C ${w * 0.52} ${h * 0.4}, ${w * 0.65} ${h * 0.72}, ${w * 0.6} ${h + 10}`} />
            <path className={styles.street} d={`M-10 ${h * 0.38} C ${w * 0.33} ${h * 0.34}, ${w * 0.74} ${h * 0.24}, ${w + 10} ${h * 0.2}`} />
            {legs.map((d, i) => (
              <path key={`${key}-${i}`} ref={(el) => void (paths.current[i] = el)} className={styles.trail} d={d} />
            ))}
          </svg>
          {night.stops.map((s, i) => {
            const pt = stopPts[i];
            const on = shown.has(`s${i}`);
            const side = spots[i].left ? styles.left : styles.right;
            return (
              <span key={s.place.placeId}>
                <span className={`${styles.spot} ${on ? styles.on : ""}`} style={{ left: pt.x, top: pt.y }} />
                <span className={`${styles.label} ${side} ${on ? styles.on : ""}`} style={beside(pt, spots[i], w)}>
                  <span className={styles.time}>{minuteClock(s.at).toUpperCase()}</span>
                  <strong>{s.place.name}</strong>
                  <small>{stopNote(night, i, weekday)}</small>
                </span>
              </span>
            );
          })}
          {closed.map((p, i) => {
            const pt = pts[night.stops.length + i];
            const spot = spots[night.stops.length + i];
            const side = spot.left ? styles.left : styles.right;
            return (
              <span key={p.placeId}>
                <span className={`${styles.spot} ${styles.closed} ${styles.on}`} style={{ left: pt.x, top: pt.y }} />
                <span className={`${styles.label} ${styles.closed} ${side} ${styles.on}`} style={beside(pt, spot, w)}>
                  <strong>{p.name}</strong>
                </span>
              </span>
            );
          })}
          {night.stops.slice(1).map((s, i) =>
            legSpots[i] && s.leg && chipFree(legSpots[i]) ? (
              <span key={`leg-${i}`} className={`${styles.leg} ${shown.has(`l${i}`) ? styles.on : ""}`} style={{ left: legSpots[i].x, top: legSpots[i].y }}>
                {s.leg.mode === "walk" ? "🚶" : country === "IN" ? "🛺" : "🚕"} {s.leg.minutes} min
              </span>
            ) : null,
          )}
          {night.stops.length > 0 && (
            <span ref={wedge} className={styles.wedge}>
              🧀
            </span>
          )}
        </>
      )}
    </div>
  );
}
