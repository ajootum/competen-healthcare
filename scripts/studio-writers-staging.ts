/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CHECKLIST STUDIO, WRITERS AGAINST STAGING (S2 acceptance). Runs the REAL server writers and readers of src/lib/assessment/studio
 * through supabase-js (service role) on STAGING, with throwaway appointments and a throwaway family, then removes what it can.
 *
 *   npx tsx scripts/studio-writers-staging.ts
 *
 * WHAT STAYS BEHIND, AND WHY. asmt_definition_event is append-only, so the created / submitted / returned events of the throwaway
 * instrument stay as history rows that point at deleted versions. Nothing else is kept: the draft, the instrument, the family, its
 * counter and the appointments are deleted. It refuses production and never prints a key.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RULES_SCHEMA } from "../src/lib/assessment/core";
import { loadInstrumentVersion, loadTrail } from "../src/lib/assessment/studio/read";
import { createFirstVersion, createInstrument, deleteDraft, recordDecision, returnToDraft, approveVersion, saveContent, saveScoring, saveSettings, duplicateVersion } from "../src/lib/assessment/studio/write";
import { submitForReview, validateInstrument } from "../src/lib/assessment/studio/service";
import { normalizeContent } from "../src/lib/assessment/studio/assemble";
import { criterionMapping, readCriteria } from "../src/lib/assessment/adapters/scholar/criteria";
import { newKey } from "../src/lib/assessment/studio/vocab";
import type { EditorContent, EditorItem } from "../src/lib/assessment/studio/types";

const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";
const env = (() => {
  const out: Record<string, string> = {};
  for (const p of [resolve(process.cwd(), ".env.local"), "C:/Users/elish/Documents/Competen/competen-healthcare/.env.local"]) {
    if (existsSync(p)) for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in out)) out[m[1]] = m[2].trim().replace(/^"|"$/g, ""); }
  }
  return out;
})();
const URL_ = process.env.STAGING_SUPABASE_URL ?? env.STAGING_SUPABASE_URL ?? "";
const KEY = process.env.STAGING_SERVICE_ROLE_KEY ?? env.STAGING_SERVICE_ROLE_KEY ?? "";
const DB = process.env.STAGING_DB_URL ?? env.STAGING_DB_URL ?? "";
if (!URL_ || !KEY || !DB) throw new Error("STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY and STAGING_DB_URL are needed");
if (URL_.includes(PRODUCTION_REF) || DB.includes(PRODUCTION_REF)) throw new Error("REFUSING: that is PRODUCTION");

let bad = 0;
const ok = (id: string, name: string, cond: boolean, ev = "") => { if (!cond) bad++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${id}. ${name}${cond ? "" : ev ? ` -- ${ev}` : ""}`); };
const sig = (c: EditorContent) => JSON.stringify({ s: c.sections.map((s) => [s.stable_key, s.title, s.position]), i: c.items.map((i) => [i.stable_key, i.prompt, i.position, i.section_key, i.response_type, i.mandatory, i.critical, i.group_code, (i.fields ?? []).map((f) => f.field_key), i.mapping?.ref_id ?? null]), g: c.groups.map((g) => g.code) });

async function main() {
  const admin: any = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const pg = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const appts: string[] = [];
  let instrumentId: string | null = null;
  try {
    const owner = (await pg.query("select p.id from profiles p where hq_actor_is_owner(p.id) order by p.id limit 1")).rows[0]?.id;
    const office = (await pg.query("select id from ogs_offices where office_type = 'hq_quality' limit 1")).rows[0]?.id;
    const people = (await pg.query("select p.id from profiles p where not exists (select 1 from ogs_office_appointments a where a.person_id = p.id) and not hq_actor_is_owner(p.id) order by p.id limit 3")).rows.map((r: any) => r.id);
    if (!owner || !office || people.length < 3) throw new Error("needs an owner, the hq_quality office and 3 profiles without an appointment");
    const [A, B] = people;
    for (const [person, role] of [[A, "assessment_studio_author"], [B, "assessment_studio_reviewer"]] as const) {
      const r = await pg.query("insert into ogs_office_appointments (office_id, person_id, person_name, role, status, authorised_by, authorised_at) values ($1,$2,'studio writers proof',$3,'active',$4,now()) returning id", [office, person, role, owner]);
      appts.push(r.rows[0].id);
    }
    await pg.query("insert into asmt_instrument_family (code, label) values ('ZQT', 'Studio writers proof') on conflict (code) do nothing");

    console.log("\nstudio writers on STAGING (real writers, throwaway data)\n");
    const created = await createInstrument(admin, A, { family: "ZQT", name: "Writers proof checklist", description: "proof", purpose: "formative", methods: ["self_assessment"], deliveryModes: [], respondentRoles: ["self"] });
    ok("W1", "createInstrument registers the code and starts version 1 as a draft", created.ok && /^ZQT-\d{6}$/.test((created as any).code), JSON.stringify(created));
    if (!created.ok) return;
    instrumentId = created.instrumentId;
    const vid = created.versionId;
    const first = await createFirstVersion(admin, A, instrumentId, { purpose: "formative" });
    ok("W1b", "createFirstVersion refuses an instrument that already has a version", !first.ok && (first as any).status === 409);

    // content: sections, group, items (yes/no, multiple choice with a secondary field, a mapped item)
    const crit = (await readCriteria(admin, "NUR-CCF"))[0];
    ok("W2", "the criterion picker read returns rows", !!crit);
    const s1 = newKey(), s2 = newKey();
    const mk = (n: number, sec: string, over: Partial<EditorItem> = {}): EditorItem => ({
      stable_key: newKey(), section_key: sec, code: `W${n}`, prompt: `Prompt ${n}`, guidance: null, expected_performance: [], response_type: "yes_no", scale_version_id: null, scale: null, config: {}, fields: [],
      group_code: null, method_codes: [], method_rule: "any", mandatory: false, critical: false, critical_requirements: [], evidence_requirement: null, weight: 1, references_text: null, position: n, mapping: null, ...over,
    });
    const i1 = mk(1, s1, { mandatory: true, critical: true, critical_requirements: ["must_be_satisfactory"], group_code: "g1" });
    const i2 = mk(2, s1, { response_type: "multiple_choice", config: { select: "single", options: [{ code: "y", label: "Yes", satisfactory: true, credit: 1 }, { code: "n", label: "No", satisfactory: false, credit: 0 }] },
      fields: [{ field_key: "note", label: "Note", response_type: "free_text", scale_version_id: null, scale: null, config: {}, required: false, position: 1 }] });
    const i3 = mk(3, s2, { prompt: crit.wording, mapping: criterionMapping(crit), mandatory: true });
    const c1: EditorContent = normalizeContent({ groups: [{ code: "g1", label: "Group one", weight: 1, position: 1, source_ref: null }],
      sections: [{ stable_key: s1, parent_section_key: null, title: "First", guidance: null, weight: 1, position: 1 }, { stable_key: s2, parent_section_key: null, title: "Second", guidance: null, weight: 1, position: 2 }], items: [i1, i2, i3] });
    const r1 = await saveContent(admin, A, vid, c1);
    ok("W3", "saveContent writes groups, sections, items, fields and mapping", r1.ok, JSON.stringify(r1));
    const l1 = await loadInstrumentVersion(admin, vid);
    ok("W3b", "loading the draft returns exactly what was saved", !!l1 && sig(l1.content) === sig(c1), l1 ? sig(l1.content).slice(0, 200) : "no load");
    ok("W3c", "the mapping is stored with its snapshot", l1?.content.items.find((i) => i.stable_key === i3.stable_key)?.mapping?.ref_snapshot?.wording === crit.wording);
    const again = await saveContent(admin, A, vid, c1);
    ok("W4", "saving the same content again changes nothing", again.ok && (again as any).changed === false);

    // reorder + edit + delete + move across sections
    const c2 = normalizeContent({ ...c1, items: [{ ...i3, section_key: s1, prompt: i3.prompt }, { ...i1, prompt: "Prompt 1 edited" }].concat([]), sections: [c1.sections[1], c1.sections[0]] });
    const r2 = await saveContent(admin, A, vid, c2);
    ok("W5", "a reorder, an edit, a move to another section and two deletions are written", r2.ok, JSON.stringify(r2));
    const l2 = await loadInstrumentVersion(admin, vid);
    ok("W5b", "the saved order is the order sent, and permanent keys never changed", !!l2 && sig(l2.content) === sig(c2), l2 ? sig(l2.content).slice(0, 240) : "no load");
    ok("W5c", "the deleted item took its fields with it", !!l2 && l2.content.items.every((i) => (i.fields ?? []).length === 0));
    const back = await saveContent(admin, A, vid, c1);
    ok("W5d", "the original content can be restored", back.ok);

    // settings, scoring, validation
    const st = await saveSettings(admin, A, vid, { delivery_modes: ["self_assessment"], respondent_roles: ["self"] });
    ok("W6", "saveSettings stores delivery modes", st.ok);
    const rules = { schema: RULES_SCHEMA, outcomes: [{ code: "MET", label: "Met", class: "positive" }, { code: "NOT", label: "Not met", class: "negative" }, { code: "INC", label: "Incomplete", class: "incomplete" }], gates: { criticalFail: "NOT", mandatoryMissing: "INC" },
      rules: [{ id: "r1", label: "Something answered", priority: 1, when: { count: { scope: "all" }, where: { answered: true }, op: ">=", value: 1 }, then: { outcome: "MET" } }], fallback: "INC" };
    const sc0 = await saveScoring(admin, A, vid, rules as any, [], null);
    ok("W7", "saveScoring stores the document and its hash", sc0.ok && /^[0-9a-f]{64}$/.test((sc0 as any).scoringHash ?? ""), JSON.stringify(sc0));
    const v0 = await validateInstrument(admin, vid, A, true);
    ok("W7b", "validation runs the engine over the saved draft and records a validated event", !!v0, "");
    const trail0 = await loadTrail(admin, "instrument", [vid]);
    ok("W7c", "the validated event is in the history with its counts", trail0.events.some((e) => e.event === "validated" && e.actor_id === A));
    const l3 = await loadInstrumentVersion(admin, vid);
    ok("W7d", "the editor is recorded on the version (author wrote it, so edited_by stays empty)", !!l3 && l3.version.authored_by.includes(A) && !l3.version.edited_by.includes(B));

    // submit
    const blocked = await submitForReview(admin, "instrument", vid, A);
    ok("W8a", "the adapter guard refuses a mapped criterion without a current approval, in plain words", !blocked.ok && /clinical approval/i.test((blocked as any).error), JSON.stringify(blocked).slice(0, 300));
    const c3: EditorContent = { ...c1, items: c1.items.map((i) => (i.stable_key === i3.stable_key ? { ...i, mapping: null } : i)) };
    ok("W8b", "unlinking the mapping is saved", (await saveContent(admin, A, vid, c3)).ok);
    const sub = await submitForReview(admin, "instrument", vid, A);
    ok("W8", "a sound draft is put forward for review", sub.ok, JSON.stringify(sub).slice(0, 500));
    if (sub.ok) {
      const rv = await recordDecision(admin, "instrument", vid, A, { reviewKind: "governance", decision: "approved" });
      ok("W9", "the author cannot decide on their own version (not independent)", !rv.ok && /Not independent/i.test((rv as any).error), JSON.stringify(rv));
      const rb = await recordDecision(admin, "instrument", vid, B, { reviewKind: "governance", decision: "rejected" });
      ok("W9b", "a rejection needs a reason", !rb.ok && (rb as any).status === 422);
      const rc = await recordDecision(admin, "instrument", vid, B, { reviewKind: "governance", decision: "approved" });
      ok("W9c", "an independent reviewer's decision is recorded", rc.ok, JSON.stringify(rc));
      const ap = await approveVersion(admin, "instrument", vid);
      ok("W9d", "the version is approved on the independent decision", ap.ok, JSON.stringify(ap));
      const ed = await saveContent(admin, A, vid, c2);
      ok("W9e", "content cannot be saved once the version is out of draft (409)", !ed.ok && (ed as any).status === 409);
      const back2 = await returnToDraft(admin, "instrument", vid, A);
      ok("W9f", "a return to draft works and names who returned it", back2.ok);
    } else {
      ok("W9", "the failing validation is explained in plain words", (sub as any).report?.errors?.length > 0, JSON.stringify((sub as any).report?.errors?.slice(0, 3)));
    }

    // duplicate needs the author capability of the actor
    const dup = await duplicateVersion(admin, B, vid);
    ok("W10", "duplicate is refused for somebody without the author capability, in plain words", !dup.ok && /capability/i.test((dup as any).error), JSON.stringify(dup));
    const dupA = await duplicateVersion(admin, A, vid);
    ok("W10b", "duplicate by an author makes a new draft that keeps the item keys", dupA.ok, JSON.stringify(dupA));
    if (dupA.ok) {
      const d2 = await loadInstrumentVersion(admin, dupA.versionId);
      ok("W10c", "the duplicate is version 2 with the same stable keys", d2?.version.version_no === 2 && d2.content.items.map((i) => i.stable_key).sort().join() === c1.items.map((i) => i.stable_key).sort().join());
      await deleteDraft(admin, "instrument", dupA.versionId);
    }
    const del = await deleteDraft(admin, "instrument", vid);
    ok("W11", "a draft can be deleted", del.ok, JSON.stringify(del));
  } finally {
    if (instrumentId) {
      await pg.query("delete from asmt_instrument where id = $1", [instrumentId]).catch((e: any) => console.log("  cleanup instrument:", e.message));
    }
    await pg.query("delete from asmt_instrument_family_counter where family_code = 'ZQT'").catch(() => {});
    await pg.query("delete from asmt_instrument_family where code = 'ZQT'").catch((e: any) => console.log("  cleanup family:", e.message));
    if (appts.length) await pg.query("delete from ogs_office_appointments where id = any($1)", [appts]).catch((e: any) => console.log("  cleanup appointments:", e.message));
    await pg.end();
  }
  console.log(bad === 0 ? "\n  ALL PASS\n" : `\n  ${bad} FAILURE(S)\n`);
  process.exitCode = bad === 0 ? 0 : 1;
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exitCode = 1; });
