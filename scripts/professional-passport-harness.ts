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
  const sources = /trust: verified \? "independently_verified"/.test(lib) && /trust: "independently_verified", validity: expiryValidity\(a\.validUntil/.test(lib)
    && /trust: c\.evidence === "institution_verified" \? "independently_verified" : "assessed"/.test(lib);
  const notConfigurable = !POLICIES.some(p => /trust/.test(p.key)) && /independently_verified: "Independently verified"/.test(src.get(VOCAB) ?? "");
  return { ok: sources && verifiedAt === 3 && notConfigurable, detail: `only verifier, C5 and staff-verified ${sources}, mentions ${verifiedAt}/3, trust words fixed ${notConfigurable}` };
};

// ── P ──
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
  red("P1 on a reflection path onto a view", checkPrivacy(add(VIEW, `admin.from("individual_professional_reflection").select("body");`)));
  red("P1 on Passport AI that shares", checkPrivacy(add(AI, "await activateShare(ctx.admin, ctx.userId, id);")));
  red("H1 on a hard-coded country", checkNoHardcoding(add(VOCAB, `export const COUNTRY = "Uganda";`)));

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
