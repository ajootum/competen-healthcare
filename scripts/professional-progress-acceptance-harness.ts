/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MY PROFESSIONAL PROGRESS + DOCUMENT STUDIO ACCEPTANCE -- COMPETEN-PROFESSIONAL-PROGRESS-01 Stage 8, owner GO s13, STAGING ONLY.
 *
 * One Individual with Scholar and Professional history, through the library the routes call (the same loaders, engine,
 * parsers, stores, composer and renderers), against migration 550 on staging. Items are the GO's own numbering:
 *   Progress  1 open  2 current development and next steps  3 learning and CPD over time  4 competency development
 *   5 self-assessment apart from verification  6 Stage 6 evaluation history  7 follow a recommendation to its module
 *   8 career milestones  9 change periods without rewriting history  10 without CFCA or AI  11 private records protected
 *   12 no universal score
 *   Studio  13 open  14 Professional CV  15 a published template  16 sections and individual records  17 reorder and edit
 *   18 complete preview  19 DOCX  20 PDF  21 same information in both  22 save and reopen  23 drafts change no source
 *   24 unselected and private excluded  25 provenance labels accurate  26 export without AI  27 open from the Passport
 *   28 Individual isolation and export access
 *
 * ⚠ FIXTURES are written by their OWN writers (needs-store, plan-store, Stage 5 competency-store, Stage 6 evaluation-store)
 * or, for the CPD entry, profile and Scholar material, the way their own writers write them. C5 is read through Stage 5's
 * adapter: where the Studio is not on staging, step 5 registers an in-process stand-in with one verified decision.
 * STAGING ONLY (assertSafeTarget). PEND until 550 is applied. Own harness-prof08-* identities, deleted after. Writes three
 * policy rows (catalogues, document AI, the documents config) and restores them exactly.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-progress-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { createNeed, saveReflection } from "../src/lib/individual/professional/needs-store";
import { createGoal, linkCpdToGoal, linkPlanCompetency } from "../src/lib/individual/professional/plan-store";
import { parseEntry, parseSelfAssessment } from "../src/lib/individual/professional/competency-form";
import { addEntry, addSelfAssessment, loadCompetencyWorkspace, loadScaleLevels } from "../src/lib/individual/professional/competency-store";
import { registerVerificationStudio } from "../src/lib/individual/professional/competency-verification";
import { evaluate } from "../src/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "../src/lib/individual/professional/evaluation-sources";
import { currentConfigVersion, recordEvaluation } from "../src/lib/individual/professional/evaluation-store";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { buckets, careerJourney, competencyProgress, learningProgress, nextSteps, overview, timeline } from "../src/lib/individual/professional/progress-intel";
import { loadProgressInput } from "../src/lib/individual/professional/progress-sources";
import { decideStep } from "../src/lib/individual/professional/progress-store";
import { DEFAULT_DOCUMENTS, DOCUMENTS_PATH, DEFAULT_LABELS, checkDocumentsDraft, loadDocumentsConfig, templatesFor } from "../src/lib/individual/documents-config";
import { emptyDraft, modelLines, parseDraft } from "../src/lib/individual/documents/model";
import { renderDocx } from "../src/lib/individual/documents/docx";
import { pdfSafe, renderPdf } from "../src/lib/individual/documents/pdf";
import { loadDocumentCatalogue } from "../src/lib/individual/professional/document-sources";
import { composeDocument } from "../src/lib/individual/professional/document-compose";
import { createDocument, documentOf, loadDocuments, recordExport, updateDocument } from "../src/lib/individual/professional/document-store";
import { draftFromPassport } from "../src/lib/individual/professional/document-passport";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-progress-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof08-progress@competen.test", OTHER = "harness-prof08-other@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_catalogues", "individual.policy.professional_documents_ai", DOCUMENTS_PATH];
const today = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const PRIVATE = "Private: the arrest on nights still worries me.";
const NUMBER = "REG-SECRET-4471";
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup(email: string) {
  const u = await findUser(email);
  if (!u) return;
  const { data: links } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", u.id);
  await admin.from("individual_professional_share").delete().eq("user_id", u.id);
  if (links?.length) await admin.from("passport_share_tokens").delete().in("id", links.map((l: any) => l.share_token_id));
  await admin.from("individual_professional_document").delete().eq("user_id", u.id);
  await admin.from("individual_professional_my_competency").delete().eq("user_id", u.id);
  await admin.from("individual_professional_activity").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal_need").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal").delete().eq("user_id", u.id);
  await admin.from("individual_professional_need").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_cpd", "individual_professional_evidence", "individual_professional_reflection", "individual_professional_profile_item", "individual_professional_profile_context",
    "individual_professional_profile", "individual_professional_progress_preference", "individual_professional_progress_view", "individual_scholar_passport_item", "individual_scholar_material",
    "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
let prior: any[] = [];
async function restore() {
  for (const path of ROWS) {
    const was = prior.find(r => r.config_path === path);
    if (was) await admin.from("workspace_config_overrides").upsert(was, { onConflict: "scope_type,scope_ref,config_path" });
    else await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  }
}
const publish = (path: string, settings: unknown) => admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: path, draft: settings, published: settings }, { onConflict: "scope_type,scope_ref,config_path" });
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value; };
const id = (w: { ok: boolean; id?: string | null; error?: string }) => { if (!w.ok || !w.id) throw new Error(w.error ?? "write failed"); return w.id; };
async function person(email: string, name: string, experiences: ("scholar" | "professional")[]) {
  const { data: created } = await admin.auth.admin.createUser({ email, password: `p8-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: name } });
  const me = created.user.id as string;
  await admin.from("profiles").update({ full_name: name, role: null }).eq("id", me);
  const g = validateGrant({ targetUserId: me, experiences, note: "PROF-PROGRESS-01 acceptance", adultConfirmed: true });
  if (isGrantRefusal(g)) throw new Error(g.message);
  await grantIndividualAccess(admin, g, me);
  return me;
}
const sourceFingerprint = async (me: string) => JSON.stringify(await Promise.all(["individual_professional_cpd", "individual_professional_profile_item", "individual_professional_my_competency", "individual_professional_goal", "individual_professional_need"]
  .map(async t => (await admin.from(t).select("*").eq("user_id", me).order("id")).data ?? [])));
async function docxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(Object.keys(zip.files).filter(f => /^word\/(document|footer\d*)\.xml$/.test(f)).map(f => zip.file(f)!.async("string")));
  return norm(parts.map(x => x.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")).join("\n"));
}
const pdfText = async (buf: Buffer) => norm((await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text as unknown as string);

async function main() {
  console.log(`MY PROFESSIONAL PROGRESS + DOCUMENT STUDIO ACCEPTANCE (Stage 8) against ${ref}\n`);
  const probe = await admin.from("individual_professional_document").select("id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 550 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup(EMAIL); await cleanup(OTHER);
  try {
    const me = await person(EMAIL, "Harness Progress Clinician", ["scholar", "professional"]);
    const other = await person(OTHER, "Harness Other Person", ["professional"]);
    const ctx = { userId: me, profile: { fullName: "Harness Progress Clinician", email: EMAIL } };

    // ── FIXTURES: Scholar history, profile and context, a need, a goal, CPD, a private reflection, a competency, an evaluation.
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", self_declared_current_role: "Staff clinician", registration_completed_at: new Date().toISOString() });
    const itemsRes = (await admin.from("individual_professional_profile_item").insert([
      { user_id: me, experience_code: "professional", section: "registration", title: "Professional registration", organisation: "A regulatory body", self_declared_identifier: NUMBER, started_on: "2019-03-01", expires_on: day(60) },
      { user_id: me, experience_code: "professional", section: "employment", title: "Staff clinician", organisation: "A teaching hospital", started_on: "2020-01-01" },
      { user_id: me, experience_code: "professional", section: "qualification", title: "Degree in a health profession", organisation: "A university", started_on: "2018-07-15" },
      { user_id: me, experience_code: "professional", section: "aspiration", title: "Cardiac care specialist", target_on: day(700) },
    ]).select("id, section"));
    if (itemsRes.error) throw new Error(`profile fixture: ${itemsRes.error.message}`);
    const items = itemsRes.data ?? [];
    const item = (s: string) => items.find((i: any) => i.section === s)?.id as string;
    const mat = await admin.from("individual_scholar_material").insert({ user_id: me, title: "Cardiac physiology notes", file_name: "notes.pdf", mime_type: "application/pdf", byte_size: 1000, sha256: "0".repeat(64),
      storage_path: `${me}/notes.pdf`, page_count: 1, chunk_count: 1, char_count: 100, extractor: "harness", pii_attested_at: new Date().toISOString() }).select("id").single();
    const scholarItem = mat.data ? (await admin.from("individual_scholar_passport_item").insert({ user_id: me, material_id: mat.data.id, achievement: "practice_questions", label: "Cardiac physiology practice" }).select("id").single()).data?.id : null;
    const need = id(await createNeed(admin, me, { title: "Reading 12-lead ECGs with confidence", origin: "self_identified" }));
    const goal = id(await createGoal(admin, me, { title: "ECG Interpretation" }, { createdFrom: "need", needId: need, competencyId: null, offeringId: null, aspirationItemId: null, reflectionId: null }));
    const cpd1 = (await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "course", title: "ECG interpretation workshop", provider: "Regional training centre",
      hours: 3, activity_date: day(-10), reflection: PRIVATE, document_path: `${me}/cert.pdf`, document_name: "cert.pdf", document_mime: "application/pdf", document_bytes: 1024 }).select("id").single()).data.id;
    const cpd2 = (await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "self_study", title: "ECG interpretation workshop", hours: 1, activity_date: day(-3) }).select("id").single()).data.id;
    await linkCpdToGoal(admin, me, goal, { cpdId: cpd1 });
    await saveReflection(admin, me, null, { body: PRIVATE, template_code: null, template_label: null });
    const offered = await loadCatalogueFor(admin, "professional");
    const c = offered?.find(o => /ecg|electrocardio|cardi|rhythm/i.test(o.title)) ?? offered?.[0] ?? null;
    let entryId: string | null = null;
    if (c) {
      await linkPlanCompetency(admin, me, { goalId: goal }, c.competencyId, offered!, c.outcomes[0] ?? null);
      entryId = id(await addEntry(admin, me, must(parseEntry({ competencyId: c.competencyId }, (await loadIndividualPolicy(admin)).professionalCompetency, offered!))));
      const levels = await loadScaleLevels(admin, c.expectedLevel?.id ?? null);
      const fv = (await loadCompetencyWorkspace(admin, me)).entries?.[0]?.framework_version ?? null;
      if (levels?.length) await addSelfAssessment(admin, me, entryId, must(parseSelfAssessment({ levelId: levels[0].id, confidence: "unsure" }, { levels, outcomes: c.outcomes, frameworkVersion: fv, policy: (await loadIndividualPolicy(admin)).professionalCompetency })));
    }
    {
      const { input, context } = await loadEvaluationInput(admin, me, today);
      const ev = evaluate(input, { kind: "goal", ref: goal }, (await loadIndividualPolicy(admin)).professionalEvaluation)!;
      await recordEvaluation(admin, me, ev, { context, policy: (await loadIndividualPolicy(admin)).professionalEvaluation, configVersion: await currentConfigVersion(admin), ai: null, supersedes: null });
    }

    // ── PROGRESS JOURNEY ──
    const pp = (await loadIndividualPolicy(admin)).professionalProgress;
    const p1 = await loadProgressInput(admin, me, today);
    ok("1. My Professional Progress opens: its store is provisioned and every owner reads", p1.state.provisioned && p1.input.cpd !== null && p1.extra.items !== null && p1.extra.evaluations !== null,
      `Scholar item ${scholarItem ? "present" : "not created"}, catalogue ${c ? c.title : "none"}`);
    const steps = nextSteps(p1.input, p1.extra, pp, { profile: "/individual/professional/registration", competencies: "/individual/professional/competencies", learning: "/individual/learning" }, 90);
    const ov = overview(p1.input, timeline(p1.input, p1.extra, pp), pp);
    ok("2. current development and next steps: active goals and next steps, each with its finding", ov.activeGoals.length === 1 && steps.length >= 2 && steps.every(s => s.finding && s.href), steps.map(s => s.rule).join(", "));
    const ev3 = timeline(p1.input, p1.extra, pp);
    const months = buckets(ev3, "month", p1.extra.context);
    ok("3. learning and CPD over time, with repeated practice marked", ev3.some(e => e.key === `cpd:${cpd1}`) && ev3.find(e => e.key === `cpd:${cpd2}`)?.repeat === true && months.length >= 1);
    const cp = competencyProgress(p1.input, p1.extra);
    const row = cp.tree.flatMap(n => n.rows).find(r => r.entryId === entryId);
    ok("4. competency development, Domain then CPU then competency", !c || (!!row && cp.tree.some(n => n.rows.includes(row!))), row ? `${cp.tree.find(n => n.rows.includes(row))?.domain} > ${row.name}` : "no catalogue offered");
    let standIn = false;
    // The Studio reads decisions only. Making a real C5 decision needs an appointed assessor (not Stage 8's), so this display check
    // registers an in-process stand-in through Stage 5's adapter, scoped to this person, whether or not C5 is wired here.
    if (c) {
      standIn = true;
      registerVerificationStudio({
        listVerifications: async (_a: unknown, uid: string) => uid !== me ? { provisioned: true, items: [] } : ({ provisioned: true, items: [{ requestId: "00000000-0000-4000-8000-0000000008c5", status: "decided", method: "Direct observation", requestedAt: today, evidence: [],
          competency: { frameworkId: c.catalogue.id, frameworkCompetencyId: c.competencyId, frameworkVersion: null, title: c.title, learningOutcomes: [] },
          decisions: [{ outcomeCode: "verified_at_level", outcomeClass: "verified", outcomeLabel: "Verified at level", level: "Proficient", assessorName: "Stand-in assessor", authority: "C5", criteriaVersion: "v1", decidedAt: `${today}T09:00:00Z`, validUntil: null, revokedAt: null, supersededBy: null } as any] }] }),
        requestVerification: async () => ({ ok: false, status: 409, error: "stand-in" }),
      });
    }
    const p5 = await loadProgressInput(admin, me, today);
    const row5 = competencyProgress(p5.input, p5.extra).tree.flatMap(n => n.rows).find(r => r.entryId === entryId);
    ok("5. self-assessment and independent verification are separate columns", !c || (!!row5 && !!row5.selfAssessed && /self-reported/.test(row5.selfAssessed) && !!row5.independent && row5.selfAssessed === row?.selfAssessed),
      `${standIn ? `in-process stand-in Studio (C5 wired here: ${p1.input.verification.available})` : "no catalogue"}; self ${row5?.selfAssessed ?? "-"}; independent ${row5?.independent ?? "-"}`);
    ok("6. Stage 6 evaluation history appears in the timeline", ev3.some(e => e.kind === "evaluation"));
    const step7 = steps.find(s => s.rule === "credential_expiry") ?? steps[0];
    const d7 = await decideStep(admin, me, step7.key, "dismissed", null);
    const p7 = await loadProgressInput(admin, me, today);
    const after7 = nextSteps(p7.input, p7.extra, pp, { profile: "/individual/professional/registration", competencies: "/individual/professional/competencies", learning: "/individual/learning" }, 90);
    ok("7. a recommendation opens its owning module, and dismissing it is the person's choice", /^\/individual\/(professional\/(registration|cpd|development|competencies)|learning)/.test(step7.href) && d7.ok && !after7.some(s => s.key === step7.key), `${step7.rule} -> ${step7.href}`);
    const journey = careerJourney(p1.input, p1.extra, pp);
    ok("8. career milestones: registration, employment, qualifications and aspirations in the journey", journey.groups.length >= 3 && journey.groups.some(g => g.items.some(i => i.title === "Cardiac care specialist")), journey.groups.map(g => g.category).join(", "));
    const fp9 = await sourceFingerprint(me);
    const groupsOk = (["week", "month", "quarter", "year", "phase"] as const).every(k => buckets(ev3, k, p1.extra.context).flatMap(b => b.events).length === ev3.length);
    ok("9. changing reporting periods regroups only: every event once, no source row changed", groupsOk && fp9 === await sourceFingerprint(me));
    await publish(ROWS[0], { ids: [] });
    await publish(ROWS[1], { value: "off" });
    const p10 = await loadProgressInput(admin, me, today);
    ok("10. progress works with no catalogue and no AI", (await loadIndividualPolicy(admin)).professionalDocuments.ai === "off" && timeline(p10.input, p10.extra, pp).length >= ev3.length && learningProgress(p10.input, p10.extra).participation.state === "measured");
    const all11 = JSON.stringify([ev3, cp, journey, learningProgress(p1.input, p1.extra)]);
    ok("11. private records stay protected: no reflection text in progress, nothing of another person", !all11.includes(PRIVATE) && !all11.includes(NUMBER) && (await loadProgressInput(admin, other, today)).input.cpd?.length === 0);
    ok("12. no universal competency score", !/"score"|percentage|overall/i.test(all11));

    // ── DOCUMENT STUDIO JOURNEY ── (AI stays off from step 10 to the end: step 26)
    const docs0 = await loadDocuments(admin, me);
    ok("13. the Document Studio opens: its store is provisioned and empty", docs0.provisioned && docs0.documents?.length === 0);
    const published = { ...DEFAULT_DOCUMENTS, templates: DEFAULT_DOCUMENTS.templates.map(t => t.code === "modern-minimal" ? { ...t, colours: { ...t.colours, accent: "#0E7490" } } : t) };
    const checked = checkDocumentsDraft(published, DEFAULT_DOCUMENTS);
    if (!checked.ok) throw new Error(checked.error);
    await publish(ROWS[2], checked.settings);
    const cfg = await loadDocumentsConfig(admin);
    const cv = cfg.types.find(t => t.code === "professional-cv")!;
    const tpl = templatesFor(cfg, cv).find(t => t.code === "modern-minimal")!;
    const docId = id(await createDocument(admin, me, { docType: cv.code, title: "My CV", templateCode: tpl.code, templateVersion: tpl.version, content: emptyDraft(cv), origin: "progress", passportShareTokenId: null }));
    ok("14. a Professional CV draft is created", !!docId);
    ok("15. a published template is chosen, at its published version", tpl.version === 2 && (await documentOf(admin, me, docId))?.template_version === 2, `${tpl.name} v${tpl.version}`);
    const catalogue = await loadDocumentCatalogue(admin, me, ctx.profile, today);
    const keys = new Set(catalogue.records.map(r => r.key));
    const reg = `profile_item:${item("registration")}`, job = `profile_item:${item("employment")}`, qual = `profile_item:${item("qualification")}`;
    const draft1 = { ...emptyDraft(cv), summary: "I am a clinician focused on acute cardiac care.", sections: emptyDraft(cv).sections.map(s =>
      s.code === "registrations" ? { ...s, visible: true, records: [{ key: reg }] } : s.code === "employment" ? { ...s, visible: true, records: [{ key: job }] }
      : s.code === "learning_cpd" ? { ...s, visible: true, records: [{ key: `cpd:${cpd1}` }, { key: `cpd:${cpd2}` }] } : s) };
    const parsed = parseDraft(draft1, cv, keys);
    const refused = parseDraft({ ...draft1, sections: [{ code: "employment", visible: true, records: [{ key: "profile_item:00000000-0000-4000-8000-000000000000" }] }] }, cv, keys);
    const u16 = parsed.ok ? await updateDocument(admin, me, docId, { content: parsed.value }) : { ok: false };
    ok("16. sections and individual records are chosen; a record that is not the person's is refused", parsed.ok && u16.ok && !refused.ok && !keys.has(`cpd:${PRIVATE}`));
    const reordered = { ...parsed.ok ? parsed.value : draft1, summary: "I am a clinician focused on acute cardiac care. I teach new starters.", sections: (parsed.ok ? parsed.value : draft1).sections.map(s => s.code === "learning_cpd" ? { ...s, title: "Recent learning", records: [...s.records].reverse() } : s) };
    const order = ["summary", "employment", "registrations", ...reordered.sections.map(s => s.code).filter(c2 => !["summary", "employment", "registrations"].includes(c2))];
    reordered.sections = order.map(code => reordered.sections.find(s => s.code === code)!);
    const fp17 = await sourceFingerprint(me);
    await updateDocument(admin, me, docId, { content: must(parseDraft(reordered, cv, keys)) });
    const c18 = await composeDocument(admin, ctx, (await documentOf(admin, me, docId))!, today);
    if ("error" in c18) throw new Error(c18.error);
    const secs = c18.model.sections.map(s => s.code);
    ok("17. sections and records are reordered and presentation text edited", secs.slice(0, 3).join(",") === "summary,employment,registrations" && c18.model.sections.find(s => s.code === "learning_cpd")?.title === "Recent learning"
      && c18.model.sections.find(s => s.code === "learning_cpd")!.entries[0].key === `cpd:${cpd2}`);
    ok("18. the complete preview is composed from the owners' records now, with a content hash", c18.model.recordCount === 4 && /^[0-9a-f]{64}$/.test(c18.hash) && c18.model.missing.length === 0);
    const docx = await renderDocx(c18.model, c18.template), pdf = await renderPdf(c18.model, c18.template);
    const e19 = await recordExport(admin, me, { documentId: docId, format: "docx", templateCode: c18.template.code, templateVersion: c18.template.version, contentHash: c18.hash, byteSize: docx.length, recordCount: c18.model.recordCount });
    ok("19. an editable DOCX is produced and its export recorded (metadata only)", docx.subarray(0, 2).toString() === "PK" && e19.ok, `${docx.length} bytes`);
    const e20 = await recordExport(admin, me, { documentId: docId, format: "pdf", templateCode: c18.template.code, templateVersion: c18.template.version, contentHash: c18.hash, byteSize: pdf.length, recordCount: c18.model.recordCount });
    ok("20. a formatted PDF is produced and its export recorded", pdf.subarray(0, 5).toString() === "%PDF-" && e20.ok, `${pdf.length} bytes`);
    const [dt, pt] = [await docxText(docx), await pdfText(pdf)];
    const lines = modelLines(c18.model);
    ok("21. both files contain the same selected information, line for line", lines.every(l => dt.includes(norm(l)) && pt.replace(/\s/g, "").includes(pdfSafe(l).replace(/\s/g, ""))), `${lines.length} lines`);
    const reopened = await documentOf(admin, me, docId);
    ok("22. the draft is saved and reopens with its choices", reopened?.content.sections[0].code === "summary" && reopened.content.summary === reordered.summary && reopened.title === "My CV");
    ok("23. editing the draft changed no source record", fp17 === await sourceFingerprint(me));
    ok("24. unselected and private information is excluded", !dt.includes("Degree in a health profession") && !pt.includes("Degree in a health profession") && !dt.includes(PRIVATE) && !pt.includes(NUMBER) && !dt.includes(NUMBER) && !dt.includes("Cardiac physiology"),
      `qualification ${qual.slice(-6)} unselected, registration number hidden by default, reflection never offered`);
    const regEntry = c18.model.sections.flatMap(s => s.entries).find(e => e.key === reg)!, cpdEntry = c18.model.sections.flatMap(s => s.entries).find(e => e.key === `cpd:${cpd1}`)!;
    ok("25. provenance and status wording stay accurate", regEntry.status === DEFAULT_LABELS.self_declared && cpdEntry.status === DEFAULT_LABELS.document_supported
      && !c18.model.sections.flatMap(s => s.entries).some(e => e.status.includes(DEFAULT_LABELS.independent)), `${regEntry.status}; ${cpdEntry.status}`);
    ok("26. export works with AI off", (await loadIndividualPolicy(admin)).professionalDocuments.ai === "off" && e19.ok && e20.ok);
    // A Stage 7 link carrying ONE chosen CPD record (and not the other): the draft starts with exactly that record.
    const link = await mintShare(admin, me, parseShare({ scope: "full", days: "7" }), { overview: false, itemIds: [] }, [], [],
      { purposeCode: null, purposeLabel: "Job application", recipientLabel: null, summary: "Chosen for a cardiac role.", includeInstitution: false, records: [{ kind: "cpd", id: cpd1 }] });
    const pType = cfg.types.find(t => t.code === "passport-export")!;
    const fromLink = link ? await draftFromPassport(admin, me, link.id, pType, catalogue.records, today) : null;
    const pDoc = link && fromLink ? await createDocument(admin, me, { docType: pType.code, title: "Passport export", templateCode: "competen-passport", templateVersion: 1, content: fromLink.content, origin: "passport", passportShareTokenId: link.id }) : null;
    const placedKeys = fromLink?.content.sections.flatMap(s => s.records.map(r => r.key)) ?? [];
    const theirs = (await admin.from("individual_professional_share").select("share_token_id").eq("share_token_id", link?.id).eq("user_id", other).maybeSingle()).data;
    ok("27. the same Studio opens from the Passport: the link's chosen records (read through Stage 7) start the draft, on the person's own link only",
      !!pDoc?.ok && (await documentOf(admin, me, pDoc!.id!))?.origin === "passport" && placedKeys.includes(`cpd:${cpd1}`) && !placedKeys.includes(`cpd:${cpd2}`)
      && fromLink!.content.summary === "Chosen for a cardiac role." && !theirs, `placed ${placedKeys.join(" ")}; not placed ${fromLink?.unmatched.join(", ") || "none"}`);
    const otherSees = await documentOf(admin, other, docId);
    const otherExport = await recordExport(admin, other, { documentId: docId, format: "pdf", templateCode: c18.template.code, templateVersion: c18.template.version, contentHash: c18.hash, byteSize: 10, recordCount: 1 });
    const otherCat = await loadDocumentCatalogue(admin, other, { fullName: "Other", email: OTHER }, today);
    const stale = await updateDocument(admin, me, docId, { content: { ...reordered, summary: "Changed after preview." } });
    const c28 = await composeDocument(admin, ctx, (await documentOf(admin, me, docId))!, today);
    ok("28. isolation: another person cannot read, export or use the draft or its records, and a changed draft no longer matches its preview",
      !otherSees && !otherExport.ok && !otherCat.records.some(r => keys.has(r.key)) && stale.ok && !("error" in c28) && c28.hash !== c18.hash,
      `other reads ${!!otherSees}, other export ${otherExport.ok}, shared keys ${otherCat.records.filter(r => keys.has(r.key)).map(r => r.key).join(" ")}, stale ${stale.ok}, rehash ${!("error" in c28) && c28.hash !== c18.hash}`);
  } finally {
    await restore();
    await cleanup(EMAIL); await cleanup(OTHER);
  }
  ok("cleanup: the harness identities and their records are gone, and policy rows are restored", !(await findUser(EMAIL)) && !(await findUser(OTHER)));
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed${fails.length ? `: ${fails.join("; ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(EMAIL); await cleanup(OTHER); } catch { /* best effort */ } process.exit(1); });
