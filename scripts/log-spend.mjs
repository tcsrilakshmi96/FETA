// Logs spend from work run outside the app (founder, 24 Nov 2026: the ₹300
// Style library made from Claude's machine never reached the cost log).
// Every paid script Claude runs ends with this, so Admin → Costs and the
// month's bills include it (route 'script', never in anyone's daily pool).
//   node --env-file=.env.local scripts/log-spend.mjs <sku> <units> <rupees> [label]
//   e.g. scripts/log-spend.mjs gemini_image 72 300 "Style library pictures"
const [sku, units, inr, label = "script"] = process.argv.slice(2);
const { NEXT_PUBLIC_SUPABASE_URL: DB, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY, FETA_WRITE_KEY } = process.env;
const RK = FETA_WRITE_KEY;
if (!sku || !Number(units) || !(Number(inr) >= 0)) {
  console.error("Usage: log-spend.mjs <sku> <units> <rupees> [label]");
  process.exit(1);
}
// Rows are capped at 100 units and ₹500 each, so a big run is split evenly
// into as many rows as either needs (audit, 24 Nov 2026: rupees over ₹500 in
// one row were dropped).
const parts = Math.max(Math.ceil(Number(units) / 100), Math.ceil(Number(inr) / 500), 1);
const rows = Array.from({ length: parts }, (_, i) => ({
  route: "script",
  sku,
  units: Math.max(1, Math.floor(Number(units) / parts) + (i < Number(units) % parts ? 1 : 0)),
  est_inr: Math.floor((Number(inr) / parts) * 100) / 100,
}));
const res = await fetch(`${DB}/rest/v1/rpc/log_costs`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_key: RK, p_costs: rows, p_hit: { route: "script", label: label.slice(0, 80), cost_inr: Number(inr), services: { [sku]: Number(units) } } }),
});
console.log(res.ok ? `Logged ₹${inr} (${units} × ${sku}): ${label}` : `Not logged: ${res.status} ${await res.text()}`);
