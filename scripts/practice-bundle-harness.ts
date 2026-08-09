/**
 * practice-bundle-harness — proves a server-only module has not leaked into a client bundle.
 *
 * ⚠ THIS EXISTS BECAUSE 120.7 kB GZIP RODE INTO FOUR CLINICAL SCREENS AND NOTHING NOTICED FOR A RELEASE.
 *
 * The chain, measured in docs/CP-PERF-SURVEY-001.md section 2.3: a client component imports a CONSTANT
 * from a module whose own first line imports `audit` from provisioning.ts, and provisioning.ts has exactly
 * one import line -- `node:crypto`. Turbopack therefore bundled a browserified Node crypto stack
 * (readable-stream, asn1.js, elliptic) into /practice/patients, /practice/encounters/[encounterId],
 * /practice/settings and /practice/activity: 120,706 bytes gzip, ~30% of the two heaviest clinical
 * screens, roughly 24 seconds of GPRS -- and NEVER EXECUTED.
 *
 * ⚠ IT PASSED tsc, eslint AND EVERY OTHER HARNESS, because nothing about it is a type error or a runtime
 * fault. It is only visible in the built output, which is the only place this looks.
 *
 * The survey asked for exactly this: "Would have caught the 120.7 kB crypto polyfill the day it arrived,
 * and will catch the next one."
 *
 *   npx next build && npx --yes tsx scripts/practice-bundle-harness.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep, basename } from "node:path";
import { gzipSync } from "node:zlib";

const NEXT = join(process.cwd(), ".next");

let pass = 0, fail = 0, pending = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fail++; failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};
const skip = (id: string, msg: string) => { pending++; console.log(`  PEND  ${id}  ${msg}`); };

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

console.log("\nPRACTICE CLIENT BUNDLE\n");

// ── 1. The source rule: audit.ts must import nothing ────────────────────────────────────────────
//
// This half needs no build, so it runs even on a clean checkout. It is also the half that actually
// PREVENTS the regression -- section 2 only detects it.
const auditSrc = readFileSync("src/lib/practice/audit.ts", "utf8");
const auditImports = auditSrc.split("\n").filter(l => /^\s*import\s/.test(l) || /\brequire\(/.test(l));
ok("A1", auditImports.length === 0,
  `src/lib/practice/audit.ts imports NOTHING${auditImports.length ? ` -- found: ${auditImports.join(" | ")}` : ""}`);

// ⚠ CONTROL: the file must actually be the audit module. A1 also passes for an empty or deleted file,
// and "it imports nothing" is trivially true of nothing.
ok("A2", /export async function audit\(/.test(auditSrc) && /practice_audit_event/.test(auditSrc),
  "control: it is the real audit module -- exports audit() and writes practice_audit_event");

// Nothing may import audit from provisioning again: that is the edge the leak travelled along.
// ⚠ Comments stripped first. plane-boundary.ts:223 QUOTES this exact import line inside a comment, and a
// naive scan reports it as a live import -- the commonest cause of a vacuous assertion in this codebase.
const offenders: string[] = [];
for (const f of walk(join(process.cwd(), "src")).filter(f => /\.tsx?$/.test(f))) {
  const code = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  if (/import\s*\{[^}]*\baudit\b[^}]*\}\s*from\s*["']@\/lib\/practice\/provisioning["']/.test(code))
    offenders.push(f.replace(process.cwd() + sep, ""));
}
ok("A3", offenders.length === 0,
  `no module imports audit from provisioning any more${offenders.length ? ` -- ${offenders.slice(0, 5).join(", ")}` : ""}`);

// ── 2. The built output ─────────────────────────────────────────────────────────────────────────
const chunkDir = join(NEXT, "static", "chunks");
if (!existsSync(chunkDir)) {
  skip("B1", "no build present -- run `npx next build` first");
  skip("B2", "no build present");
} else {
  const chunks = walk(chunkDir).filter(f => f.endsWith(".js"));
  // ⚠ COUNT CONTROL FIRST. A scan that reads no chunks finds no polyfill and reports a confident zero.
  ok("B0", chunks.length > 50,
    `count control: ${chunks.length} client chunks scanned`);

  // The fingerprint the survey identified: asn1.js, elliptic, and the cipher API. Two of three, so a
  // chunk that merely mentions one identifier is not accused.
  const FINGERPRINT = [/subjectPrivateKey/, /recoveryParam/, /createDecipheriv/];
  const carriers = chunks.filter(f => {
    const s = readFileSync(f, "utf8");
    return FINGERPRINT.filter(r => r.test(s)).length >= 2;
  });
  const detail = carriers.map(c => {
    const gz = gzipSync(readFileSync(c)).length;
    return `${basename(c)} (${gz} gzip)`;
  });
  ok("B1", carriers.length === 0,
    `no client chunk carries the Node crypto polyfill${carriers.length ? ` -- ${detail.join(", ")}` : ""}`);

  const manifests = walk(join(NEXT, "server", "app"))
    .filter(f => f.endsWith("page_client-reference-manifest.js"));
  ok("B2", manifests.length > 100,
    `count control: ${manifests.length} route manifests scanned -- a bad path here would clear B1 by reading nothing`);
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed, ${pending} pending`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
process.exit(fail === 0 ? 0 : 1);
