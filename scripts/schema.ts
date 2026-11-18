// What the database should have, read from supabase/migrations: every
// function, table and added column, with the migration that makes it.
// Admin compares this with the live database (schema_objects()) and names
// any migration that never ran (founder, 18 Nov 2026: the Feta Favourites
// migration was skipped and three days of "recommend" silently failed).
//
//   npm run schema   (npm run eval fails until lib/schema-expected.json is current)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Expected = { kind: "function" | "table" | "column"; name: string; file: string };

const DIR = "supabase/migrations";
export const OUT = "lib/schema-expected.json";

export function expectedSchema(): Expected[] {
  const seen = new Map<string, Expected>();
  const add = (kind: Expected["kind"], name: string, file: string) => {
    if (!seen.has(`${kind}:${name}`)) seen.set(`${kind}:${name}`, { kind, name, file });
  };
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(DIR, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)/gi)) add("function", m[1], file);
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/gi)) add("table", m[1], file);
    for (const m of sql.matchAll(/alter table (?:if exists )?public\.([a-z_0-9]+)([^;]*);/gi)) {
      for (const c of m[2].matchAll(/add column (?:if not exists )?([a-z_0-9]+)/gi)) add("column", `${m[1]}.${c[1]}`, file);
    }
  }
  return [...seen.values()];
}

export const schemaJson = () => `${JSON.stringify(expectedSchema(), null, 1)}\n`;

if (process.argv[1]?.endsWith("schema.ts")) {
  writeFileSync(OUT, schemaJson());
  console.log(`${OUT}: ${expectedSchema().length} things the database should have.`);
}
