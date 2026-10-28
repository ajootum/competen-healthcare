/**
 * HQ-USERS-C -- STATIC HARNESS: the HQ user directory reads access, never content.
 *
 *   npx tsx scripts/hq-users-directory-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED.
 *   D1  the page is requireHqCapability("hq.platform.users.view") before anything else
 *   D2  the directory loader reads only the access tables it names, writes nothing, and touches no
 *       patient, clinical or Individual record table (practice_* columns are pinned by plane-boundary-harness)
 *   D3  an HQ seat comes only from an hq_* office -- a tenant office appointment is not an HQ position
 *   D4  every one of the five sources can say "Not readable" in the drawer, and the page warns when one did
 *   D5  the page reads every Auth page through listAllAuthUsers, not a single page of 1000
 *   D6  HQ-USERS-CLASSIFY-01: the rows are built in load-directory.ts (shared with the CSV export). It reads the
 *       account type for display and writes nothing, and the page still gates before calling it
 */
import { readFileSync, existsSync } from "node:fs";

const F = {
  lib: "src/lib/hq/user-directory.ts",
  page: "src/app/super-admin/users/page.tsx",
  ws: "src/app/super-admin/users/UsersWorkspace.tsx",
  loader: "src/app/super-admin/users/load-directory.ts",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const code = (src: Src, k: K) => strip(src.get(F[k]) ?? "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };

const READS = new Set(["platform_membership", "enterprise_membership", "tenants", "practice_membership", "practice_workspace",
  "individual_membership", "individual_live_entitlement", "ogs_office_appointments", "ogs_offices", "hq_position"]);
const FORBIDDEN = /practice_patient|practice_note|practice_appointment|practice_clinical|clinical_|individual_professional_|individual_scholar_|consent|ai_requests|plat_ai/;

const checkPageGate = (src: Src): R => {
  const s = code(src, "page");
  const body = s.slice(s.indexOf("export default async function"));
  const gateAt = body.indexOf(`await requireHqCapability("hq.platform.users.view")`);
  const before = body.slice(0, gateAt);
  // Only the session read may precede the gate (it redirects to /login); no data read may.
  const dataBefore = /admin\.from\(|loadDirectoryAccess|listAllAuthUsers|loadDirectory\(/.test(before);
  return { ok: gateAt > -1 && !dataBefore, detail: `gate at ${gateAt}, data read before it ${dataBefore}` };
};
const checkReads = (src: Src): R => {
  const s = code(src, "lib");
  const tables = [...s.matchAll(/\.from\("([a-z_]+)"\)/g)].map(m => m[1]);
  const extra = tables.filter(t => !READS.has(t));
  const writes = /\.(insert|update|upsert|delete)\(/.test(s);
  const forbidden = FORBIDDEN.test(s);
  return { ok: tables.length >= 10 && extra.length === 0 && !writes && !forbidden, detail: `unexpected tables ${extra.join(",")}, writes ${writes}, forbidden ${forbidden}` };
};
const checkHqOffices = (src: Src): R => {
  const s = code(src, "lib");
  return { ok: /from\("ogs_offices"\)\.select\("id"\)\.like\("office_type", "hq_%"\)/.test(s) && /if \(!a\.person_id \|\| !a\.role \|\| !hqOffice\.has\(a\.office_id\)\) continue;/.test(s), detail: "HQ seats must be filtered to hq_* offices" };
};
const checkUnreadable = (src: Src): R => {
  const ws = code(src, "ws");
  const all = ["platform", "enterprise", "practice", "individual", "hq"].every(k => ws.includes(`!readable.${k} ? "Not readable"`));
  const banner = /\(!authComplete \|\| Object\.values\(readable\)\.some\(v => !v\)\) && \(/.test(ws);
  return { ok: all && banner, detail: `all five sources ${all}, banner ${banner}` };
};
// HQ-USERS-CLASSIFY-01: the reads moved to load-directory.ts, so the Auth read is pinned there and the page must
// still pass completeness through.
const checkPaging = (src: Src): R => {
  const l = code(src, "loader"), p = code(src, "page");
  return { ok: /listAllAuthUsers\(admin\)/.test(l) && !/listUsers\(\{ page: 1, perPage: 1000 \}\)/.test(l + p) && /authComplete: authList\.complete/.test(l) && /authComplete=\{dir\.authComplete\}/.test(p), detail: "every Auth page, and completeness passed to the screen" };
};
const checkLoader = (src: Src): R => {
  const l = code(src, "loader");
  const writes = /\.(insert|update|upsert|delete|rpc)\(|\.auth\.admin\.(update|delete|create|invite)/.test(l);
  const classes = /loadClassifications\(admin\)/.test(l) && /accountType: typeOf\(classes, p\.id\)/.test(l);
  // Exactly the reads page.tsx always made (status columns of clinical_authorizations, decision outcomes),
  // moved here unchanged. A new table is a new read and fails until it is named.
  const LOADER_READS = new Set(["profiles", "hospitals", "organisations", "departments", "competency_decisions", "clinical_authorizations"]);
  const extra = [...l.matchAll(/\.from\("([a-z_]+)"\)/g)].map(m => m[1]).filter(t => !LOADER_READS.has(t));
  return { ok: !writes && classes && extra.length === 0, detail: `writes ${writes}, reads the type for display ${classes}, unexpected tables ${extra.join(",")}` };
};

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");

console.log("HQ USERS DIRECTORY HARNESS (HQ-USERS-C)\n");
const missing = Object.values(F).filter(f => !RAW.get(f));
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
const run = (n: string, r: R) => ok(n, r.ok, r.detail);
run("D1. the page is gated by hq.platform.users.view before any data read", checkPageGate(RAW));
run("D2. the loader reads only access tables, writes nothing, and no patient / clinical / record table", checkReads(RAW));
run("D3. an HQ seat comes only from an hq_* office", checkHqOffices(RAW));
run("D4. every source can say Not readable, and the page warns", checkUnreadable(RAW));
run("D5. every Auth page is read", checkPaging(RAW));
run("D6. the shared loader reads the account type for display and writes nothing", checkLoader(RAW));
console.log("");
red("D1 on a data read before the gate", checkPageGate(plant("page", `  const { admin, isOwner, capabilities } = await requireHqCapability("hq.platform.users.view");`, `  await loadDirectoryAccess(null);\n  const { admin, isOwner, capabilities } = await requireHqCapability("hq.platform.users.view");`)));
red("D2 on a patient table", checkReads(plant("lib", `rows(admin.from("hq_position").select("code, name").limit(500)),`, `rows(admin.from("hq_position").select("code, name").limit(500)),\n    rows(admin.from("practice_patient").select("id")),`)));
red("D2 on Individual record content", checkReads(plant("lib", `rows(admin.from("hq_position").select("code, name").limit(500)),`, `rows(admin.from("hq_position").select("code, name").limit(500)),\n    rows(admin.from("individual_professional_cpd").select("id")),`)));
red("D2 on a write", checkReads(plant("lib", `const rows = async (p: Promise<any>) =>`, `const w = (admin: any) => admin.from("tenants").update({});\nconst rows = async (p: Promise<any>) =>`)));
red("D3 on tenant offices counted as HQ", checkHqOffices(plant("lib", `.like("office_type", "hq_%")`, "")));
red("D4 on an unreadable source shown as none", checkUnreadable(plant("ws", `!readable.practice ? "Not readable" : `, "")));
red("D5 on the first page only", checkPaging(plant("loader", "listAllAuthUsers(admin),", "admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),")));
red("D1 on the loader called before the gate", checkPageGate(plant("page", `  const { admin, isOwner, capabilities } = await requireHqCapability("hq.platform.users.view");`, `  await loadDirectory(null);\n  const { admin, isOwner, capabilities } = await requireHqCapability("hq.platform.users.view");`)));
red("D6 on a loader that reads a patient table", checkLoader(plant("loader", `admin.from("hospitals").select("id, name, country"),`, `admin.from("hospitals").select("id, name, country"),
    admin.from("practice_patient").select("id"),`)));
red("D6 on a loader that writes", checkLoader(plant("loader", "  const defaultView = await loadDefaultView(admin, classes.available);", "  const defaultView = await loadDefaultView(admin, classes.available);\n  await admin.from(\"hq_account_classification\").upsert({});")));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
