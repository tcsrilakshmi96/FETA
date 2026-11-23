// Diet never appears on anything shareable (CLAUDE.md). A reason can carry
// what someone asked for ("Because you asked for vegetarian dinner near
// Alfama"), so a shared stop keeps its reason only when it says nothing
// about diet (rule audit, 23 Nov 2026).
const DIET = /\b(veg|vegan|vegetarian|veggie|plant[- ]based|jain|halal|kosher|pescatarian|gluten|dairy|lactose|no (?:beef|pork|meat|alcohol)|eggs?|meat[- ]free|sattvik|satvik)\b/i;

export const saysDiet = (text: string) => DIET.test(text);

export function shareSafe<T extends { stops?: { because?: string; fetaNote?: string }[]; options?: { stops: { because?: string; fetaNote?: string }[] }[] }>(payload: T): T {
  const clean = <S extends { because?: string; fetaNote?: string }>(stop: S): S => {
    const out = { ...stop };
    if (out.because && saysDiet(out.because)) delete out.because;
    if (out.fetaNote && saysDiet(out.fetaNote)) delete out.fetaNote;
    return out;
  };
  return {
    ...payload,
    ...(payload.stops ? { stops: payload.stops.map(clean) } : {}),
    ...(payload.options ? { options: payload.options.map((o) => ({ ...o, stops: o.stops.map(clean) })) } : {}),
  };
}
