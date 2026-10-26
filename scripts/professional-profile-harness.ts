/**
 * PROFESSIONAL PROFILE HARNESS -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1 (registration, profile, identity).
 * Pure/local: reads source and migration 450, imports the pure rules. No database, no network.
 *
 *   S. Migration 450: RLS own-row SELECT only, no write policy, no default experience_code, no verified or
 *      scope column, the generated evidence class, append-only trails WITH the cascade path, a version that
 *      can supersede only its own person's record, and completion that needs the three required facts.
 *   F. The form: exactly three required facts, nothing that can never be asked at onboarding is configurable,
 *      every optional question skippable by default, and no country or profession hard-coded as the context.
 *   W. Writes: the history table is written by no code (the trigger writes it), no profile record is deleted,
 *      and every new handler is guarded for Professional.
 *   V. Verification: no state means verified, an unknown evidence class reads as self-declared.
 *   C. Catalogues: suggestions read only shared, active, published, allowlisted frameworks, and an empty
 *      allowlist suggests nothing.
 *   A. AI grounding: the no-invention rule, gated by the privacy policy, never a number or a document name.
 *   O. Fails open to the MVP: with 450 absent the home has no form and the profile page is the MVP page.
 *
 * Every check is proven able to fail: section P plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/professional-profile-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, POLICIES } from "../src/lib/individual/policy";
import { NEVER_AT_ONBOARDING, PROFILE_TABLES, RECORD_STATES, REQUIRED_FIELDS } from "../src/lib/individual/professional/profile-vocabulary";
import { itemState } from "../src/lib/individual/professional/profile-records";
import { profileContext } from "../src/lib/individual/professional/profile-ai";
import { deriveVerification } from "../src/lib/individual/professional/profile-verification";
import { dueOffset, itemEligible } from "../src/lib/individual/professional/reminders";
import { parseShareProfile } from "../src/lib/individual/professional/share-profile";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
type R = { ok: boolean; detail: string };

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const posix = (p: string) => p.replace(/\\/g, "/");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
type Sources = Map<string, string>;
const ALL: Sources = new Map(walk("src").map(posix).map(f => [f, strip(readFileSync(f, "utf8"))]));
const MIG_FILE = "supabase/migrations/450-individual-professional-profile-and-history.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : "";
const STORE = "src/lib/individual/professional/profile-store.ts";
const SUGGEST = "src/lib/individual/professional/catalogue-suggestions.ts";
const REG = "src/app/individual/_components/professional/registration.tsx";
const AI = "src/lib/individual/professional/profile-ai.ts";
const PAGE = "src/app/individual/(app)/[experience]/(professional)/registration/page.tsx";
const ROUTES = ["src/app/api/individual/professional/context/route.ts", "src/app/api/individual/professional/profile-items/route.ts", "src/app/api/individual/professional/verification/route.ts"];

// ── S. SCHEMA ──────────────────────────────────────────────────────────────────────────────────────────
const tableBlocks = (mig: string) => [...mig.matchAll(/create table if not exists (individual_professional_[a-z_]+) \(([\s\S]*?)\n\);/g)].map(m => ({ name: m[1], body: m[2] }));
const checkRls = (mig: string): R => {
  const bad = PROFILE_TABLES.filter(t => !mig.includes(`alter table ${t} enable row level security`)
    || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(mig));
  const writePolicy = /create policy [a-z_]+ on individual_professional_[a-z_]+\s+for (insert|update|delete|all)/.test(mig);
  const def = /experience_code text not null default/.test(mig);
  return { ok: bad.length === 0 && !writePolicy && !def, detail: `${bad.join(",")}${writePolicy ? " write-policy" : ""}${def ? " experience_code default" : ""}` };
};
const checkColumns = (mig: string): R => {
  const blocks = tableBlocks(mig);
  const bad = blocks.filter(t => /\b(verif[a-z_]*|hospital_id|organisation_id|tenant_id|workspace_id)\b/.test(t.body)).map(t => t.name);
  const added = [...mig.matchAll(/alter table individual_professional_profile add column if not exists ([a-z_]+)/g)].map(m => m[1]).filter(c => /verif|hospital|organisation_id|tenant|workspace/.test(c));
  return { ok: blocks.length === PROFILE_TABLES.length && bad.length === 0 && added.length === 0, detail: `${blocks.length} tables; ${[...bad, ...added].join(", ")}` };
};
const checkGenerated = (mig: string): R => {
  const n = (mig.match(/evidence_class text generated always as\s*\(case when document_path is null then 'self_declared' else 'source_linked' end\) stored/g) ?? []).length;
  const path = /document_path is null or document_path like user_id::text \|\| '\/%'/.test(mig);
  return { ok: n === 1 && path, detail: `generated=${n} owner-path=${path}` };
};
const checkAppendOnly = (mig: string): R => {
  const ctx = /before update on individual_professional_profile_context/.test(mig) && /if pg_trigger_depth\(\) > 1\s+and old\.effective_to is null and new\.effective_to is not null/.test(mig);
  const item = /before update on individual_professional_profile_item/.test(mig)
    && (mig.match(/and pg_trigger_depth\(\) > 1/g) ?? []).length >= 2
    && /old\.withdrawn_at is null and new\.withdrawn_at is not null and new\.withdrawn_reason is not null/.test(mig);
  const noDeleteTrigger = !/before (update or )?delete on individual_professional_profile_(context|item)/.test(mig);
  return { ok: ctx && item && noDeleteTrigger, detail: `context ${ctx}, items ${item}, delete stays allowed ${noDeleteTrigger}` };
};
const checkSupersede = (mig: string): R => {
  const fk = /foreign key \(supersedes_id, user_id\) references individual_professional_profile_item\(id, user_id\)/.test(mig);
  const fork = /create unique index if not exists ux_individual_professional_profile_item_supersedes\s+on individual_professional_profile_item\(supersedes_id\);/.test(mig);
  const same = /and section = new\.section\s+and superseded_at is null\s+and withdrawn_at is null;/.test(mig);
  return { ok: fk && fork && same, detail: `composite fk ${fk}, one successor ${fork}, same section and current ${same}` };
};
const checkCompletion = (mig: string): R => {
  const m = /add constraint individual_professional_profile_registration_complete check \(([\s\S]*?)\n\);/.exec(mig)?.[1] ?? "";
  const cols = ["self_declared_profession", "self_declared_practice_jurisdiction", "self_declared_professional_status"];
  const required = [...m.matchAll(/coalesce\(([a-z_]+), ''\)/g)].map(x => x[1]);
  return { ok: required.length === 3 && cols.every(c => required.includes(c)), detail: required.join(", ") || "constraint not found" };
};

// ── F. THE FORM ─────────────────────────────────────────────────────────────────────────────────────────
const checkRequired = (req: readonly string[]): R => ({ ok: JSON.stringify(req) === JSON.stringify(["profession", "jurisdiction", "status"]), detail: req.join(",") });
const checkNeverAsked = (policies: typeof POLICIES): R => {
  const seq = policies.find(p => p.key === "professional_registration_fields");
  const opts = seq && "options" in seq ? (seq.options as readonly { value: string; label: string }[]) : [];
  const bad = opts.filter(o => /registration number|licen[cs]e|employ|document|upload|qualification/i.test(`${o.value} ${o.label}`));
  return { ok: opts.length > 0 && bad.length === 0 && NEVER_AT_ONBOARDING.length === 4, detail: bad.map(b => b.label).join(", ") };
};
const checkSkippable = (p: typeof DEFAULT_POLICY.professionalProfile): R => ({ ok: p.registrationRequired.length === 0 && p.registrationFields.length > 0, detail: `required by default: ${p.registrationRequired.join(",")}` });
const checkNoHardcodedContext = (src: Sources): R => {
  const files = [...src].filter(([f]) => /profile-(form|store|records|vocabulary|ai)\.ts$|catalogue-suggestions\.ts$|professional\/(context|profile-items)\/route\.ts$|_components\/professional\/(registration|RegistrationWizard|ContextField|ItemForm|profile-sections)\.tsx$/.test(f));
  const bad = files.filter(([, s]) => /uganda|\bnurs(e|ing)\b|unmc/i.test(s)).map(([f]) => f);
  return { ok: files.length >= 10 && bad.length === 0, detail: `${files.length} files; ${bad.join(", ")}` };
};

// ── W. WRITES ───────────────────────────────────────────────────────────────────────────────────────────
const checkHistoryNotWritten = (src: Sources): R => {
  const bad = [...src].filter(([, s]) => /from\(\s*"individual_professional_profile_context"\s*\)\s*\.(insert|update|upsert|delete)\(/.test(s)).map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};
const checkNoItemDelete = (src: Sources): R => {
  const bad = [...src].filter(([, s]) => /from\(\s*"individual_professional_profile_item"\s*\)\s*\.(delete|upsert)\(/.test(s)).map(([f]) => f);
  const store = src.get(STORE) ?? "";
  const scoped = (store.match(/from\("individual_professional_profile_item"\)\s*\.update\([\s\S]*?\.eq\("user_id", userId\)/g) ?? []).length === 1;
  return { ok: bad.length === 0 && scoped, detail: `${bad.join(", ")} withdraw scoped to owner ${scoped}` };
};
// W4 (COMPETEN-INDIVIDUAL-PROFILE-HFE): the SHARED Profile & History route. The experience a record comes from is
// checked by the guard, never trusted; each experience adds only its own kinds; documents stay Professional's; the
// route writes nothing itself (450's writes stay in the store, W1).
const HUB_ROUTE = "src/app/api/individual/profile-items/route.ts";
const checkHubRoute = (src: Sources): R => {
  const s = src.get(HUB_ROUTE) ?? "";
  const post = s.slice(s.indexOf("export async function POST"), s.indexOf("export async function PATCH"));
  const patch = s.slice(s.indexOf("export async function PATCH"));
  const guarded = /if \(!isHubExperience\(fields\.experience\)\) return refuse\([^)]*\);\n\s*const experience = fields\.experience;\n\s*const ctx = await requireIndividualContext\(experience\);\n\s*if \(isGuardRefusal\(ctx\)\) return ctx;/.test(post)
    && /const ctx = await requireIndividualContext\(experience\);\n\s*if \(isGuardRefusal\(ctx\)\) return ctx;/.test(patch);
  const ownKinds = /if \(!kindAllowed\(experience, fields\.kind\)\) return refuse/.test(post) && post.indexOf("kindAllowed(") < post.indexOf("addItem(");
  const docs = /const documentsOffered = experience === "professional" && policy\.documentKinds\.includes\(input\.section\);/.test(post)
    && /if \(file && !documentsOffered\) return refuse/.test(post);
  const noDirect = !/\.from\(|user_?id\s*[:=]\s*(body|fields)/i.test(s) && /addItem\(ctx\.admin, ctx\.userId, input, doc, experience\)/.test(post)
    && /withdrawItem\(ctx\.admin, ctx\.userId, id, fields\.withdraw\)/.test(patch);
  const neverVerified = !/verif(y|ied|ication)\s*[:=(]/i.test(s.replace(/\/\/.*$/gm, ""));
  return { ok: guarded && ownKinds && docs && noDirect && neverVerified, detail: `experience guarded ${guarded}, own kinds only ${ownKinds}, documents Professional only ${docs}, no direct write or body user id ${noDirect}, nothing verifies ${neverVerified}` };
};
const checkGuards = (src: Sources): R => {
  const bad: string[] = [];
  for (const f of ROUTES) {
    const s = src.get(f) ?? "";
    const handlers = [...s.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    const guards = [...s.matchAll(/requireIndividualContext\("professional"\)/g)].length;
    if (!s || handlers === 0 || guards < handlers || /user_?id\s*[:=]\s*(body|fields)/i.test(s)) bad.push(f);
  }
  return { ok: bad.length === 0, detail: bad.join(", ") };
};

// ── V. VERIFICATION ─────────────────────────────────────────────────────────────────────────────────────
const checkNoVerifiedState = (states: readonly string[], fn: typeof itemState): R => {
  const forged = fn({ evidence_class: "independently_verified", expires_on: null, superseded_at: null, withdrawn_at: null }, "2026-10-25");
  return { ok: !states.some(s => /verif/.test(s)) && forged === "self_declared", detail: `states ${states.join(",")}; forged class reads as ${forged}` };
};

// ── C. CATALOGUES ───────────────────────────────────────────────────────────────────────────────────────
const checkSuggestions = (src: Sources): R => {
  const s = src.get(SUGGEST) ?? "";
  const gate = /const allowed = await professionalAllowlist\(admin\);\s*if \(!allowed\.length\) return \[\];/.test(s);
  const filter = /\.is\("hospital_id", null\)\.eq\("is_active", true\)\.eq\("pub_status", PUBLISHED\)\.in\("id", allowed\)/.test(s);
  const reads = (s.match(/from\("frameworks"\)/g) ?? []).length === 1;
  return { ok: gate && filter && reads, detail: `empty allowlist suggests nothing ${gate}, shared+active+published+allowlisted ${filter}, one framework read ${reads}` };
};

// ── A. AI ───────────────────────────────────────────────────────────────────────────────────────────────
const checkAi = (src: Sources, fn: typeof profileContext): R => {
  const s = src.get(AI) ?? "";
  const pa = src.get("src/lib/individual/personal-ai.ts") ?? "";
  const gated = /\(await loadIndividualPolicy\(admin\)\)\.professionalProfile\.ai === "on"/.test(pa);
  const noLeak = !/self_declared_identifier|document_name|self_declared_registration_number/.test(s);
  const text = fn({ provisioned: true, pointer: undefined, history: [], items: [] }) ?? "";
  const rule = /Never add a qualification, licence, registration, employer, role or credential/.test(text);
  return { ok: gated && noLeak && rule, detail: `policy-gated ${gated}, no number/document ${noLeak}, rule ${rule}` };
};

// ── O. FAILS OPEN TO THE MVP ────────────────────────────────────────────────────────────────────────────
const checkFailOpen = (src: Sources): R => {
  const reg = src.get(REG) ?? "";
  const page = src.get(PAGE) ?? "";
  const store = src.get(STORE) ?? "";
  const home = /if \(registrationState\(view\) !== "incomplete"\) return null;/.test(reg);
  const prov = /if \(!provisioned\) return \{ provisioned, pointer: undefined, history: \[\], items: \[\] \};/.test(store);
  const mvp = /if \(!view\.provisioned\) \{[\s\S]*?title="Profession & registration"/.test(page);
  return { ok: home && prov && mvp, detail: `home form only when incomplete ${home}, 450 absent is not provisioned ${prov}, MVP page kept ${mvp}` };
};

// ── B. PART B (owner continuation GO): VERIFICATION, REMINDERS, SELECTIVE SHARING ──────────────────────────
const mig = (n: string) => { const f = readdirSync("supabase/migrations").find(x => x.startsWith(`${n}-`)); return f ? readFileSync(`supabase/migrations/${f}`, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : ""; };
const M451 = mig("451"), M452 = mig("452"), M453 = mig("453");
const VER = "src/lib/individual/professional/profile-verification.ts";
const HQ_ROUTE = "src/app/api/hq/individual/verification/route.ts";
const HQ_PAGE = "src/app/super-admin/individual/verification/page.tsx";
const REMIND = "src/lib/individual/professional/reminders.ts";
const SHARE = "src/lib/individual/professional/share.ts";
const SHARE_PROFILE = "src/lib/individual/professional/share-profile.ts";
const VERIFY_PAGE = "src/app/verify/[token]/page.tsx";
// PASSPORT-01 (Stage 7): /verify renders a Professional link through the one Passport read, which asks the helper.
const PASSPORT_VIEW = "src/lib/individual/passport-view.ts";
const PROF_HARNESS = existsSync("scripts/individual-professional-harness.ts") ? readFileSync("scripts/individual-professional-harness.ts", "utf8") : "";

const ownRowOnly = (m: string, tables: string[]): boolean => tables.every(t => m.includes(`alter table ${t} enable row level security`)
  && new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(m))
  && !/create policy [a-z_]+ on [a-z_]+\s+for (insert|update|delete|all)/.test(m);

const checkVerifierAuthority = (m: string): R => {
  const rls = ownRowOnly(m, ["individual_professional_item_verification"]);
  const holds = /if not public\.individual_holds_capability\(new\.actor_id, 'hq\.individual\.professional\.verify'\) then\s+raise exception/.test(m)
    && /a\.status = 'active'/.test(m);
  const independent = /if new\.actor_id is null or new\.actor_id = new\.user_id then\s+raise exception/.test(m);
  const personOnly = /if new\.actor_id is distinct from new\.user_id then\s+raise exception/.test(m);
  const consent = /if v_last not in \('requested', 'disputed'\) or v_last is null then\s+raise exception/.test(m);
  const appendOnly = /before update or delete on individual_professional_item_verification/.test(m) && /if pg_trigger_depth\(\) > 1 then/.test(m);
  const noAppointment = !/insert into ogs_office_appointments/.test(m);
  const onlyPosition = /from \(values \('individual_professional_verifier'\)\) as p\(code\)/.test(m) && (m.match(/insert into hq_position_capability/g) ?? []).length === 1;
  return { ok: rls && holds && independent && personOnly && consent && appendOnly && noAppointment && onlyPosition,
    detail: `rls ${rls}, appointment ${holds}, independence ${independent}, person events ${personOnly}, request first ${consent}, append-only ${appendOnly}, no appointment ${noAppointment}, one position ${onlyPosition}` };
};
type Derive = typeof import("../src/lib/individual/professional/profile-verification").deriveVerification;
const checkDerivation = (derive: Derive, src: Sources, harness: string): R => {
  const row = (event: string, extra: Record<string, unknown> = {}, n = 0) => ({ id: `r${n}`, item_id: "i", event, method: null, valid_until: null, reason: null, created_at: `2026-10-0${n + 1}T00:00:00Z`, ...extra }) as never;
  const today = "2026-10-25";
  const s = (rows: never[]) => derive(rows, today).state;
  const cases = [
    s([row("requested")]) === "requested",
    s([row("requested", {}, 0), row("verified", { method: "register_check" }, 1)]) === "verified",
    s([row("requested", {}, 0), row("verified", { method: "register_check", valid_until: "2026-01-01" }, 1)]) === "expired",
    s([row("requested", {}, 0), row("verified", { method: "register_check" }, 1), row("revoked", { reason: "x" }, 2)]) === "revoked",
    s([row("requested", {}, 0), row("request_withdrawn", {}, 1)]) === "none",
    s([row("requested", {}, 0), row("declined", { reason: "x" }, 1)]) === "declined",
  ];
  // The exempt list stays EXACT. PROF-EVALUATION-01 added one reviewed entry: evaluation-stage5.ts READS a C5 decision's
  // outcome class (510-fixed, assessor-decided) and sets no verified state. Profile (451) verification is still derived only
  // in profile-verification.ts (the cases above), and any third file turns this red.
  const oneFile = /const VERIFIED_STATE_FILES = new Set\(\["src\/lib\/individual\/professional\/profile-verification\.ts", "src\/lib\/individual\/professional\/evaluation-stage5\.ts"\]\);/.test(harness);
  const page = src.get(PASSPORT_VIEW) ?? "";
  const viaHelper = /isIndependentlyVerified\(r\.verification\.state\)/.test(page) && !/state === "verified"/.test(page) && !/state === "verified"/.test(src.get(VERIFY_PAGE) ?? "");
  return { ok: cases.every(Boolean) && oneFile && viaHelper, detail: `cases ${cases.map(c => (c ? 1 : 0)).join("")}, one exempt file ${oneFile}, /verify through the helper ${viaHelper}` };
};
const checkHqGate = (src: Sources): R => {
  const route = src.get(HQ_ROUTE) ?? "";
  const handlers = [...route.matchAll(/export async function (GET|POST)\b/g)].length;
  const gates = [...route.matchAll(/await hqApiGate\(\["hq\.individual\.professional\.verify"\]\)/g)].length;
  const page = /await requireHqCapability\("hq\.individual\.professional\.verify"\)/.test(src.get(HQ_PAGE) ?? "");
  // Read raw: spaces.ts holds route globs whose "/*" the comment strip would take for a comment opener.
  const map = /prefix: "\/super-admin\/individual\/verification", capability: "hq\.individual\.professional\.verify"/.test(readFileSync("src/lib/hq/spaces.ts", "utf8"));
  const queue = /\(v\.state === "requested" \|\| v\.state === "disputed"\) && owner\.get\(id\) !== verifierId/.test(src.get(VER) ?? "");
  const docOnOpen = /const open = await hasOpenRequest\(/.test(route) && /if \(open\.userId === ctx\.userId\) return refuse\(403/.test(route);
  return { ok: handlers === 2 && gates === 2 && page && map && queue && docOnOpen, detail: `handlers ${handlers}, gates ${gates}, page ${page}, map ${map}, queue requested-only and not own ${queue}, document only on an open request ${docOnOpen}` };
};
type Due = typeof import("../src/lib/individual/professional/reminders").dueOffset;
type Elig = typeof import("../src/lib/individual/professional/reminders").itemEligible;
const checkReminders = (src: Sources, due: Due, eligible: Elig, m: string): R => {
  const s = src.get(REMIND) ?? "";
  const policy = /const kinds = new Set\(policy\.professionalProfile\.reminderKinds\);/.test(s) && /profileItemCandidates\(admin, \[\.\.\.active\], today, policy\.professionalProfile\)/.test(s);
  const claim = /from\("individual_professional_reminder_log"\)\.insert\(/.test(s) && /from\("individual_professional_reminder_log"\)\.delete\(\)/.test(s);
  const once = due("2026-11-14", "2026-10-25", [60, 30]) === 30 && due("2026-12-20", "2026-10-25", [60, 30]) === 60 && due("2027-06-01", "2026-10-25", [60, 30]) === null;
  const p = DEFAULT_POLICY.professionalProfile;
  const elig = eligible({ section: "registration", type_code: "active" }, p) && !eligible({ section: "registration", type_code: "lapsed" }, p) && eligible({ section: "qualification", type_code: null }, p);
  const ledger = ownRowOnly(m, ["individual_professional_reminder_log"]) && /create unique index if not exists ux_individual_professional_reminder_log_once\s+on individual_professional_reminder_log\(item_id, expires_on, offset_days\);/.test(m);
  return { ok: policy && claim && once && elig && ledger, detail: `policy-driven ${policy}, claim/release ${claim}, tightest once ${once}, eligibility ${elig}, ledger ${ledger}` };
};
type ParseShare = typeof import("../src/lib/individual/professional/share-profile").parseShareProfile;
const checkSharing = (src: Sources, parse: ParseShare, m: string): R => {
  const page = src.get(VERIFY_PAGE) ?? "";
  const lib = src.get(SHARE_PROFILE) ?? "";
  const gated = /if \(carriesOwn\) \{\s+const meta = await loadViewMeta\(/.test(page) && /loadSharedProfile\(admin, shareTokenId, userId, ctx\.profile\.shareSections, ctx\.today\)/.test(src.get(PASSPORT_VIEW) ?? "")
    && !/loadSharedProfile\(/.test(page);
  const current = /\.is\("superseded_at", null\)\.is\("withdrawn_at", null\)\.order\("created_at"\)/.test(lib) && /sections\.includes\(ITEM_SECTION\[i\.section as ItemKind\]\)/.test(lib);
  const private_ = /verification: \{ \.\.\.\(byItem\[i\.id\] \?\? NO_VERIFICATION\), reason: null, history: \[\] \}/.test(lib) && !/self_declared_identifier|document_path|document_name|detail/.test(lib.replace(/\/\/.*$/gm, ""));
  const offByDefault = JSON.stringify(parse({})) === JSON.stringify({ overview: false, itemIds: [] })
    && /\.\.\.\(profile\.overview \? \{ profile_overview: true \} : \{\}\)/.test(src.get(SHARE) ?? "");
  const schema = ownRowOnly(m, ["individual_professional_share_item"]) && /add column if not exists profile_overview boolean not null default false/.test(m)
    && /foreign key \(share_token_id, user_id\) references individual_professional_share\(share_token_id, user_id\)/.test(m)
    && /foreign key \(item_id, user_id\) references individual_professional_profile_item\(id, user_id\)/.test(m);
  return { ok: gated && current && private_ && offByDefault && schema, detail: `Professional links only ${gated}, current chosen versions in allowed sections ${current}, no number/document/details/reasons ${private_}, off by default ${offByDefault}, schema ${schema}` };
};

function main() {
  console.log("PROFESSIONAL PROFILE HARNESS (COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  ok("0a. the Stage 1 source and migration 450 were found", ALL.has(STORE) && !!MIG);
  ok("0b. ⚠ the comment strip kept real code -- a real write survives it", /\.insert\(/.test(ALL.get(STORE) ?? ""));

  run("S1. RLS own-row SELECT only, no write policy, experience_code with no default -- both 450 tables", checkRls(MIG));
  run("S2. no verified column and no hospital/organisation/tenant/workspace column, on the tables or added to the pointer", checkColumns(MIG));
  run("S3. evidence class GENERATED from the document, and a document path under the owner's own id", checkGenerated(MIG));
  run("S4. append-only history and records, each keeping the cascade path, and DELETE (erasure) still allowed", checkAppendOnly(MIG));
  run("S5. a version supersedes only a current record of the same person and section, and only once", checkSupersede(MIG));
  run("S6. registration completes only with profession, jurisdiction and status present -- in the schema", checkCompletion(MIG));
  run("F1. exactly three required facts: profession, jurisdiction, status", checkRequired(REQUIRED_FIELDS));
  run("F2. no registration number, licence, employment record or document can be configured into the form", checkNeverAsked(POLICIES));
  run("F3. by default every optional question is asked and none is required (skippable)", checkSkippable(DEFAULT_POLICY.professionalProfile));
  run("F4. no country, profession or regulator hard-coded as the context in the Stage 1 code", checkNoHardcodedContext(ALL));
  run("W1. no code writes the profile history: the 450 trigger does", checkHistoryNotWritten(ALL));
  run("W2. no profile record is deleted or upserted, and the one update (withdraw) is scoped to the owner", checkNoItemDelete(ALL));
  run("W3. every Stage 1 handler is guarded for Professional and never takes a user id from the body", checkGuards(ALL));
  run("W4. the shared Profile & History route: the experience is guarded, not trusted; own kinds only; documents Professional only; no direct write; nothing verifies", checkHubRoute(ALL));
  run("V1. no record state means verified, and a forged class reads as self-declared", checkNoVerifiedState(RECORD_STATES, itemState));
  run("C1. catalogue suggestions: shared, active, published and allowlisted only, nothing from an empty allowlist", checkSuggestions(ALL));
  run("A1. AI grounding: policy-gated, the no-invention rule, never a registration number or document name", checkAi(ALL, profileContext));
  run("O1. fails open to the MVP while 450 is absent: no form on the home, the MVP profile page", checkFailOpen(ALL));
  run("B1. 451: verifier events need the capability through an ACTIVE appointment, an actor who is not the person, and an open request; person events only by the person; append-only; no appointment made", checkVerifierAuthority(M451));
  run("B2. the verified state comes only from verifier rows (6 histories), only one Professional file may name it, and /verify asks the helper", checkDerivation(deriveVerification, ALL, PROF_HARNESS));
  run("B3. the verifier console and both its handlers are gated by hq.individual.professional.verify; the queue holds only open requests, never the verifier's own; documents only on an open request", checkHqGate(ALL));
  run("B4. reminders: kinds, standings and offsets from the policy; one email for the tightest offset reached; claim before send, released on failure; 452 own-row with a full unique key", checkReminders(ALL, dueOffset, itemEligible, M452));
  run("B5. sharing: only on Professional links, only chosen current versions in allowed sections, never numbers, documents, details or reasons, off by default; 453 composite keys", checkSharing(ALL, parseShareProfile, M453));

  // ── P. PLANTED FAILURES -- each check must go red on a copy with one violation in it ──────────────────
  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const red = (name: string, r: R) => ok(`P. ${name} goes RED`, !r.ok, r.detail);
  const plant = (f: string, from: string, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  red("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_professional_profile_item for insert with check (true)"));
  red("S1 on a default experience_code", checkRls(MIG.replace("experience_code text not null,", "experience_code text not null default 'professional',")));
  red("S2 on a verified column", checkColumns(MIG.replace("withdrawn_reason text,", "withdrawn_reason text,\n  verified_by uuid,")));
  red("S2 on a hospital column added to the pointer", checkColumns(MIG + "\nalter table individual_professional_profile add column if not exists hospital_id uuid"));
  red("S3 on a writable class", checkGenerated(MIG.replace("evidence_class text generated always as", "evidence_class text, x text generated always as")));
  red("S4 without the cascade path", checkAppendOnly(MIG.replace(/pg_trigger_depth\(\) > 1/g, "true")));
  red("S5 on a single-column supersede link", checkSupersede(MIG.replace("foreign key (supersedes_id, user_id)", "foreign key (supersedes_id)")));
  red("S6 on a completion that ignores status", checkCompletion(MIG.replace("and char_length(btrim(coalesce(self_declared_professional_status, ''))) > 0", "")));
  red("F1 on a fourth required fact", checkRequired([...REQUIRED_FIELDS, "specialty"]));
  red("F2 on a configurable registration number", checkNeverAsked(POLICIES.map(p => p.key === "professional_registration_fields" && "options" in p ? { ...p, options: [...p.options, { value: "number", label: "Registration number" }] } : p) as typeof POLICIES));
  red("F3 on a required-by-default question", checkSkippable({ ...DEFAULT_POLICY.professionalProfile, registrationRequired: ["title"] }));
  red("F4 on a hard-coded country", checkNoHardcodedContext(add(STORE, `const HOME = "Uganda";`)));
  red("W1 on a code write to the history", checkHistoryNotWritten(add(STORE, `admin.from("individual_professional_profile_context").insert({})`)));
  red("W2 on a record delete", checkNoItemDelete(add(STORE, `admin.from("individual_professional_profile_item").delete()`)));
  red("W4 on an experience taken from the body unguarded", checkHubRoute(plant(HUB_ROUTE, "const ctx = await requireIndividualContext(experience);\n  if (isGuardRefusal(ctx)) return ctx;\n  if (!kindAllowed", "const ctx = await requireIndividualContext();\n  if (isGuardRefusal(ctx)) return ctx;\n  if (!kindAllowed")));
  red("W4 on a Scholar record of any kind", checkHubRoute(plant(HUB_ROUTE, "if (!kindAllowed(experience, fields.kind)) return refuse", "if (false) return refuse")));
  red("W4 on a document attached to a Scholar record", checkHubRoute(plant(HUB_ROUTE, 'const documentsOffered = experience === "professional" && policy.documentKinds', "const documentsOffered = policy.documentKinds")));
  red("W4 on the route marking a record verified", checkHubRoute(add(HUB_ROUTE, 'const marked = { verified: true };')));
  red("W3 on an unguarded handler", checkGuards(plant(ROUTES[1], `export async function PATCH(req: Request) {\n  const ctx = await requireIndividualContext("professional");`, `export async function PATCH(req: Request) {\n  const ctx = await requireIndividualContext();`)));
  red("V1 on a verified state", checkNoVerifiedState([...RECORD_STATES, "independently_verified"], itemState));
  red("C1 on a suggestion without the allowlist", checkSuggestions(plant(SUGGEST, `.in("id", allowed)`, "")));
  red("A1 on grounding that leaks the registration number", checkAi(add(AI, "const n = i.self_declared_identifier;"), profileContext));
  red("O1 on a home form shown whatever the state", checkFailOpen(plant(REG, `if (registrationState(view) !== "incomplete") return null;`, "")));
  red("B1 without the appointment check", checkVerifierAuthority(M451.replace("if not public.individual_holds_capability(new.actor_id, 'hq.individual.professional.verify') then", "if false then")));
  red("B1 without independence", checkVerifierAuthority(M451.replace("if new.actor_id is null or new.actor_id = new.user_id then", "if new.actor_id is null then")));
  red("B1 on an automatic appointment", checkVerifierAuthority(M451 + "\ninsert into ogs_office_appointments (role) values ('individual_professional_verifier')"));
  red("B1 on a write policy", checkVerifierAuthority(M451 + "\ncreate policy p on individual_professional_item_verification for insert with check (true)"));
  red("B2 on a second file allowed to say verified", checkDerivation(deriveVerification, ALL, PROF_HARNESS.replace(`"src/lib/individual/professional/evaluation-stage5.ts"])`, `"src/lib/individual/professional/evaluation-stage5.ts", "src/lib/individual/professional/share-profile.ts"])`)));
  red("B2 on the Stage 6 C5 reader swapped for an unreviewed file", checkDerivation(deriveVerification, ALL, PROF_HARNESS.replace(`"src/lib/individual/professional/evaluation-stage5.ts"])`, `"src/lib/individual/professional/share-profile.ts"])`)));
  red("B2 on /verify comparing the state itself", checkDerivation(deriveVerification, plant(PASSPORT_VIEW, "isIndependentlyVerified(r.verification.state)", `r.verification.state === "verified"`), PROF_HARNESS));
  red("B2 on a derivation that trusts a request", checkDerivation(((rows: never[], t: string) => ({ ...deriveVerification(rows, t), state: "verified" })) as Derive, ALL, PROF_HARNESS));
  red("B3 on an ungated document handler", checkHqGate(plant(HQ_ROUTE, `export async function GET(req: Request) {\n  const ctx = await hqApiGate(["hq.individual.professional.verify"]);`, `export async function GET(req: Request) {\n  const ctx = await hqApiGate(["hq.platform.home.view"]);`)));
  red("B3 on a queue that includes the verifier's own records", checkHqGate(plant(VER, ` && owner.get(id) !== verifierId).map(([id]) => id);\n    if (!open.length)`, `).map(([id]) => id);\n    if (!open.length)`)));
  red("B4 on reminders that ignore the kinds policy", checkReminders(plant(REMIND, "const kinds = new Set(policy.professionalProfile.reminderKinds);", "const kinds = new Set(['credentials', 'primary_registration']);"), dueOffset, itemEligible, M452));
  red("B4 on a schedule that sends every offset", checkReminders(ALL, ((e: string, t: string, o: readonly number[]) => (o.length ? Math.max(...o) : null)) as Due, itemEligible, M452));
  red("B4 on a partial claim key", checkReminders(ALL, dueOffset, itemEligible, M452.replace("(item_id, expires_on, offset_days);", "(item_id, expires_on, offset_days) where offset_days > 0;")));
  red("B5 on /verify showing the profile on every link", checkSharing(plant(VERIFY_PAGE, "  if (carriesOwn) {\n    const meta = await loadViewMeta(", "  if (true) {\n    const meta = await loadViewMeta("), parseShareProfile, M453));
  red("B5 on a shared record that carries the verifier's reasons", checkSharing(plant(SHARE_PROFILE, ", reason: null, history: [] },", " },"), parseShareProfile, M453));
  red("B5 on sharing that leaks the registration number", checkSharing(add(SHARE_PROFILE, "const n = i.self_declared_identifier;"), parseShareProfile, M453));
  red("B5 on the overview shared by default", checkSharing(ALL, ((b: Record<string, unknown>) => ({ ...parseShareProfile(b), overview: true })) as ParseShare, M453));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
