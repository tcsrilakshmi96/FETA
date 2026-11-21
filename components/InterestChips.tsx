"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { QUESTIONS, toggleInterest, type Option } from "@/lib/onboarding";

// The things-to-do choices, the same on every screen (setup, a category's
// first time, You): the broad ones, and under a chosen group its optional
// specifics on a line of their own (founder, 21 Nov 2026). Each screen
// draws a chip in its own style.
export default function InterestChips({ chosen, onChange, chip, className, style }: { chosen: string[]; onChange: (next: string[], option: Option, on: boolean) => void; chip: (o: Option, on: boolean, toggle: () => void) => ReactNode; className?: string; style?: CSSProperties }) {
  const options = QUESTIONS.find((q) => q.id === "interests")!.options;
  const toggle = (o: Option) => () => onChange(toggleInterest(chosen, o.id), o, !chosen.includes(o.id));
  return (
    <div className={className} style={style}>
      {options
        .filter((o) => !o.parent)
        .map((o) => {
          const kids = chosen.includes(o.id) ? options.filter((k) => k.parent === o.id) : [];
          return (
            <Fragment key={o.id}>
              {chip(o, chosen.includes(o.id), toggle(o))}
              {kids.length > 0 && (
                <span className="interest-kids">
                  <small>Any in particular? Optional</small>
                  {kids.map((k) => (
                    <Fragment key={k.id}>{chip(k, chosen.includes(k.id), toggle(k))}</Fragment>
                  ))}
                </span>
              )}
            </Fragment>
          );
        })}
    </div>
  );
}
