/**
 * LIFELONG PASSPORT HARNESS -- COMPETEN-PROFESSIONAL-PASSPORT-01, Professional Stage 7 (migration 540).
 * Pure/local: reads source and the migration. No database, no network.
 *
 *   S  schema: own-row RLS on every 540 table, no write policy; a view is a draft until activated and then fixed; a
 *      live link can narrow but never widen; the access log is append-only and names nobody; every reference is a
 *      composite key, so another person's link or record is unrepresentable.
 *   R  record-level only: /verify shows a Professional link's records only through the one read the owner previews;
 *      the person's own CPD, evidence and Scholar items appear only when chosen for that link; a link with no view
 *      carries none; nothing loads "every own record" on /verify.
 *   D  drafts and minimum disclosure: a view is minted closed (consent false) and opens only by activation; /verify
 *      looks a link up by its token alone, serves no document, and logs only what it answered.
 *   T  trust never upgraded: only an appointed verifier's state, a current C5 outcome or a staff-verified credential is
 *      "independently verified"; trust words are not configurable.
 *   P  privacy: reflections, AI conversations and plans have no path onto a view; Passport AI saves and shares nothing.
 *   H  nothing hard-codes a profession or a country.
 *
 * Every check is proven able to fail: section X plants one violation per check, in memory, and expects RED.
 *
 *   npx tsx scripts/professional-passport-harness.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { POLICIES } from "../src/lib/individual/policy";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
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
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
type Sources = Map<string, string>;
const ALL: Sources = new Map(walk("src").map(p => p.replace(/\\/g, "/")).map(f => [f, strip(readFileSync(f, "utf8")).replace(/\r\n/g, "\n")]));
const MIG_FILE = "supabase/migrations/540-individual-passport-share-views.sql";
const MIG = existsSync(MIG_FILE) ? readFileSync(MIG_FILE, "utf8").replace(/--.*$/gm, "").toLowerCase().replace(/\r\n/g, "\n") : "";
const VIEW = "src/lib/individual/passport-view.ts", VOCAB = "src/lib/individual/passport-vocabulary.ts";
const SHARE = "src/lib/individual/professional/share.ts", FORM = "src/lib/individual/professional/share-passport.ts";
const VERIFY = "src/app/verify/[token]/page.tsx", RENDER = "src/app/individual/_components/passport/PassportLinkView.tsx";
const AI = "src/app/api/individual/professional/passport-suggestions/route.ts", ROUTE = "src/app/api/individual/professional/share/route.ts";
const ADAPTER = "src/lib/individual/professional/competency-verification.ts", SHARE_COMP = "src/lib/individual/professional/share-competency.ts";
const PREVIEW = "src/app/individual/(app)/[experience]/(professional)/share/preview/page.tsx";
const STAGE7_FILES = [VIEW, VOCAB, FORM, RENDER, AI, PREVIEW];
const TABLES = ["individual_passport_share_view", "individual_passport_share_record", "individual_passport_share_access"];

// ── S ──
const checkRls = (m: string): R => {
  const bad = TABLES.filter(t => !m.includes(`alter table ${t} enable row level security`) || !new RegExp(`create policy ${t}_read_own on ${t}\\s+for select using \\(auth\\.uid\\(\\) = user_id\\)`).test(m));
  const write = /create policy [a-z_]+ on individual_passport_[a-z_]+\s+for (insert|update|delete|all)/.test(m);
  return { ok: bad.length === 0 && !write, detail: `${bad.join(",")}${write ? " write-policy" : ""}` };
};
const checkDraftAndNarrow = (m: string): R => {
  const fixed = /if old\.activated_at is not null then\s+raise exception 'individual_passport_share_view is active and fixed/.test(m)
    && /before update or delete on individual_passport_share_view\s+for each row execute function individual_passport_share_view_guard\(\)/.test(m);
  const narrow = /if exists \(select 1 from individual_passport_share_view v where v\.share_token_id = new\.share_token_id and v\.activated_at is not null\) then\s+raise exception 'this link is active: a record can be taken off it, never added'/.test(m)
    && /before insert or update on individual_passport_share_record\s+for each row execute function individual_passport_share_record_guard\(\)/.test(m);
  const log = /before update or delete on individual_passport_share_access\s+for each row execute function individual_passport_share_access_append_only\(\)/.test(m)
    && /if tg_op = 'delete' and pg_trigger_depth\(\) > 1 then\s+return old;/.test(m) && /check \(result in \('shown', 'refused_revoked', 'refused_expired', 'refused_draft'\)\)/.test(m);
  return { ok: fixed && narrow && log, detail: `active view fixed ${fixed}, live link narrows never widens ${narrow}, append-only log ${log}` };
};
const checkComposite = (m: string): R => {
  const refs = [/foreign key \(share_token_id, user_id\) references passport_share_tokens\(id, nurse_id\)/g, /foreign key \(share_token_id, user_id\) references individual_passport_share_view\(share_token_id, user_id\)/,
    /foreign key \(cpd_id, user_id\) references individual_professional_cpd\(id, user_id\)/, /foreign key \(evidence_id, user_id\) references individual_professional_evidence\(id, user_id\)/,
    /foreign key \(study_item_id, user_id\) references individual_scholar_passport_item\(id, user_id\)/, /foreign key \(scholar_evaluation_id, user_id\) references individual_scholar_passport_evaluation\(id, user_id\)/];
  const tokenRefs = (m.match(refs[0]) ?? []).length === 2;
  const missing = refs.slice(1).filter(r => !r.test(m)).length;
  const one = /\(\(cpd_id is not null\)::int \+ \(evidence_id is not null\)::int \+ \(study_item_id is not null\)::int \+ \(scholar_evaluation_id is not null\)::int\) = 1/.test(m);
  const anon = !/\b(ip|ip_address|user_agent|recipient_email|viewer_id|country)\b/.test(m.slice(m.indexOf("create table if not exists individual_passport_share_access")));
  return { ok: tokenRefs && missing === 0 && one && anon, detail: `token keys 2 ${tokenRefs}, other composite keys missing ${missing}, exactly one record ${one}, log names nobody ${anon}` };
};

// ── R ──
const checkRecordLevel = (src: Sources): R => {
  const v = src.get(VERIFY) ?? "";
  const viaRead = /await loadPassportSelection\(admin, share\.nurse_id, share\.id,/.test(v) && /<PassportLinkView selection=\{selection\}/.test(v);
  const neverAll = !/loadOwnRecords|loadStudyAchievements|loadPassportEvaluations|loadSharedProfile|loadSharedLearning|loadSharedCompetencies/.test(v);
  const noView = /if \(meta === null\) return <Invalid/.test(v);
  const lib = src.get(VIEW) ?? "";
  const chosenOnly = /\(record\?\.cpd \?\? \[\]\)\.filter\(c => cpdIds\.has\(c\.id\)\)/.test(lib) && /\(record\?\.evidence \?\? \[\]\)\.filter\(e => evIds\.has\(e\.id\)\)/.test(lib)
    && /passport\.study\.data\.filter\(s => s\.itemId && studyIds\.has\(s\.itemId\)\)/.test(lib) && /passport\.evaluations\.data\.filter\(v => v\.itemId && evalIds\.has\(v\.itemId\)\)/.test(lib);
  const onlyWithView = lib.indexOf("if (meta) {") > 0 && lib.indexOf("if (meta) {") < lib.indexOf("individual_passport_share_record") && /if \(passport && meta\.includeInstitution\)/.test(lib);
  const preview = /await loadPassportSelection\(ctx\.admin, ctx\.userId, link\.id,/.test(src.get(PREVIEW) ?? "") && /<PassportLinkView selection=\{selection\}/.test(src.get(PREVIEW) ?? "");
  return { ok: viaRead && neverAll && noView && chosenOnly && onlyWithView && preview, detail: `verify via the one read ${viaRead}, never every record ${neverAll}, no view carries nothing ${noView}, chosen ids only ${chosenOnly}, own records only with a view ${onlyWithView}, preview is the same read ${preview}` };
};

// ── D ──
const checkDraftsAndDisclosure = (src: Sources): R => {
  const s = src.get(SHARE) ?? "";
  const closed = /consent: !view, revoked: false/.test(s);
  const activate = /from\("individual_passport_share_view"\)\.update\(\{ activated_at:[^\n]*\n\s+\.eq\("share_token_id", id\)\.eq\("user_id", userId\)\.is\("activated_at", null\)/.test(s)
    && /from\("passport_share_tokens"\)\.update\(\{ consent: true \}\)\.eq\("id", id\)\.eq\("nurse_id", userId\)/.test(s);
  const v = src.get(VERIFY) ?? "";
  const refused = /if \(share\.consent === false\) \{/.test(v) && /logShareAccess\(admin, share\.id, share\.nurse_id, "refused_draft"\)/.test(v);
  const tokenOnly = (v.match(/from\("passport_share_tokens"\)\.select\(/g) ?? []).length === 1 && /\.eq\("token", token\)\.maybeSingle\(\)/.test(v);
  const noDocs = !/document_path|storage\.from/.test(src.get(VIEW) ?? "") && !/document_path|storage\.from/.test(v);
  const logOnly = /insert\(\{ share_token_id: tokenId, user_id: userId, result \}\)/.test(s);
  return { ok: closed && activate && refused && tokenOnly && noDocs && logOnly, detail: `minted closed ${closed}, activation opens it once ${activate}, draft refused and logged ${refused}, looked up by token alone ${tokenOnly}, no document served ${noDocs}, log holds only the answer ${logOnly}` };
};

// ── T ──
const checkTrust = (src: Sources): R => {
  const lib = src.get(VIEW) ?? "";
  const verifiedAt = [...lib.matchAll(/independently_verified/g)].length;
  const sources = /trust: verified \? "independently_verified"/.test(lib) && /trust: a\.verified \? "independently_verified" : "assessed", validity: expiryValidity\(a\.validUntil/.test(lib)
    && /trust: c\.evidence === "institution_verified" \? "independently_verified" : "assessed"/.test(lib);
  // C5: "verified" is current AND of class verified AND at a level -- the class, never the per-method outcome code.
  const adapter = src.get(ADAPTER) ?? "";
  const byClass = /export const verifiedNow = \(d: VerificationDecision, today: string\) => currentDecision\(d, today\) && d\.outcomeClass === "verified" && !!d\.level;/.test(adapter)
    && /\(d\.outcomeClass === "verified" \|\| d\.outcomeClass === "partial"\)\n  && \(d\.standing \? d\.standing === "current"/.test(adapter)
    && !/outcomeCode\s*(===|!==|==)/.test(adapter + (src.get(SHARE_COMP) ?? "") + lib)
    && /verified: verifiedNow\(d, today\)/.test(src.get(SHARE_COMP) ?? "");
  const notConfigurable = !POLICIES.some(p => /trust/.test(p.key)) && /independently_verified: "Independently verified"/.test(src.get(VOCAB) ?? "");
  return { ok: sources && byClass && verifiedAt === 3 && notConfigurable, detail: `only verifier, C5 and staff-verified ${sources}, C5 verified by class at a level ${byClass}, mentions ${verifiedAt}/3, trust words fixed ${notConfigurable}` };
};

// ── P ──
// ── E (Stage 6 evaluations, 530) ──
// Agreed with Stage 6: the evaluations a person ticks are saved INSIDE mintShare, under its withdraw-on-failure block,
// never after it by the route; and the view shows them as formative ("educational"), from Stage 6's own read.
const checkEvaluations = (src: Sources): R => {
  const share = src.get(SHARE) ?? "", route = src.get(ROUTE) ?? "", lib = src.get(VIEW) ?? "";
  const inside = /const evalOk = linkErr \|\| itemErr \|\| learnErr \|\| compErr \|\| viewErr \|\| recErr \? false\n\s*: !evaluationIds\.length \|\| await \(await import\("\.\/share-evaluation"\)\)\.saveShareEvaluations\(admin, userId, share\.id, evaluationIds\);/.test(share)
    // policy.ts imports share.ts: a static import of Stage 6's writer here closes a cycle that breaks /verify at load.
    && !/^import [^\n]*"\.\/share-evaluation"/m.test(share)
    && /if \(linkErr \|\| itemErr \|\| learnErr \|\| compErr \|\| viewErr \|\| recErr \|\| !evalOk\) \{/.test(share);
  const notAfter = !/saveShareEvaluations/.test(route) && /mintShare\(ctx\.admin, ctx\.userId, input, profile, learningIds, competencies, view\.value, evaluationIds\)/.test(route)
    && route.indexOf("checkShareEvaluations(") > -1 && route.indexOf("checkShareEvaluations(") < route.indexOf("mintShare(");
  const formative = /sharedEvaluationsFor\(admin, shareTokenId, userId\)/.test(lib) && /category: "evaluation", sourceService: "Competen Professional evaluation"[\s\S]{0,700}trust: "educational", validity: "not_applicable"/.test(lib)
    && !/ai_text|notes/.test(lib.slice(lib.indexOf("evaluation:530"), lib.indexOf("evaluation:530") + 900));
  return { ok: inside && notAfter && formative, detail: `saved inside mintShare under its withdrawal ${inside}, checked before and never saved after by the route ${notAfter}, shown as formative from Stage 6's read ${formative}` };
};

// ── SC (PRODUCT-EXPERIENCE P4, owner Option A): SHARING FROM SCHOLAR ──
// A Scholar link is the same Passport link, made in Scholar: only formative Scholar records already on the person's
// Passport, ticked one by one, as a draft; only their own Scholar links are activated or withdrawn; nothing reads a
// note, a question, an answer, AI output or a reflection on the way.
const SC_ROUTE = "src/app/api/individual/scholar/passport-share/route.ts";
const SC_PAGES = ["src/app/individual/(app)/[experience]/passport/share/page.tsx", "src/app/individual/(app)/[experience]/passport/share/preview/page.tsx"];
const checkScholarShare = (src: Sources): R => {
  const r = src.get(SC_ROUTE) ?? "", form = src.get(FORM) ?? "";
  const post = r.slice(r.indexOf("export async function POST"), r.indexOf("export async function PATCH"));
  const patch = r.slice(r.indexOf("export async function PATCH"));
  const guarded = [post, patch].every(h => /^export async function (POST|PATCH)\(req: Request\) \{\n\s*const ctx = await requireIndividualContext\("scholar"\);\n\s*if \(isGuardRefusal\(ctx\)\) return ctx;/.test(h));
  const onlyScholar = /export const SCHOLAR_RECORD_KINDS: readonly PassportRecordRef\["kind"\]\[\] = \["study", "scholar_evaluation"\];/.test(form)
    && /if \(!v\.records\.length\) return/.test(form) && /if \(v\.records\.some\(r => !SCHOLAR_RECORD_KINDS\.includes\(r\.kind\)\)\) return/.test(form) && /if \(v\.includeInstitution\) return/.test(form)
    && post.indexOf("scholarViewRefusal(") > -1 && post.indexOf("scholarViewRefusal(") < post.indexOf("mintShare(");
  const onPassport = /const recErr = await checkPassportRecords\(ctx\.admin, ctx\.userId, view\.value\.records, \{/.test(post) && post.indexOf("checkPassportRecords(") < post.indexOf("mintShare(");
  const minted = /mintShare\(ctx\.admin, ctx\.userId, input, \{ overview: false, itemIds: \[\] \}, \[\], \[\], view\.value, \[\], "scholar"\)/.test(post);
  const ownLinks = /const mine = await listShares\(ctx\.admin, ctx\.userId, "scholar"\);/.test(patch) && /if \(!mine\.some\(l => l\.id === id\)\) return refuse/.test(patch)
    && patch.indexOf("mine.some(") < patch.indexOf("activateShare(") && patch.indexOf("mine.some(") < patch.indexOf("revokeShare(");
  const blind = [r, ...SC_PAGES.map(f => src.get(f) ?? "")].every(s => s.length > 100
    && !/individual_scholar_(chunk|question|attempt|material|note|chat|explain)|individual_[a-z_]*reflection|\.reflection\b|ai_text|askProfessionalAssistant|DraftSummary|\.from\(/.test(s));
  return { ok: guarded && onlyScholar && onPassport && minted && ownLinks && blind,
    detail: `Scholar-guarded ${guarded}, formative Scholar kinds only ${onlyScholar}, only records on the Passport ${onPassport}, minted as a Scholar draft ${minted}, own Scholar links only ${ownLinks}, reads no note, question, answer, AI or reflection ${blind}` };
};

const checkPrivacy = (src: Sources): R => {
  const form = src.get(FORM) ?? "";
  const kinds = /const RECORD_KINDS: readonly PassportRecordRef\["kind"\]\[\] = \["cpd", "evidence", "study", "scholar_evaluation"\];/.test(form);
  const noPrivate = STAGE7_FILES.concat(VERIFY).every(f => !/individual_professional_(reflection|learning_reflection|goal|need|activity)\b|plat_ai_requests|ai_conversation/.test(src.get(f) ?? ""));
  const ai = src.get(AI) ?? "";
  const aiSafe = /if \(policy\.ai !== "on"\) return refuse\(/.test(ai) && !/\.(insert|update|upsert|delete)\(|mintShare|activateShare/.test(ai.replace(/await audit\([^;]*;/g, "")) && /Do not invent any qualification/.test(ai);
  return { ok: kinds && noPrivate && aiSafe, detail: `only four own kinds ${kinds}, no reflection/plan/AI conversation read ${noPrivate}, AI gated, saves and shares nothing ${aiSafe}` };
};

// ── H ──
const checkNoHardcoding = (src: Sources): R => {
  const bad = STAGE7_FILES.filter(f => /uganda|\bnurs(e|es|ing)\b|midwi/i.test(src.get(f) ?? ""));
  return { ok: bad.length === 0 && STAGE7_FILES.every(f => src.has(f)), detail: `${bad.join(", ")}${STAGE7_FILES.filter(f => !src.has(f)).map(f => ` missing ${f}`).join("")}` };
};

function main() {
  console.log("LIFELONG PASSPORT HARNESS (COMPETEN-PROFESSIONAL-PASSPORT-01 Stage 7)\n");
  const run = (name: string, r: R) => ok(name, r.ok, r.detail);
  ok("0a. the Stage 7 source and migration 540 were found", !!MIG && ALL.has(VIEW));
  run("S1. own-row SELECT RLS on all three 540 tables, no write policy", checkRls(MIG));
  run("S2. a view is a draft until activated, then fixed; a live link narrows but never widens; the access log is append-only", checkDraftAndNarrow(MIG));
  run("S3. every reference is a composite key, one record per row, and the log names nobody", checkComposite(MIG));
  run("R1. record-level only: /verify and the preview use the one read; own records only as chosen for that link; a link with no view carries none", checkRecordLevel(ALL));
  run("D1. a view is minted closed and opens only by activation; /verify finds a link by token alone, serves no document and logs only its answer", checkDraftsAndDisclosure(ALL));
  run("T1. only a verifier's state, a current C5 outcome or a staff-verified credential is independently verified; trust words are not configurable", checkTrust(ALL));
  run("E1. Stage 6 evaluations are saved inside mintShare under its withdrawal, never after it by the route, and shown as formative", checkEvaluations(ALL));
  run("SC1. sharing from Scholar: Scholar-guarded, formative Scholar records on the Passport only, a Scholar draft, own links only, no notes, answers, AI or reflections", checkScholarShare(ALL));
  run("P1. reflections, plans and AI conversations have no path onto a view; Passport AI is gated and saves and shares nothing", checkPrivacy(ALL));
  run("H1. no profession or country hard-coded in the Stage 7 code", checkNoHardcoding(ALL));

  console.log("\n  planted-failure controls (in memory, nothing on disk changes):");
  const red = (name: string, r: R) => ok(`X. ${name} goes RED`, !r.ok, r.detail);
  const plant = (f: string, from: string | RegExp, to: string) => { const m = new Map(ALL); m.set(f, (m.get(f) ?? "").replace(from, to)); return m; };
  const add = (f: string, code: string) => { const m = new Map(ALL); m.set(f, `${m.get(f) ?? ""}\n${code}`); return m; };
  red("S1 on a write policy", checkRls(MIG + "\ncreate policy p on individual_passport_share_record for insert with check (true)"));
  red("S2 on a live link that may widen", checkDraftAndNarrow(MIG.replace("before insert or update on individual_passport_share_record", "before update on individual_passport_share_record")));
  red("S2 on an active view that may change", checkDraftAndNarrow(MIG.replace("if old.activated_at is not null then", "if false then")));
  red("S3 on a log that records the viewer", checkComposite(MIG.replace("  result text not null,\n  viewed_at", "  result text not null,\n  ip_address text,\n  viewed_at")));
  red("S3 on a single-column CPD reference", checkComposite(MIG.replace("foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id)", "foreign key (cpd_id) references individual_professional_cpd(id)")));
  red("R1 on /verify loading every own record", checkRecordLevel(add(VERIFY, "const all = await loadOwnRecords(admin, share.nurse_id);")));
  red("R1 on CPD shown whether chosen or not", checkRecordLevel(plant(VIEW, "(record?.cpd ?? []).filter(c => cpdIds.has(c.id))", "(record?.cpd ?? [])")));
  red("R1 on a link with no view showing records", checkRecordLevel(plant(VERIFY, "if (meta === null) return <Invalid", "if (false) return <Invalid")));
  red("D1 on a view minted open", checkDraftsAndDisclosure(plant(SHARE, "consent: !view, revoked: false", "consent: true, revoked: false")));
  red("D1 on /verify looking people up", checkDraftsAndDisclosure(add(VERIFY, `await admin.from("passport_share_tokens").select("token").eq("nurse_id", x);`)));
  red("D1 on a log that records more than the answer", checkDraftsAndDisclosure(plant(SHARE, "insert({ share_token_id: tokenId, user_id: userId, result })", "insert({ share_token_id: tokenId, user_id: userId, result, agent: ua })")));
  red("T1 on CPD shown as verified", checkTrust(plant(VIEW, `trust: c.evidence_class === "source_linked" ? "document_supported" : "self_declared", validity: "not_applicable", meaning: "A development activity`, `trust: "independently_verified", validity: "not_applicable", meaning: "A development activity`)));
  red("T1 on a C5 rule that reads the outcome code", checkTrust(plant(ADAPTER, '&& d.outcomeClass === "verified" && !!d.level;', '&& d.outcomeCode === "verified" && !!d.level;')));
  red("T1 on a partial outcome shown as verified", checkTrust(plant(VIEW, 'trust: a.verified ? "independently_verified" : "assessed"', 'trust: "independently_verified"')));
  red("T1 on a decision with no class counted as standing", checkTrust(plant(ADAPTER, '(d.outcomeClass === "verified" || d.outcomeClass === "partial")\n  && ', "")));
  red("T1 on a share that drops the verified test", checkTrust(plant(SHARE_COMP, "verified: verifiedNow(d, today)", "verified: true")));
  red("E1 on evaluations saved by the route after the mint", checkEvaluations(add(ROUTE, "await saveShareEvaluations(ctx.admin, ctx.userId, link.id, evaluationIds);")));
  red("E1 on a static import that closes the policy cycle", checkEvaluations(plant(SHARE, 'import { ORIGIN } from "./vocabulary";', 'import { ORIGIN } from "./vocabulary";\nimport { saveShareEvaluations } from "./share-evaluation";')));
  red("E1 on a link kept when its evaluations failed", checkEvaluations(plant(SHARE, "|| viewErr || recErr || !evalOk) {", "|| viewErr || recErr) {")));
  red("E1 on an evaluation shown as assessed", checkEvaluations(plant(VIEW, 'authority: null, trust: "educational", validity: "not_applicable",\n    meaning: ev.notices[0]', 'authority: null, trust: "assessed", validity: "not_applicable",\n    meaning: ev.notices[0]')));
  red("SC1 on a Scholar link carrying CPD", checkScholarShare(plant(FORM, 'SCHOLAR_RECORD_KINDS: readonly PassportRecordRef["kind"][] = ["study", "scholar_evaluation"]', 'SCHOLAR_RECORD_KINDS: readonly PassportRecordRef["kind"][] = ["study", "scholar_evaluation", "cpd"]')));
  red("SC1 on organisation records from Scholar", checkScholarShare(plant(FORM, "if (v.includeInstitution) return", "if (false) return")));
  red("SC1 on a record not on the Passport", checkScholarShare(plant(SC_ROUTE, "const recErr = await checkPassportRecords(ctx.admin, ctx.userId, view.value.records, {", "const recErr = null && await checkPassportRecords(ctx.admin, ctx.userId, view.value.records, {")));
  red("SC1 on someone else's link activated", checkScholarShare(plant(SC_ROUTE, "if (!mine.some(l => l.id === id)) return refuse", "if (false) return refuse")));
  red("SC1 on the share page reading the learner's notes", checkScholarShare(add(SC_PAGES[0], 'await ctx.admin.from("individual_scholar_chunk").select("content");')));
  red("SC1 on an unguarded Scholar route", checkScholarShare(plant(SC_ROUTE, 'const ctx = await requireIndividualContext("scholar");\n  if (isGuardRefusal(ctx)) return ctx;\n  const { fields } = await readBody(req);', 'const ctx = await requireIndividualContext();\n  if (isGuardRefusal(ctx)) return ctx;\n  const { fields } = await readBody(req);')));
  red("P1 on a reflection path onto a view", checkPrivacy(add(VIEW, `admin.from("individual_professional_reflection").select("body");`)));
  red("P1 on Passport AI that shares", checkPrivacy(add(AI, "await activateShare(ctx.admin, ctx.userId, id);")));
  red("H1 on a hard-coded country", checkNoHardcoding(add(VOCAB, `export const COUNTRY = "Uganda";`)));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
