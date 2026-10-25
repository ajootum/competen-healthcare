/**
 * COMPETEN LEARNING HARNESS -- the ADR-017 boundaries of COMPETEN-LEARNING-01, checked from source.
 *
 *   npx --yes tsx scripts/learning-harness.ts
 *
 * Files only: no client, no network, no .env.local. Every rule carries a planted-failure control run in memory, so a
 * rule that has gone vacuous goes RED rather than green (this repository has recorded a needle matching its own
 * documentation eight times, so every content needle runs on comment-stripped source).
 *
 *   L1  no Learning file touches an estate learning table (ADR-016 D1): the Holdings content and record only
 *   L2  Learning writes only Learning tables, the course ledger and the shared checkout -- never an experience
 *       entitlement, a membership, a plan, or a Professional or Scholar table (no duplicate CPD or evidence)
 *   L3  no estate analytics or operations module reads the personal learning record (D1, ADR-017 s2)
 *   L4  every Learner API handler is gate 3 first, then the Learning switch, then the body
 *   L5  the HQ route fixes one capability per action, the five authorities are distinct, and a grant refuses self
 *   L6  the shared webhook routes `lrn-` only behind learning_commerce, and keeps the experience dispatch literal
 *   L7  migrations 460-464 write no flag, appoint nobody, and grant only to the four new Learning positions
 *   L8  no price is hard-coded, and course settlement never creates a membership (D5, D7)
 *   L9  the learner never receives the answer key: every learner-facing loader goes through learnerView
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const posix = (p: string) => p.replace(/\\/g, "/");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(posix(p));
  }
  return out;
}
/** Comments out, strings kept -- a needle may legitimately be a table name inside a string. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const read = (f: string) => (existsSync(f) ? strip(readFileSync(f, "utf8")) : "");

const LEARNING = [...walk("src/lib/learning"), ...walk("src/app/super-admin/learning"), ...walk("src/app/individual/(app)/learning"),
  ...walk("src/app/api/hq/learning"), ...walk("src/app/api/individual/learning"), ...walk("src/app/learning")];
const SRC = new Map(LEARNING.map(f => [f, read(f)]));
const hits = (re: RegExp, files: Map<string, string> = SRC) => [...files].filter(([, s]) => re.test(s)).map(([f]) => f);

console.log("COMPETEN LEARNING HARNESS (ADR-017)\n");
ok("0a. the Learning source was found (service, studio, learner, APIs, verify)", ["src/lib/learning/record.ts", "src/lib/learning/studio.ts", "src/lib/learning/commerce.ts",
  "src/app/api/hq/learning/route.ts", "src/app/api/individual/learning/route.ts", "src/app/learning/verify/[code]/page.tsx"].every(f => SRC.has(f)));
ok("0b. the comment strip keeps code and removes comments", /from\("learning_record"\)/.test(SRC.get("src/lib/learning/record.ts") ?? "") && !/THE SERVER DECIDES COMPLETION/.test(SRC.get("src/lib/learning/record.ts") ?? "x THE SERVER DECIDES COMPLETION"));

// L1 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ESTATE = /from\("(courses|course_enrollments|learning_courses|learning_enrolments|learning_assignments|learning_resources|learning_pathways|pathway_items|lessons|lesson_progress|cpd_logs|quiz_attempts|curricula|curriculum_modules|cmo_certifications|professional_credentials)"\)/;
ok("L1. no Learning file reads or writes an estate learning table", hits(ESTATE).length === 0, hits(ESTATE).join(", "));
ok("L1c. control: the estate needle matches a planted read", ESTATE.test('admin.from("course_enrollments").select("*")'));

// L2 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const WRITE = /from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g;
const ALLOWED_WRITE = /^(learning_[a-z_]+|individual_course_entitlement|individual_checkout|audit_log)$/;
const writes = [...SRC].flatMap(([f, s]) => [...s.matchAll(WRITE)].map(m => ({ f, t: m[1] })));
const badWrites = writes.filter(w => !ALLOWED_WRITE.test(w.t));
ok("L2. Learning writes only learning_*, individual_course_entitlement, individual_checkout and audit_log", writes.length >= 10 && badWrites.length === 0, badWrites.map(w => `${w.f}: ${w.t}`).join("; "));
const checkoutWriters = [...new Set(writes.filter(w => w.t === "individual_checkout").map(w => w.f))];
ok("L2b. only the Learning commerce module writes individual_checkout", checkoutWriters.length === 1 && checkoutWriters[0] === "src/lib/learning/commerce.ts", checkoutWriters.join(", "));
ok("L2c. control: a planted Professional CPD write is caught", ![...'admin.from("individual_professional_cpd").insert({})'.matchAll(WRITE)].every(m => ALLOWED_WRITE.test(m[1])));

// L3 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ESTATE_READERS = ["src/lib/learning-analytics.ts", "src/lib/learning-intelligence.ts", "src/lib/curriculum-analytics.ts", "src/lib/learner-outcomes.ts",
  "src/lib/learning-centre.ts", "src/lib/hr-data.ts", "src/lib/activity-analytics.ts", "src/lib/competency-analytics.ts", ...walk("src/lib/operations"), ...walk("src/lib/analytics"),
  ...walk("src/app/dashboard"), ...walk("src/app/hospital-executive"), ...walk("src/app/unit-manager"), ...walk("src/app/educator")].filter(f => existsSync(f));
const PERSONAL = /from\("(learning_record|learning_record_activity|learning_check_attempt|learning_certificate|individual_course_entitlement|individual_live_course_entitlement)"\)/;
const leak = ESTATE_READERS.filter(f => PERSONAL.test(read(f)));
ok(`L3. none of ${ESTATE_READERS.length} estate analytics, operations and workspace files reads the personal learning record`, ESTATE_READERS.length >= 20 && leak.length === 0, leak.join(", "));
ok("L3c. control: the personal needle matches a planted read", PERSONAL.test('admin.from("learning_record").select("id")'));

// L4 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const before = (s: string, a: string, b: string) => s.indexOf(a) >= 0 && s.indexOf(b) > s.indexOf(a);
const learnerRoutes = [...SRC.keys()].filter(f => f.startsWith("src/app/api/individual/learning/") && f.endsWith("route.ts"));
const learnerBad = learnerRoutes.filter(f => {
  const s = SRC.get(f) ?? "";
  const gate = /learningCommerceEnabled\(ctx\.admin\)/.test(s) ? "learningCommerceEnabled(ctx.admin)" : "learningEnabled(ctx.admin)";
  const body = s.includes("req.json()") ? "req.json()" : s.includes("req.formData()") ? "req.formData()" : "new URL(req.url)";
  return !(before(s, "requireIndividualContext()", gate) && before(s, gate, body));
});
ok(`L4. all ${learnerRoutes.length} learner API routes check gate 3, then the Learning switch, then read the request`, learnerRoutes.length >= 4 && learnerBad.length === 0, learnerBad.join(", "));
ok("L4c. control: a route reading the body before the switch is caught", !before('requireIndividualContext(); req.json(); learningEnabled(ctx.admin)', "learningEnabled(ctx.admin)", "req.json()"));

// L5 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const hq = SRC.get("src/app/api/hq/learning/route.ts") ?? "";
const lists = Object.fromEntries([...hq.matchAll(/const (AUTHOR|PUBLISH|PRICE|CERT|GRANT) = \[([^\]]*)\] as const;/g)].map(m => [m[1], [...m[2].matchAll(/"([a-z_]+)"/g)].map(x => x[1])]));
const actions = Object.values(lists).flat();
const caps = [...hq.matchAll(/\[(AUTHOR|PUBLISH|PRICE|CERT|GRANT), "([a-z.]+)"\]/g)].map(m => m[2]);
ok("L5a. five action lists, disjoint, each bound to its own capability", Object.keys(lists).length === 5 && new Set(actions).size === actions.length && caps.length === 5 && new Set(caps).size === 5
  && caps.includes("hq.learning.course.author") && caps.includes("hq.learning.course.publish") && caps.includes("hq.learning.price.approve") && caps.includes("hq.learning.certificate.issue") && caps.includes("hq.individual.pilot.grant"), JSON.stringify({ lists, caps }));
ok("L5b. the route gates on the capability before the Learning switch, and a course grant refuses acting on yourself",
  before(hq, "hqApiGate([capability])", "learningEnabled(ctx.admin)") && /case "grant_access": if \(str\(body\.userId, 40\) === me\) return refuse\(403/.test(hq));
ok("L5c. clinical approval is not an action here (it stays the 395 route)", !actions.some(a => /approve_content|review|decide_review/.test(a)) && !/clinical_review_decision/.test(hq));

// L6 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const hook = read("src/app/api/v1/practice/billing/webhook/flutterwave/route.ts");
ok("L6. the webhook routes lrn- only behind learning_commerce, and keeps the experience dispatch exactly", /const learning = !individual && isLearningTxRef\(txRef\) && \(await learningCommerceEnabled\(admin\)\)/.test(hook)
  && /individual \? await applyIndividualWebhook\(admin, cfg, ev\) : await applyWebhook\(admin, cfg, ev\)/.test(hook) && /learning \? await applyLearningWebhook\(admin, cfg, ev\)/.test(hook));
const lc = SRC.get("src/lib/learning/commerce.ts") ?? "";
ok("L6b. the course adapter uses the shared engine and tables, and its own prefix", /settleWebhook\(admin, cfg, ev, LEARNING_SETTLEMENT\)/.test(lc) && /eventTable: "individual_checkout_event"/.test(lc) && /checkoutTable: "individual_checkout"/.test(lc) && /LEARNING_TX_PREFIX = "lrn"/.test(lc));

// L7 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const sqlStrip = (s: string) => s.split(/\r?\n/).map(l => { const at = l.indexOf("--"); return at >= 0 && ((l.slice(0, at).match(/'/g) ?? []).length) % 2 === 0 ? l.slice(0, at) : l; }).join("\n");
const MIGS = readdirSync("supabase/migrations").filter(f => /^46[0-4]-/.test(f)).map(f => `supabase/migrations/${f}`);
const migSql = MIGS.map(f => sqlStrip(readFileSync(f, "utf8"))).join("\n");
const grantTargets = [...migSql.matchAll(/from \(values \('([a-z_]+)'\)\) as p\(code\)/g)].map(m => m[1]);
if (MIGS.length === 0) console.log("  PEND  L7. migrations 460-464 are not in this tree yet (authored locally until staging-verified)");
else {
  ok("L7. 460-464 write no flag, appoint nobody, and grant only to the four new Learning positions", !/practice_platform_flags/.test(migSql) && !/insert into ogs_office_appointments/i.test(migSql)
    && grantTargets.length === 4 && grantTargets.every(p => /^learning_(course_author|publisher|price_approver|certificate_issuer)$/.test(p)), JSON.stringify(grantTargets));
  const tables = [...migSql.matchAll(/create table if not exists ([a-z_]+) \(([\s\S]*?)\n\);/g)];
  ok(`L7b. none of the ${tables.length} tables 460-464 create carries hospital_id`, tables.length === 11 && tables.every(t => !/hospital_id/.test(t[2])), tables.map(t => t[1]).join(", "));
}

// L8 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PRICE = /(amount\w*|price\w*)\s*[:=]\s*[0-9]{3,}|"(UGX|KES|TZS|RWF)"/i;
ok("L8. no price is hard-coded in Learning code (prices are approved data, D7)", hits(PRICE).length === 0, hits(PRICE).join(", "));
ok("L8b. course settlement and checkout never create a membership (purchase registration is off, D5)", !/from\("individual_membership"\)\s*\.(insert|upsert)/.test(lc) && /membership is \$\{m\?\.status \?\? "absent"\}/.test(lc));
ok("L8c. control: the price needle matches a planted price and a planted currency default", PRICE.test("const priceMajor = 25000;") && PRICE.test("useState({ currency: \"UGX\" })"));

// L9 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const cat = SRC.get("src/lib/learning/catalogue.ts") ?? "", rec = SRC.get("src/lib/learning/record.ts") ?? "";
ok("L9. the learner's course content always passes through learnerView (no answer key reaches a browser)",
  /content = learnerView\(normaliseBlueprint\(/.test(cat) && /content: learnerView\(ver\.content\)/.test(rec)
  && ![...SRC.keys()].some(f => f.startsWith("src/app/individual/") && (/normaliseBlueprint|scoreCheck/.test(SRC.get(f) ?? "") || /\.correct\.(includes|map|length|some|every)/.test(SRC.get(f) ?? ""))));
ok("L9c. control: a planted key read is caught", /\.correct\.(includes|map|length|some|every)/.test("q.correct.includes(o.id)"));

console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed${failures.length ? `\n  FAILED: ${failures.join("; ")}` : ""}`);
if (failures.length) process.exitCode = 1;
