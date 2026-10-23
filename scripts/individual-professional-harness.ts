/**
 * INDIVIDUAL PROFESSIONAL HARNESS -- the Competen Professional invariants of COMPETEN-IND-007, checked from
 * source and schema. No database.
 *
 *   npx --yes tsx scripts/individual-professional-harness.ts
 *
 * WHAT IT PROVES (one group each):
 *   W. No write to cpd_logs, professional_credentials or any estate table. Every Professional write is
 *      pinned to the file that makes it, and the ONE estate write (passport_share_tokens, by brief) is
 *      pinned to the share module.
 *   R. No employer-visible read path. The Professional tables are read only by Professional code, and the
 *      Professional data modules are imported only by the Individual shell, the consented /verify page
 *      and the platform reminder job. Migration 373 gives no table a hospital or organisation column.
 *   E. Evidence classes are rendered correctly. The schema generates the class from the document and
 *      stores no verified flag. The Passport, the class label and /verify render exactly the two own
 *      classes, each saying "not verified", and drop anything else rather than show it as verified.
 *   D. Direct entry. Every Professional API and page asks for Professional and never for Scholar.
 *   S. Schema posture (owner ruling D6): RLS on and own-row SELECT only on every 373 table.
 *
 * ⚠ THE CONTROLS RUN EVERY TIME. Each check is a function over the sources. After the real run, the
 * harness plants one violation per check into an in-memory COPY of the sources and requires that check to
 * go red (group P). A check that cannot fail is reported as a failure. Nothing on disk is changed.
 *
 * ⚠ IT READS STRIPPED SOURCE, like individual-foundation-harness.ts: these files explain at length the
 * tables they must not touch, and a needle must not match its own documentation.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EVIDENCE_LABEL } from "../src/lib/individual/passport";
import { OWN_EVIDENCE_CLASSES, PROFESSIONAL_TABLES, DOCUMENT_BUCKET } from "../src/lib/individual/professional/vocabulary";
import { ownRecordsFrom } from "../src/lib/individual/professional/passport-records";
import { ClassLabel } from "../src/app/individual/_components/professional/bits";
import { EXPERIENCES } from "../src/lib/individual/experiences";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

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
function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

type Sources = Map<string, string>;
const ALL: Sources = new Map(walk("src").map(posix).map(f => [f, strip(readFileSync(f, "utf8"))]));
const MIG_FILE = "supabase/migrations/373-individual-professional-record.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase() : "";
const MIG374_FILE = "supabase/migrations/374-individual-professional-reminder-preferences.sql";
const MIG374 = existsSync(MIG374_FILE) ? readFileSync(MIG374_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase() : "";

const isProfessional = (f: string) => /^src\/(lib\/individual\/professional|app\/api\/individual\/professional|app\/individual\/_components\/professional|app\/individual\/\(app\)\/\[experience\]\/\(professional\))\//.test(f);

// ── W. WRITES ───────────────────────────────────────────────────────────────────────────────────────
// The complete list. A new Professional writer is a reviewed change to this table, not a drive-by.
const WRITES: Record<string, string[]> = {
  "src/app/api/individual/professional/profile/route.ts": ["individual_professional_profile.update", "individual_professional_profile.insert"],
  "src/app/api/individual/professional/needs/route.ts": ["individual_professional_need.insert", "individual_professional_need.update", "individual_professional_need.delete"],
  "src/app/api/individual/professional/goals/route.ts": ["individual_professional_goal.insert", "individual_professional_goal.update", "individual_professional_goal.delete"],
  "src/app/api/individual/professional/cpd/route.ts": ["individual_professional_cpd.insert", "individual_professional_cpd.delete"],
  "src/app/api/individual/professional/evidence/route.ts": ["individual_professional_evidence.insert", "individual_professional_evidence.delete"],
  "src/app/api/individual/professional/assistant/route.ts": ["audit_log.insert"],
  "src/lib/individual/professional/api.ts": ["audit_log.insert"],
  "src/lib/individual/professional/share.ts": ["passport_share_tokens.insert", "individual_professional_share.insert", "passport_share_tokens.update"],
  "src/lib/individual/professional/reminders.ts": ["individual_professional_evidence.update", "individual_professional_profile.update"],
  "src/app/api/individual/professional/reminders/route.ts": ["individual_professional_profile.update", "individual_professional_profile.insert"],
};
const ESTATE_NAMED = /^(cpd_logs|professional_credentials|evidence|cdp_reminders|notifications|competency_decisions|employment_records|profiles)\./;

function writesOf(src: Sources): string[] {
  const out: string[] = [];
  for (const [f, s] of src) {
    if (!isProfessional(f)) continue;
    for (const m of s.matchAll(/from\(\s*"([a-z_]+)"\s*\)\s*\.(insert|update|upsert|delete)\(/g)) out.push(`${f}: ${m[1]}.${m[2]}`);
    // A dynamic table name on a write would escape every needle above. Refuse it outright.
    for (const m of s.matchAll(/from\(\s*([A-Za-z_][\w.[\]]*)\s*\)\s*\.(insert|update|upsert|delete)\(/g)) out.push(`${f}: <dynamic ${m[1]}>.${m[2]}`);
    // Storage writes go to the Professional bucket only.
    for (const m of s.matchAll(/storage\.from\(\s*([^)]+)\)\s*\.(upload|remove|update|move|copy)\(/g)) if (m[1].trim() !== "DOCUMENT_BUCKET") out.push(`${f}: storage:${m[1].trim()}.${m[2]}`);
  }
  return out;
}
const checkWritesPinned = (src: Sources) => {
  const bad = writesOf(src).filter(w => { const [f, op] = w.split(": "); return !(WRITES[f] ?? []).includes(op); });
  return { ok: bad.length === 0, detail: bad.join("; ") };
};
const checkNoEstateWrite = (src: Sources) => {
  const bad = writesOf(src).filter(w => {
    const [f, op] = w.split(": ");
    if (op.startsWith("passport_share_tokens.")) return f !== "src/lib/individual/professional/share.ts";
    if (op === "audit_log.insert") return false;
    return ESTATE_NAMED.test(op) || !op.startsWith("individual_professional_");
  });
  return { ok: bad.length === 0, detail: bad.join("; ") };
};
const checkWritesSeen = (src: Sources) => {
  const seen = new Set(writesOf(src));
  const missing = Object.entries(WRITES).flatMap(([f, ops]) => ops.map(op => `${f}: ${op}`)).filter(w => !seen.has(w));
  return { ok: missing.length === 0, detail: missing.join("; ") };
};
// The estate tables Professional must never touch AT ALL -- not even a read: their readers are employers.
const checkNoEstateLearningTouch = (src: Sources) => {
  const re = /from\(\s*"(cpd_logs|evidence|cdp_reminders|quiz_attempts|knowledge_attempts|course_enrollments|learning_enrolments|skill_log_entries)"\s*\)/;
  const bad = [...src].filter(([f, s]) => isProfessional(f) && re.test(s)).map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};

// ── R. READ PATHS ───────────────────────────────────────────────────────────────────────────────────
const checkTablesReadOnlyByProfessional = (src: Sources) => {
  const bad = [...src].filter(([f, s]) => !isProfessional(f) && /from\(\s*"individual_professional_[a-z_]+"\s*\)/.test(s)).map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};
// Who may import Professional data code. Each entry is a reason, as in plane-boundary.ts.
const IMPORTERS_ALLOWED: { re: RegExp; why: string }[] = [
  { re: /^src\/(lib\/individual|app\/individual|app\/api\/individual)\//, why: "the Individual product itself (gate 3)" },
  { re: /^src\/app\/verify\/\[token\]\/page\.tsx$/, why: "the person's consented, revocable share link (passport_share_tokens + individual_professional_share)" },
  { re: /^src\/lib\/platform\/jobs\.ts$/, why: "the daily reminder job, which emails the person about their own record and reports counts only" },
];
const checkImporters = (src: Sources) => {
  const bad = [...src].filter(([f, s]) => /from\s+["'](@\/lib\/individual\/professional\/|\.\.?\/[./]*professional\/)/.test(s) && !IMPORTERS_ALLOWED.some(a => a.re.test(f)))
    .map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};
const checkJobImportsRemindersOnly = (src: Sources) => {
  const s = src.get("src/lib/platform/jobs.ts") ?? "";
  const imports = [...s.matchAll(/from\s+"@\/lib\/individual\/professional\/([a-z-]+)"/g)].map(m => m[1]);
  return { ok: imports.length === 1 && imports[0] === "reminders", detail: imports.join(", ") };
};
const checkBucketPrivate = (src: Sources) => {
  const users = [...src].filter(([, s]) => s.includes(`"${DOCUMENT_BUCKET}"`)).map(([f]) => f);
  return { ok: users.length === 1 && users[0] === "src/lib/individual/professional/vocabulary.ts", detail: users.join(", ") };
};
const tableBlocks = (mig: string) => [...mig.matchAll(/create table if not exists (individual_professional_[a-z_]+) \(([\s\S]*?)\n\);/g)].map(m => ({ name: m[1], body: m[2] }));
const checkNoScopeColumns = (mig: string) => {
  const bad = tableBlocks(mig).filter(t => /\b(hospital_id|organisation_id|tenant_id|workspace_id)\b/.test(t.body)).map(t => t.name);
  return { ok: tableBlocks(mig).length === PROFESSIONAL_TABLES.length && bad.length === 0, detail: bad.join(", ") || `${tableBlocks(mig).length} tables` };
};

// ── E. EVIDENCE CLASSES ─────────────────────────────────────────────────────────────────────────────
const checkGeneratedClass = (mig: string) => {
  const gen = (mig.match(/evidence_class text generated always as\s*\(case when document_path is null then 'self_declared' else 'source_linked' end\) stored/g) ?? []).length;
  const verifiedCol = tableBlocks(mig).filter(t => /\bverif[a-z_]*\b/.test(t.body)).map(t => t.name);
  return { ok: gen === 2 && verifiedCol.length === 0, detail: `generated=${gen} verified-columns=${verifiedCol.join(",")}` };
};
const checkLabels = (labels: Record<string, string>) => {
  const bad = OWN_EVIDENCE_CLASSES.filter(c => !/not verified/i.test(labels[c] ?? "") || /^verified/i.test(labels[c] ?? ""));
  return { ok: OWN_EVIDENCE_CLASSES.length === 2 && bad.length === 0, detail: bad.join(", ") };
};
const RECORD = {
  provisioned: true,
  profile: { self_declared_profession: "Registered nurse", self_declared_registration_body: "UNMC", self_declared_registration_number: "123", self_declared_registration_country: "Uganda", self_declared_registration_expires_on: null, updated_at: null },
  needs: [], goals: [],
  cpd: [
    { id: "c1", goal_id: null, activity_type: "course", title: "ALS", provider: null, hours: 8, cpd_points: null, activity_date: "2026-05-01", reflection: "private", document_name: "cert.pdf", evidence_class: "source_linked", created_at: "" },
    { id: "c2", goal_id: null, activity_type: "self_study", title: "Reading", provider: null, hours: 1, cpd_points: null, activity_date: "2026-05-02", reflection: null, document_name: null, evidence_class: "self_declared", created_at: "" },
  ],
  evidence: [
    { id: "e1", kind: "credential", need_id: null, title: "BLS", detail: "private detail", issuing_body: "AHA", issued_on: null, expires_on: null, framework_id: null, framework_competency_id: null, document_name: null, evidence_class: "self_declared", created_at: "" },
    // A row claiming a class Professional cannot create -- it must be DROPPED, never shown as verified.
    { id: "e2", kind: "credential", need_id: null, title: "Forged", detail: null, issuing_body: null, issued_on: null, expires_on: null, framework_id: null, framework_competency_id: null, document_name: null, evidence_class: "independently_verified", created_at: "" },
  ],
};
const checkPassportItems = (fn: typeof ownRecordsFrom) => {
  const items = fn(RECORD as never) ?? [];
  const classes = items.map(i => `${i.kind}:${i.evidence}`).join(",");
  const want = "registration:self_declared,credential:self_declared,cpd:source_linked,cpd:self_declared";
  const leaks = items.some(i => /private/.test(`${i.title} ${i.detail}`));
  return { ok: classes === want && !leaks, detail: `${classes}${leaks ? " + leaked private text" : ""}` };
};
const checkRenderedLabel = (render: (v: string) => string) => {
  const sl = render("source_linked"), sd = render("self_declared"), bad = render("institution_verified");
  return { ok: /not verified/.test(sl) && /document attached/.test(sl) && /not verified/.test(sd) && bad === "", detail: `${sl} | ${sd} | ${bad}` };
};
const checkVerifyPage = (src: Sources) => {
  const s = src.get("src/app/verify/[token]/page.tsx") ?? "";
  return {
    ok: /\(await individualAppEnabled\(admin\)\) && await shareCarriesOwnRecords\(admin, share\.id, share\.nurse_id\)/.test(s)
      && /carriesOwn \? await loadOwnRecords\(admin, share\.nurse_id\) : null/.test(s)
      && /EVIDENCE_LABEL\[o\.evidence\]/.test(s)
      && /carriesOwn \? "Competen · Passport" : "Competen · Verified Passport"/.test(s)
      && /not verified by Competen or by any organisation/.test(s),
    detail: "the own-records section must be gated on the release gate AND the companion row, labelled by class, and unhook the Verified header",
  };
};
const checkNoVerifiedClassInProfessional = (src: Sources) => {
  const bad = [...src].filter(([f, s]) => isProfessional(f) && /institution_verified|independently_verified|verified:\s*true|"verified"/.test(s)).map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};

// ── D. DIRECT ENTRY ─────────────────────────────────────────────────────────────────────────────────
const checkDirectEntry = (src: Sources) => {
  const routes = [...src].filter(([f]) => f.startsWith("src/app/api/individual/professional/") && f.endsWith("route.ts"));
  const bad: string[] = [];
  for (const [f, s] of routes) {
    const handlers = [...s.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    const guards = [...s.matchAll(/requireIndividualContext\((?:"professional")?\)/g)].length;
    if (handlers === 0 || guards < handlers || /requireIndividualContext\("scholar"\)|\bscholar\b/.test(s)) bad.push(f);
  }

  const pages = [...src].filter(([f]) => f.startsWith("src/app/individual/(app)/[experience]/(professional)/") && f.endsWith("page.tsx"));
  // Each module page names its OWN segment to the foundation's experienceModulePage, which 404s unless the
  // experience lists it -- and only Professional lists these segments, so the Scholar URL is not a page.
  const scholarSegs = new Set(EXPERIENCES.scholar.modules.map(m => m.segment));
  for (const [f, s] of pages) {
    const seg = /\(professional\)\/([a-z-]+)\/page\.tsx$/.exec(f)?.[1] ?? "";
    const listed = EXPERIENCES.professional.modules.some(m => m.segment === seg);
    if (!s.includes(`await experienceModulePage((await params).experience, "${seg}")`) || !listed || scholarSegs.has(seg) || /\bscholar\b/i.test(s)) bad.push(f);
  }
  return { ok: routes.length >= 9 && pages.length >= 6 && bad.length === 0, detail: `${routes.length} routes, ${pages.length} pages; ${bad.join(", ")}` };
};

// ── S. SCHEMA POSTURE ───────────────────────────────────────────────────────────────────────────────
const checkRls = (mig: string) => {
  const bad = PROFESSIONAL_TABLES.filter(t =>
    !mig.includes(`alter table ${t} enable row level security`)
    || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(mig));
  const writePolicies = /create policy [a-z_]+ on individual_professional_[a-z_]+\s+for (insert|update|delete|all)/.test(mig);
  const defaults = /experience_code text not null default/.test(mig);
  return { ok: bad.length === 0 && !writePolicies && !defaults, detail: `${bad.join(", ")}${writePolicies ? " write-policy" : ""}${defaults ? " experience_code default" : ""}` };
};
const checkCrossPersonLinks = (mig: string) => {
  const fks = ["individual_professional_goal_need_fk", "individual_professional_cpd_goal_fk", "individual_professional_evidence_need_fk"]
    .filter(n => new RegExp(`add constraint ${n}\\s+foreign key \\([a-z_]+, user_id\\) references`).test(mig));
  const paths = (mig.match(/document_path like user_id::text \|\| '\/%'/g) ?? []).length;
  return { ok: fks.length === 3 && paths === 2, detail: `${fks.length} composite FKs, ${paths} path checks` };
};

// ── F. PUBLISHED FRAMEWORKS ONLY (COMPETEN-CONFIG-002 P0) ────────────────────────────────────────────
// The list a person chooses from, and the check before any write, both require a shared, active,
// published framework. A draft or archived framework is neither offered nor accepted.
const checkPublishedFrameworks = (src: Sources) => {
  const s = src.get("src/lib/individual/professional/frameworks.ts") ?? "";
  const list = /\.is\("hospital_id", null\)\.eq\("is_active", true\)\.eq\("pub_status", PUBLISHED\)\.order\(/.test(s);
  const write = /\.eq\("id", frameworkId\)\.is\("hospital_id", null\)\.eq\("is_active", true\)\.eq\("pub_status", PUBLISHED\)\.maybeSingle\(\)/.test(s);
  return { ok: list && write && /export const PUBLISHED = "published"/.test(s), detail: `list filter ${list}, write check ${write}` };
};
// ── N. REMINDERS (migration 374, owner continuation GO Option A) ────────────────────────────────────
// Individual notifications stay separate from Enterprise and Practice: no Professional file names the
// estate notification stores, anywhere.
const checkNoEstateNotifications = (src: Sources) => {
  const bad = [...src].filter(([f, s]) => isProfessional(f) && /["'`](notifications|notification_preferences|notif_deliveries|cdp_reminders)["'`]/.test(s)).map(([f]) => f);
  return { ok: bad.length === 0, detail: bad.join(", ") };
};
// Email is opt-in: the scan narrows to reminder_email = true before anything is sent, and sends email only.
const checkEmailOptIn = (src: Sources) => {
  const s = src.get("src/lib/individual/professional/reminders.ts") ?? "";
  const optIn = s.indexOf(`.eq("reminder_email", true)`);
  const send = s.indexOf("await send(admin, c.userId, reminderMessage(c, today))");
  return {
    ok: optIn > -1 && send > optIn && s.includes(`dispatch(admin, [userId], message, ["email"])`) && !/\["in_app"/.test(s),
    detail: `opt-in filter at ${optIn}, send at ${send}`,
  };
};
// Owner review: a failed send must not consume the once-only reminder. The claim is kept only when the
// email was delivered, and released to its prior value otherwise.
const checkClaimReleasedOnFailure = (src: Sources) => {
  const s = src.get("src/lib/individual/professional/reminders.ts") ?? "";
  return {
    ok: s.includes("if (result.sent) { recipients.add(c.userId); out.sent++; continue; }")
      && s.includes(`update({ expiry_reminded_for: c.prior })`) && s.includes(`update({ registration_reminded_for: c.prior })`)
      && s.includes(`return email?.status === "sent" ? { sent: true }`),
    detail: "the marker must stay only on a confirmed 'sent' and be released to its prior value otherwise",
  };
};
// The in-app reminder honours the switch on both surfaces.
const checkInAppSwitch = (src: Sources) => {
  const home = src.get("src/app/individual/_components/professional/HomeReminders.tsx") ?? "";
  const ev = src.get("src/app/individual/(app)/[experience]/(professional)/evidence/page.tsx") ?? "";
  return { ok: home.includes("if (!prefs.inApp) return null") && ev.includes("const due = prefs.inApp ? dueRenewals("), detail: "HomeReminders and the evidence page must gate on prefs.inApp" };
};
// 374: in-app NOT NULL DEFAULT TRUE, email NOT NULL DEFAULT FALSE, on the own profile row, no estate table.
// ── T. TAXONOMY SUGGESTIONS (COMPETEN-CONFIG-002 item 8) ────────────────────────────────────────────
// Profession and registration body are offered the migration 013 vocabularies as a datalist and stay free
// text: an <input> with no pattern, never a <select>. The suggestion reader never writes the vocabularies.
const checkFreeTextSuggestions = (src: Sources) => {
  const page = src.get("src/app/individual/(app)/[experience]/(professional)/registration/page.tsx") ?? "";
  const lib = src.get("src/lib/individual/professional/suggestions.ts") ?? "";
  const field = (id: string) => (page.match(new RegExp(`<input id="${id}"[^>]*>`)) ?? [""])[0];
  const prof = field("pr-prof"), body = field("pr-body");
  const free = [prof, body].every(f => f && !/\bpattern=|\brequired\b/.test(f) && /list=\{/.test(f)) && !/<select[^>]*name="(profession|registrationBody)"/.test(page);
  const readOnly = /\.from\("taxonomies"\)\.select\(/.test(lib) && /\.from\("taxonomy_terms"\)\.select\(/.test(lib) && !/\.(insert|upsert|update|delete)\(/.test(lib);
  return { ok: free && readOnly && page.includes("loadSuggestions(ctx.admin)"), detail: `free text ${free}, read-only ${readOnly}` };
};
const checkPrefsSchema = (mig: string) => ({
  ok: /alter table individual_professional_profile\s+add column if not exists reminder_in_app boolean not null default true/.test(mig)
    && /alter table individual_professional_profile\s+add column if not exists reminder_email boolean not null default false/.test(mig)
    && !/notification_preferences|insert into notifications/.test(mig.replace(/comment on column[\s\S]*?;/g, "")),
  detail: "374 must add reminder_in_app default true and reminder_email default false to the own profile, and touch no estate table",
});

function main() {
  console.log("INDIVIDUAL PROFESSIONAL HARNESS (COMPETEN-IND-007)\n");
  const run = (name: string, r: { ok: boolean; detail: string }) => ok(name, r.ok, r.detail);

  ok("0a. the Professional source was found", ALL.has("src/lib/individual/professional/record.ts"));
  // Migration 373 is committed only once the owner confirms it applied (CLAUDE.md). A checkout without the
  // draft reports the schema groups as PEND -- neither passed nor failed on nothing.
  const pend: string[] = [];
  const schema = MIG ? run : (name: string) => { pend.push(name); console.log(`  PEND  ${name} -- ${MIG_FILE} is not in this checkout`); };
  ok("0b. ⚠ the comment strip kept real code -- a real write survives it",
    /from\("individual_professional_cpd"\)\s*\.insert\(/.test(ALL.get("src/app/api/individual/professional/cpd/route.ts") ?? ""));

  run("W1. every Professional write sits in its one pinned file", checkWritesPinned(ALL));
  run("W2. no Professional code writes cpd_logs, professional_credentials or any estate table (passport_share_tokens only in share.ts)", checkNoEstateWrite(ALL));
  run("W3. ⚠ control: every pinned write is actually seen, so W1 is not vacuous", checkWritesSeen(ALL));
  run("W4. no Professional code even reads the estate CPD, evidence or reminder tables employers read", checkNoEstateLearningTouch(ALL));

  run("R1. the individual_professional_* tables are read only by Professional code", checkTablesReadOnlyByProfessional(ALL));
  run("R2. Professional code is imported only by the Individual shell, the consented /verify page and the reminder job", checkImporters(ALL));
  run("R3. the platform job runner imports the reminder module and nothing else of Professional", checkJobImportsRemindersOnly(ALL));
  run("R4. the private document bucket is named in one place only", checkBucketPrivate(ALL));
  schema("R5. no 373 table has a hospital, organisation, tenant or workspace column to scope an employer read by", checkNoScopeColumns(MIG));

  schema("E1. the schema GENERATES the class from the document, and no 373 table stores a verified flag", checkGeneratedClass(MIG));
  run("E2. the two own classes are labelled, and each label says not verified", checkLabels(EVIDENCE_LABEL));
  run("E3. the Passport items carry the right class per row, drop a class Professional cannot create, and leak no private text", checkPassportItems(ownRecordsFrom));
  run("E4. the rendered class label says not verified, and renders nothing for any other class",
    checkRenderedLabel(v => renderToStaticMarkup(createElement(ClassLabel, { value: v }))));
  run("E5. /verify shows own records only with the release gate on and the companion row, labelled by class, without the 'Verified' header", checkVerifyPage(ALL));
  run("E6. no Professional file names a verified class or sets a verified flag", checkNoVerifiedClassInProfessional(ALL));
  run("F1. only shared, active, PUBLISHED frameworks are offered, and only they are accepted on write", checkPublishedFrameworks(ALL));

  run("N1. no Professional file names notifications, notification_preferences, notif_deliveries or cdp_reminders", checkNoEstateNotifications(ALL));
  run("N2. email reminders go only to people who opted in (reminder_email = true), by email only", checkEmailOptIn(ALL));
  run("N3. the in-app reminder honours the in-app switch on the home and evidence pages", checkInAppSwitch(ALL));
  run("N5. a failed or skipped email does not consume the once-only reminder: the claim is released", checkClaimReleasedOnFailure(ALL));
  if (MIG374) run("N4. 374: in-app defaults ON, email defaults OFF, both NOT NULL, on the own profile row, no estate table", checkPrefsSchema(MIG374));
  else { pend.push("N4"); console.log(`  PEND  N4. ${MIG374_FILE} is not in this checkout`); }

  run("T1. profession and registration body offer the migration 013 vocabularies and stay free text, read-only", checkFreeTextSuggestions(ALL));
  run("D1. direct entry: every Professional API handler and page asks for Professional, never Scholar", checkDirectEntry(ALL));

  schema("S1. D6: RLS on, own-row SELECT only, no write policy, experience_code with no default -- on every 373 table", checkRls(MIG));
  schema("S2. cross-person links are unrepresentable: composite FKs and owner-prefixed document paths", checkCrossPersonLinks(MIG));

  // ── P. PLANTED FAILURES -- each check must go red on a copy with one violation in it ─────────────
  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const plant = (f: string, add: string): Sources => { const c = new Map(ALL); c.set(f, (c.get(f) ?? "") + `\n${add}\n`); return c; };
  const red = (name: string, r: { ok: boolean }) => ok(`P. ${name} goes RED`, !r.ok);
  const redSchema = MIG ? red : (name: string) => { pend.push(`P. ${name}`); };
  red("W1 on an unpinned write", checkWritesPinned(plant("src/lib/individual/professional/record.ts", `admin.from("individual_professional_need").insert({})`)));
  red("W2 on a cpd_logs write", checkNoEstateWrite(plant("src/app/api/individual/professional/cpd/route.ts", `admin.from("cpd_logs").insert({})`)));
  red("W2 on a professional_credentials write", checkNoEstateWrite(plant("src/lib/individual/professional/share.ts", `admin.from("professional_credentials").update({})`)));
  red("W2 on passport_share_tokens outside share.ts", checkNoEstateWrite(plant("src/app/api/individual/professional/share/route.ts", `admin.from("passport_share_tokens").insert({})`)));
  red("W1 on a dynamic table name", checkWritesPinned(plant("src/lib/individual/professional/record.ts", `admin.from(table).delete()`)));
  red("W1 on the estate evidence bucket", checkWritesPinned(plant("src/lib/individual/professional/documents.ts", `admin.storage.from("evidence").upload(p, b)`)));
  red("W3 when a pinned write disappears", checkWritesSeen(new Map([...ALL].map(([f, s]) => [f, f.endsWith("cpd/route.ts") ? s.replace(/individual_professional_cpd"\)\s*\.delete/g, "x\").select") : s]))));
  red("W4 on a cpd_logs read", checkNoEstateLearningTouch(plant("src/app/individual/(app)/[experience]/(professional)/cpd/page.tsx", `admin.from("cpd_logs").select("*")`)));
  red("R1 on an educator page reading Professional CPD", checkTablesReadOnlyByProfessional(plant("src/app/educator/page.tsx", `admin.from("individual_professional_cpd").select("*")`)));
  red("R2 on a dashboard importing the record reader", checkImporters(plant("src/app/dashboard/cpd/page.tsx", `import { loadProfessionalRecord } from "@/lib/individual/professional/record";`)));
  red("R3 on the job runner importing the record reader", checkJobImportsRemindersOnly(plant("src/lib/platform/jobs.ts", `import { x } from "@/lib/individual/professional/record";`)));
  red("R4 on a second file naming the bucket", checkBucketPrivate(plant("src/app/educator/page.tsx", `"${DOCUMENT_BUCKET}"`)));
  redSchema("R5 on a hospital_id column", checkNoScopeColumns(MIG.replace("create table if not exists individual_professional_cpd (", "create table if not exists individual_professional_cpd (\n  hospital_id uuid,")));
  redSchema("E1 on a verified column", checkGeneratedClass(MIG.replace("create table if not exists individual_professional_evidence (", "create table if not exists individual_professional_evidence (\n  verified boolean,")));
  redSchema("E1 on a stored, writable class", checkGeneratedClass(MIG.replace(/evidence_class text generated always as/, "evidence_class text, x text generated always as")));
  red("E2 on a label that says Verified", checkLabels({ ...EVIDENCE_LABEL, source_linked: "Verified with a document" }));
  red("E3 when a foreign class passes through", checkPassportItems(r => (ownRecordsFrom(r) ?? []).concat([{ kind: "credential", title: "Forged", detail: null, date: null, expires: null, evidence: "independently_verified" as never }])));
  red("E3 when private text leaks", checkPassportItems(r => (ownRecordsFrom(r) ?? []).map(i => i.kind === "credential" ? { ...i, detail: "private detail" } : i)));
  red("E4 when a foreign class renders", checkRenderedLabel(v => v === "institution_verified" ? "<span>Verified</span>" : renderToStaticMarkup(createElement(ClassLabel, { value: v }))));
  red("E5 without the release gate", checkVerifyPage(new Map([...ALL].map(([f, s]) => [f, f === "src/app/verify/[token]/page.tsx" ? s.replace("(await individualAppEnabled(admin)) && await shareCarriesOwnRecords(admin, share.id, share.nurse_id)", "await shareCarriesOwnRecords(admin, share.id, share.nurse_id)") : s]))));
  red("N1 on a write to notifications", checkNoEstateNotifications(plant("src/lib/individual/professional/reminders.ts", `admin.from("notifications").insert({})`)));
  red("N1 on reading notification_preferences", checkNoEstateNotifications(plant("src/lib/individual/professional/preferences.ts", `admin.from("notification_preferences").select("email")`)));
  red("N2 without the opt-in filter", checkEmailOptIn(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/reminders.ts") ? s.replace(`.eq("reminder_email", true)`, "") : s]))));
  red("N2 on an in-app channel", checkEmailOptIn(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/reminders.ts") ? s.replace(`["email"])`, `["in_app", "email"])`) : s]))));
  red("N5 when any attempt counts as sent", checkClaimReleasedOnFailure(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/reminders.ts") ? s.replace("if (result.sent) {", "if (result.sent || true) {") : s]))));
  red("N5 without the release", checkClaimReleasedOnFailure(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/reminders.ts") ? s.replace("update({ expiry_reminded_for: c.prior })", "select()") : s]))));
  red("N5 when a skipped email counts as delivered", checkClaimReleasedOnFailure(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/reminders.ts") ? s.replace(`email?.status === "sent" ?`, `email?.status !== "failed" ?`) : s]))));
  red("N3 when home ignores the switch", checkInAppSwitch(new Map([...ALL].map(([f, s]) => [f, f.endsWith("HomeReminders.tsx") ? s.replace("if (!prefs.inApp) return null", "") : s]))));
  if (MIG374) red("N4 on email defaulting ON", checkPrefsSchema(MIG374.replace("reminder_email boolean not null default false", "reminder_email boolean not null default true")));
  const regFile = "src/app/individual/(app)/[experience]/(professional)/registration/page.tsx";
  red("T1 on a profession restricted to the list", checkFreeTextSuggestions(new Map([...ALL].map(([f, s]) => [f, f === regFile ? s.replace(`<input id="pr-prof" name="profession"`, `<input id="pr-prof" pattern="(Nursing|Medicine)" name="profession"`) : s]))));
  red("T1 on a suggestion reader that writes", checkFreeTextSuggestions(plant("src/lib/individual/professional/suggestions.ts", `admin.from("taxonomy_terms").insert({})`)));
  red("E6 on a verified flag", checkNoVerifiedClassInProfessional(plant("src/app/api/individual/professional/evidence/route.ts", `const row = { verified: true };`)));
  const fwFile = "src/lib/individual/professional/frameworks.ts";
  red("F1 when the list offers drafts", checkPublishedFrameworks(new Map([...ALL].map(([f, s]) => [f, f === fwFile ? s.replace(`.eq("is_active", true).eq("pub_status", PUBLISHED).order(`, `.eq("is_active", true).order(`) : s]))));
  red("F1 when a write accepts a draft", checkPublishedFrameworks(new Map([...ALL].map(([f, s]) => [f, f === fwFile ? s.replace(`.eq("pub_status", PUBLISHED).maybeSingle()`, ".maybeSingle()") : s]))));
  red("D1 when Scholar lists a Professional segment", (() => { const sch = EXPERIENCES.scholar.modules as unknown as { segment: string }[]; sch.push({ segment: "cpd" }); try { return checkDirectEntry(ALL); } finally { sch.pop(); } })());
  red("D1 on a Scholar guard", checkDirectEntry(new Map([...ALL].map(([f, s]) => [f, f.endsWith("professional/cpd/route.ts") ? s.replace('requireIndividualContext("professional")', 'requireIndividualContext("scholar")') : s]))));
  red("D1 on a page without the Professional check", checkDirectEntry(new Map([...ALL].map(([f, s]) => [f, f.endsWith("(professional)/progress/page.tsx") ? s.replace("await experienceModulePage((await params).experience, \"progress\")", "await experiencePage((await params).experience)") : s]))));
  redSchema("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_professional_cpd for insert with check (true)"));
  redSchema("S1 on a defaulted origin", checkRls(MIG.replace("experience_code text not null,", "experience_code text not null default 'professional',")));
  redSchema("S2 on a single-column need link", checkCrossPersonLinks(MIG.replace("foreign key (need_id, user_id) references individual_professional_need(id, user_id) on delete set null (need_id)", "foreign key (need_id) references individual_professional_need(id)")));

  console.log(`\n${failures.length ? "RED" : pend.length ? "GREEN, SCHEMA PENDING" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed${pend.length ? `, ${pend.length} pending (migration 373 draft absent)` : ""}`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
