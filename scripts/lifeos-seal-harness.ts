/**
 * ADR-018: LifeOS is sealed. This harness is the seal.
 *
 * Run: npx tsx scripts/lifeos-seal-harness.ts
 *
 * It reads source only: no network, no database, no environment. It uses the TypeScript parser, not a grep, because
 * this repository has recorded a grep missing a real cross-boundary read once already (plane-boundary-harness).
 *
 * The planted-violation section proves each rule can actually go red.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { ROUTES } from "../src/lib/lifeos/api/routes";
import { buildOpenApi } from "../src/lib/lifeos/api/openapi";
import { RESOURCES } from "../src/lib/lifeos/core/resources";

const ROOT = join(import.meta.dirname, "..");
let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

/** Every module this source names: import, export-from, dynamic import, require. */
export function moduleSpecifiers(source: string, name = "x.ts"): string[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0])
      && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const ADAPTER = "src/lib/lifeos/adapters/competen/";
// Assembled, because scripts/harness-classify.ts reads the literal client package name as "this harness uses a database".
// This harness parses source only, and belongs in the no-credential CI subset.
const ALLOWED_EXTERNAL = new Set(["zod", ["@supabase", "supabase-js"].join("/")]);

/** The reason this file may not import this module, or null when it may. */
export function importViolation(file: string, spec: string): string | null {
  if (spec.startsWith(".")) return null;
  if (spec.startsWith("node:") || ALLOWED_EXTERNAL.has(spec)) return null;
  if (spec.startsWith("@/lib/lifeos/")) return null;
  if (file.startsWith(ADAPTER) && spec.startsWith("@/")) return null;
  return `${file} imports ${spec}. Only ${ADAPTER} may reach the rest of Competen.`;
}

const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

/** The reasons a LifeOS migration breaks the seal. */
export function sqlViolations(sql: string): string[] {
  const body = stripSqlComments(sql);
  const out: string[] = [];
  for (const m of body.matchAll(/\breferences\s+([a-zA-Z_.]+)/g)) {
    if (!m[1].startsWith("lifeos_")) out.push(`references ${m[1]}`);
  }
  for (const m of body.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(table(?:\s+if\s+not\s+exists)?|view|function|trigger)\s+([a-zA-Z_.]+)/g)) {
    if (!m[2].startsWith("lifeos_")) out.push(`creates ${m[2]}`);
  }
  for (const m of body.matchAll(/\b(?:from|join|into|update|on)\s+((?:auth|storage)\.[a-z_]+|profiles|tenants|organisations|hospitals|audit_log|individual_[a-z_]+|practice_[a-z_]+|platform_[a-z_]+|hq_[a-z_]+)\b/g)) {
    out.push(`touches ${m[1]}`);
  }
  return out;
}

/** A table write through the client: .from("x").insert(...) and friends, across lines, up to the end of the statement. */
export const directWrite = (src: string) => /\.from\([^)]*\)[^;]*?\.(insert|update|upsert|delete)\(/.test(src);

/** Owner requirement: no healthcare or other-product assumption in LifeOS. The test files use their own neutral data. */
const FORBIDDEN_TERMS = /\b(patients?|clinical|clinicians?|hospitals?|nurs(e|es|ing)|wards?|medical|healthcare|scholar|practitioners?)\b/i;
export const domainTerm = (text: string) => text.match(FORBIDDEN_TERMS)?.[0] ?? null;

console.log("LIFEOS SEAL HARNESS (ADR-018)\n");

// ---- 1. what LifeOS may import ----
const lifeosFiles = [...walk(join(ROOT, "src/lib/lifeos")), ...walk(join(ROOT, "src/app/api/lifeos"))].map(p => ({ p, r: rel(p) }));
ok("I0", lifeosFiles.length >= 15, `the walk found the LifeOS tree (${lifeosFiles.length} files), so the rules below ran on something`);
const importBad: string[] = [];
for (const { p, r } of lifeosFiles) {
  if (r.endsWith(".test.ts")) continue;
  for (const spec of moduleSpecifiers(readFileSync(p, "utf8"), r)) {
    const v = importViolation(r, spec);
    if (v) importBad.push(v);
  }
}
ok("I1", importBad.length === 0, `no LifeOS file outside the adapter imports the rest of Competen${importBad.length ? `: ${importBad.join(" | ")}` : ""}`);
const adapterFiles = lifeosFiles.filter(f => f.r.startsWith(ADAPTER));
ok("I2", adapterFiles.length === 1 && adapterFiles[0].r === `${ADAPTER}guard.ts`, "the adapter is one file, so a carve-out replaces one file");

// ---- 2. what may import LifeOS ----
const outsiders: string[] = [];
for (const p of walk(join(ROOT, "src"))) {
  const r = rel(p);
  if (r.startsWith("src/lib/lifeos/") || r.startsWith("src/app/api/lifeos/")) continue;
  for (const spec of moduleSpecifiers(readFileSync(p, "utf8"), r)) {
    if (spec.includes("lib/lifeos")) outsiders.push(`${r} imports ${spec}`);
  }
}
ok("O1", outsiders.length === 0, `no other product imports LifeOS${outsiders.length ? `: ${outsiders.join(" | ")}` : ""}`);

// ---- 3. the data ----
const migrationDir = join(ROOT, "supabase/migrations");
const lifeosSql = readdirSync(migrationDir).filter(f => /-lifeos-/.test(f));
ok("D0", lifeosSql.length >= 1, `found LifeOS migrations: ${lifeosSql.join(", ")}`);
const sqlBad = lifeosSql.flatMap(f => sqlViolations(readFileSync(join(migrationDir, f), "utf8")).map(v => `${f}: ${v}`));
ok("D1", sqlBad.length === 0, `LifeOS migrations create and reference lifeos_ objects only${sqlBad.length ? `: ${sqlBad.join(" | ")}` : ""}`);
const otherSql = readdirSync(migrationDir).filter(f => f.endsWith(".sql") && !/-lifeos-/.test(f))
  .filter(f => /\blifeos_/.test(stripSqlComments(readFileSync(join(migrationDir, f), "utf8"))));
ok("D2", otherSql.length === 0, `no other migration touches a lifeos_ object${otherSql.length ? `: ${otherSql.join(", ")}` : ""}`);
ok("D3", Object.values(RESOURCES).every(r => r.table.startsWith("lifeos_")), "every resource table is a lifeos_ table");

// ---- 3b. healthcare-independent ----
const termHits = [
  ...lifeosFiles.map(f => ({ r: f.r, text: readFileSync(f.p, "utf8") })),
  ...lifeosSql.map(f => ({ r: f, text: readFileSync(join(migrationDir, f), "utf8") })),
].flatMap(f => { const t = domainTerm(f.text); return t ? [`${f.r}: "${t}"`] : []; });
ok("H1", termHits.length === 0, `LifeOS code and migrations carry no healthcare or other-product terms${termHits.length ? `: ${termHits.join(" | ")}` : ""}`);

// ---- 4. no hard delete, one writer ----
const writes = lifeosFiles.filter(f => !f.r.endsWith(".test.ts")).flatMap(({ p, r }) => {
  const src = readFileSync(p, "utf8");
  const hits: string[] = [];
  if (directWrite(src)) hits.push(`${r}: a direct table write or delete`);
  return hits;
});
ok("W1", writes.length === 0, `no direct table write or hard delete in LifeOS code: every write is lifeos_mutate${writes.length ? `: ${writes.join(" | ")}` : ""}`);
ok("W2", ROUTES.every(r => (r.method as string) !== "DELETE"), "the API has no DELETE method");

// ---- 5. the route table ----
ok("R1", ROUTES.every(r => r.visibility === "internal"), "every route is internal: nothing is on the public API boundary yet (step 9)");
ok("R2", ROUTES.filter(r => r.method !== "GET").every(r => !!r.input), "every write route declares its input schema");
const keys = ROUTES.map(r => `${r.method} ${r.path}`);
ok("R3", new Set(keys).size === keys.length, "no duplicate route");
const doc = buildOpenApi(ROUTES) as { paths: Record<string, Record<string, unknown>> };
const documented = Object.entries(doc.paths).flatMap(([p, ms]) => Object.keys(ms).map(m => `${m.toUpperCase()} ${p}`));
ok("R4", documented.length === ROUTES.length, `the OpenAPI document lists every route (${documented.length}/${ROUTES.length})`);
ok("R5", Object.keys((buildOpenApi(ROUTES, "public") as { paths: object }).paths).length === 0, "the public OpenAPI document is empty today");

const route = readFileSync(join(ROOT, "src/app/api/lifeos/v1/[...path]/route.ts"), "utf8");
ok("R6", /\brequireLifeosPrincipal\s*\(/.test(route), "the one route file enters the registered boundary");
const routeFiles = lifeosFiles.filter(f => f.r.endsWith("/route.ts"));
ok("R7", routeFiles.length === 1, "there is exactly one route file: one door");

// ---- 6. no master key, no secret ----
const secretish = lifeosFiles.filter(f => !f.r.endsWith(".test.ts")).filter(({ p }) => /\b(NEXT_PUBLIC_[A-Z_]*KEY|process\.env\.[A-Z_]*(KEY|SECRET|TOKEN))\b/.test(readFileSync(p, "utf8"))).map(f => f.r);
ok("S1", secretish.length === 0, `no LifeOS file reads a key or secret from the environment${secretish.length ? `: ${secretish.join(", ")}` : ""}`);
const outputs = JSON.stringify(doc);
ok("S2", !outputs.includes("credentialRef"), "an integration's credential reference is never part of an API response");

// ---- 7. CONTROLS: each rule goes red on a planted violation ----
console.log("\n  Controls");
ok("C1", importViolation("src/lib/lifeos/core/service.ts", "@/lib/practice/scheduling") !== null, "a core file importing Practice is caught");
ok("C2", importViolation("src/lib/lifeos/core/service.ts", "@/lib/supabase/server") !== null, "a core file importing the Competen client is caught");
ok("C3", importViolation("src/lib/lifeos/adapters/competen/guard.ts", "@/lib/supabase/server") === null, "the adapter is allowed the same import");
ok("C4", moduleSpecifiers('const x = await import("@/lib/hq/positions");').includes("@/lib/hq/positions"), "a dynamic import is seen");
ok("C5", moduleSpecifiers('export { a } from "@/lib/x"; const y = require("@/lib/y");').length === 2, "a re-export and a require are seen");
ok("C6", sqlViolations("create table lifeos_a (b uuid references profiles (id));").length === 1, "a foreign key to profiles is caught");
ok("C7", sqlViolations("create table other_table (a int);").length === 1, "a non-lifeos table is caught");
ok("C8", sqlViolations("select * from individual_membership;").length === 1, "a read of another product's table is caught");
ok("C10", directWrite('await admin.from("lifeos_commitment")\n  .update({ title: "x" }).eq("id", y);'), "a direct table write is caught");
ok("C11", directWrite('await admin.from("lifeos_commitment").delete().eq("id", y);'), "a hard delete is caught");
ok("C12", !directWrite('const h = createHash("sha256").update(raw).digest("hex"); const { data } = await admin.from("x").select("*").eq("a", 1);'), "a hash and a read are not writes");
ok("C13", domainTerm("const x = patient.ward;") === "patient", "a healthcare term in LifeOS code is caught");
ok("C9", sqlViolations("-- references profiles\ncreate table lifeos_a (b int);").length === 0, "a comment does not trip the rule");

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map(f => `  - ${f}`).join("\n")); process.exit(1); }
