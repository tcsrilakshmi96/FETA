// Reads database changes exactly as Postgres would, before they go on the
// founder's clipboard (24 Nov 2026: a share check with a pattern Postgres
// refuses stopped WhatsApp sharing, and a migration with one bracket too
// many failed in the SQL Editor). Checks every statement, and the code
// inside each plpgsql function. Runs on this computer only, ₹0.
// npm run sql-check            every migration
// npm run sql-check -- <file>  one
import { readdirSync, readFileSync } from "node:fs";
import * as pg from "libpg-query";

if (pg.loadModule) await pg.loadModule();
const dir = "supabase/migrations";
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => `${dir}/${f}`);
// Postgres regex repetition counts stop at 255 (the WhatsApp bug): looked
// for inside string literals only, never in comments.
const REPEAT = /\{(\d+)(?:,(\d*))?\}/g;
const literals = (sql) => sql.replace(/--[^\n]*/g, "").match(/'(?:[^']|'')*'/g) ?? [];
let bad = 0;
for (const file of files) {
  const bytes = readFileSync(file);
  const sql = bytes.toString("utf8");
  const problems = [];
  try {
    const tree = await pg.parse(sql);
    for (const { stmt, stmt_location = 0, stmt_len } of tree.stmts) {
      // Postgres counts bytes, not letters ("–", "₹" are several).
      const text = bytes.subarray(stmt_location, stmt_len ? stmt_location + stmt_len : undefined).toString("utf8");
      if (stmt.CreateFunctionStmt && /language\s+plpgsql/i.test(text)) {
        try {
          await pg.parsePlPgSQL(text);
        } catch (e) {
          const name = /function\s+([\w.]+)/i.exec(text)?.[1] ?? "a function";
          problems.push(`${name}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    const line = e.cursorPosition ? bytes.subarray(0, e.cursorPosition).toString("utf8").split("\n").length : null;
    problems.push(`${e.message}${line ? ` (line ${line})` : ""}`);
  }
  for (const lit of literals(sql)) for (const m of lit.matchAll(REPEAT)) if (Number(m[1]) > 255 || Number(m[2] || 0) > 255) problems.push(`a pattern repeats more than 255 times: ${lit.slice(0, 60)}`);
  if (problems.length) {
    bad++;
    console.log(`✗ ${file}\n  ${problems.join("\n  ")}`);
  }
}
console.log(bad ? `\n${bad} file(s) Postgres would refuse.` : `✓ ${files.length} migration file(s) read as Postgres would: no errors.`);
process.exit(bad ? 1 : 0);
