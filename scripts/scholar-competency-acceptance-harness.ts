/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR COMPETENCY ACCEPTANCE -- COMPETEN-SCHOLAR-01 S2-S4 against a REAL database (migrations 384, 387, 388, 389).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only scholar-competency-acceptance-harness
 *
 * The vertical slice, end to end, on the S1 seed catalogues (Competen Foundational, Nursing: Respiratory Care):
 *   N  nothing is offered while the Scholar allowlist is empty, whatever a programme names
 *   G  configuration, not code: a nursing programme, a second programme of another profession and country,
 *      and a programme naming a catalogue HQ has not allowed -- each offered exactly its share
 *   U  respiratory notes uploaded as a real PDF (the browser path, ANON key) and split into sections
 *   S  S2: concepts and PROPOSED mappings from the AI, only to competencies the catalogue offered, with
 *      model, prompt version and confidence, foundational AND nursing; re-running analyses nothing twice
 *   D  corrections: accept, reject, change of mind, a person's own link -- all as new rows; the trail refuses
 *      UPDATE and DELETE; the schema refuses AI rows without provenance and rows pointing at another person
 *   I  isolation: another person's store calls and signed-in RLS sessions see and change nothing
 *   L  S3: explain modes through the gateway; anything beyond the notes is checked apart
 *   Q  S4: questions tagged to the accepted competency, a multi-step case stored in order, the schema
 *      refusing a malformed case; progress by competency from real answers
 *   A  every AI call is in plat_ai_requests with person attribution and the Scholar operation
 *   E  erasing the material removes its concepts, mappings and decisions THROUGH the append-only trigger
 *   Z  fixtures and programmes removed; a Scholar allowlist that was set is NEVER touched (shared staging
 *      configuration); one the run had to add is removed only while it is still unchanged
 *
 * ⚠ IT IMPORTS THE CODE IT TESTS (the store, catalogue adapter, mapping, generation, progress). Nothing
 * below restates their rules.
 * ⚠ STAGING ONLY (assertSafeTarget). It never reads or writes individual_app: the store does not consult
 * the release gate, and other sessions depend on that flag's current state.
 * ⚠ PEND (exit 0, nothing created) until 388 is applied, or while the S1 seed is not published.
 * ⚠ RUN IT ALONE. Its fixture identities are its own (harness-s2-*@competen.test) and it deletes them.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import * as store from "../src/lib/individual/scholar/store";
import { scholarCatalogue, type CatalogueCompetency } from "../src/lib/individual/scholar/catalogue";
import { conceptInText, leadingCompetency } from "../src/lib/competency/mapping";
import { runAnalysis, runCase, runExplain, runQuestions } from "../src/lib/individual/scholar/generation";
import { buildCompetencyProgress } from "../src/lib/individual/scholar/competency-progress";
import { chunkPages, extractMaterial } from "../src/lib/individual/scholar/extract";
import { BUCKET, CASE_MIN_STEPS, PDF_MIME, PROMPT_VERSIONS } from "../src/lib/individual/scholar/config";
import { tinyPdf } from "../src/lib/individual/scholar/test-documents";
import { aiStatus } from "../src/lib/ai/config";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-competency-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { a: "harness-s2-a@competen.test", b: "harness-s2-b@competen.test" };
// A test value generated for this run, used only to sign the fixtures in for group I.
const FIX_PASSWORD = `s2-${Math.random().toString(36).slice(2)}-Aa1!`;
const PROG = { nursing: "harness-s2-nursing-ug", other: "harness-s2-foundation-ke", notAllowed: "harness-s2-not-allowed" };
const ALLOW = { scope_type: "platform", scope_ref: "individual", config_path: "individual.policy.scholar_catalogues" };

// The study notes: clinical-education prose, and NOT patient data. One section per page.
const PAGES = [
  ["Respiratory assessment begins with the respiratory rate, counted for a full minute while the patient is at rest.",
    "Observe chest movement, the use of accessory muscles and the colour of the lips and skin.",
    "Oxygen saturation is measured with a pulse oximeter, and a falling saturation may indicate deterioration.",
    "Wheeze suggests narrowed airways, and crackles may suggest fluid in the lungs."],
  ["Oxygen is a medicine and must be prescribed with a target saturation range.",
    "Check the prescription, the delivery device and the flow before starting oxygen therapy.",
    "Monitor the response of the patient and escalate to the nurse in charge if breathing worsens.",
    "Keep oxygen away from open flames because it supports combustion.",
    "If the saturation falls below the target range, check the airway, the position of the patient and the oxygen delivery device.",
    "Record the saturation, the respiratory rate and the oxygen flow on the observation chart after each check.",
    "Humidified oxygen can be used when oxygen is given for long periods, to keep the airways moist."],
  ["Clinical reasoning links what you observe to what it may mean and to what you should do next.",
    "Use a structured handover such as SBAR to communicate a deteriorating patient clearly.",
    "Hand hygiene before and after patient contact prevents cross infection."],
];

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanupUsers() {
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
    if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
    await admin.from("individual_scholar_material").delete().eq("user_id", u.id);
    await admin.from("individual_scholar_learner").delete().eq("user_id", u.id);
    await admin.from("plat_ai_requests").delete().eq("actor_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function cleanupProgrammes() {
  await admin.from("individual_scholar_programme").delete().in("code", Object.values(PROG));
}
async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIX_PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

/** The browser path: a signed slot from the server, the bytes put with the ANON key, then processing. */
async function uploadPdf(userId: string, pages: string[][], fileName: string): Promise<string | null> {
  const slot = await store.createUploadSlot(admin, userId, PDF_MIME);
  if (!slot) return null;
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const bytes = tinyPdf(pages);
  const put = await browser.storage.from(BUCKET).uploadToSignedUrl(slot.path, slot.token, bytes, { contentType: PDF_MIME });
  if (put.error) return null;
  const read = await store.readUpload(admin, store.uploadPath(userId, slot.uploadId, PDF_MIME));
  if (!read) return null;
  const ex = await extractMaterial(PDF_MIME, read);
  if (!ex.ok) return null;
  const made = await store.createMaterial(admin, userId, {
    id: slot.uploadId, path: slot.path, title: fileName.replace(/\.[^.]+$/, ""), fileName, mime: PDF_MIME, bytes: read,
    pageCount: ex.pageCount, extractor: ex.extractor, chunks: chunkPages(ex.pages),
  });
  return made.ok ? made.id : null;
}

async function main() {
  console.log(`SCHOLAR COMPETENCY ACCEPTANCE (COMPETEN-SCHOLAR-01 S2-S4) -- target ${ref}\n`);
  const probe = await admin.from("individual_scholar_competency_map").select("id").limit(0);
  if (probe.error) { console.log(`  PEND  migration 388 is not applied here (${probe.error.code ?? probe.error.message}). Nothing created.`); return; }
  const seed = (await admin.from("frameworks").select("id, code, pub_status").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"])).data ?? [];
  const cf = seed.find((f: any) => f.code === "CF-FOUND"), nr = seed.find((f: any) => f.code === "NUR-RESP");
  if (!cf || !nr || cf.pub_status !== "published" || nr.pub_status !== "published") { console.log("  PEND  the S1 seed catalogues are not published here. Nothing created."); return; }
  const core = (await admin.from("frameworks").select("id").is("hospital_id", null).eq("name", "Core Nursing").maybeSingle()).data;
  if (!aiStatus().configured) { console.log("  PEND  no AI provider on this environment -- the slice needs one. Nothing created."); return; }

  await cleanupUsers();
  await cleanupProgrammes();
  const before = (await admin.from("workspace_config_overrides").select("*").match(ALLOW).maybeSingle()).data;
  let a = "", b = "", materialId: string | null = null, runAllowId: string | null = null;
  try {
    // ── G (setup). Programmes are rows ──
    const ins = await admin.from("individual_scholar_programme").insert([
      { code: PROG.nursing, label: "harness-s2 Nursing (UG), diploma", profession: "Nursing", country: "UG", level: "Diploma" },
      { code: PROG.other, label: "harness-s2 Midwifery (KE), foundation only", profession: "Midwifery", country: "KE", level: "Certificate" },
      { code: PROG.notAllowed, label: "harness-s2 names a catalogue HQ has not allowed", profession: "Nursing", country: null, level: null },
    ]);
    const insF = await admin.from("individual_scholar_programme_framework").insert([
      { programme_code: PROG.nursing, framework_id: cf.id, layer: "foundational", sort_order: 0 },
      { programme_code: PROG.nursing, framework_id: nr.id, layer: "profession", sort_order: 1 },
      { programme_code: PROG.other, framework_id: cf.id, layer: "foundational", sort_order: 0 },
      ...(core ? [{ programme_code: PROG.notAllowed, framework_id: core.id, layer: "profession", sort_order: 0 }] : []),
    ]);
    ok("G0. three programmes configured as rows, with no code change", !ins.error && !insF.error, ins.error?.message ?? insF.error?.message ?? "");
    const load = async (code: string) => { const p = await store.loadProgramme(admin, code); return p.ok ? p.data : null; };
    const nursing = (await load(PROG.nursing))!, other = (await load(PROG.other))!, notAllowed = (await load(PROG.notAllowed))!;
    const cat = scholarCatalogue(admin);

    // ── N. nothing while the allowlist is empty ──
    // ⚠ THE ALLOWLIST IS SHARED STAGING CONFIGURATION (the owner's viewing setup lives in it). The run never
    // removes or changes one that is set: N1 runs only when there is none, and the run's own allowlist is
    // written only where none exists, and removed at the end only if it is still exactly what the run wrote.
    if (!before) {
      const none = await cat.forProgramme(nursing);
      ok("N1. ⚠ with the Scholar allowlist empty, the nursing programme is offered nothing -- naming a catalogue is not allowing it",
        none.ok && none.data.length === 0, JSON.stringify(none.ok ? none.data.length : none));
    } else pend("N1. the empty default", "a Scholar allowlist is set here and is never removed by this run; the default is pinned statically (competency-foundation-harness)");

    // ── G. the run's allowlist (only where none is set), then configuration decides ──
    const seedIds = [cf.id, nr.id];
    const has = (row: any) => seedIds.every(id => (row?.published?.ids ?? []).includes(id));
    if (!before) {
      const ins = await admin.from("workspace_config_overrides").insert({ ...ALLOW, draft: { ids: seedIds }, published: { ids: seedIds } }).select("id").single();
      runAllowId = ins.data?.id ?? null;
    } else if (!has(before)) {
      pend("G. the slice", "a Scholar allowlist is set here without both seed catalogues; this run does not change it");
      return;
    }
    const nCat = await cat.forProgramme(nursing), oCat = await cat.forProgramme(other), xCat = await cat.forProgramme(notAllowed);
    const comps: CatalogueCompetency[] = nCat.ok ? nCat.data : [];
    ok("G1. the nursing programme is offered 8 foundational then 5 nursing respiratory competencies, foundational first, with S1 layers and outcomes",
      comps.length === 13 && comps.slice(0, 8).every(c => c.layer === "foundational" && c.frameworkId === cf.id) && comps.slice(8).every(c => c.layer === "profession" && c.frameworkId === nr.id && c.profession === "Nursing")
      && comps.every(c => c.outcomes.length > 0), `${comps.length}`);
    ok("G2. a second programme (another profession and country) is offered only the foundational catalogue -- configuration, not code",
      oCat.ok && oCat.data.length === 8 && oCat.data.every(c => c.frameworkId === cf.id && c.profession === "Midwifery"), `${oCat.ok ? oCat.data.length : "unreadable"}`);
    if (core) ok("G3. ⚠ a programme naming a catalogue outside the HQ allowlist (Core Nursing) is offered nothing from it", xCat.ok && xCat.data.length === 0, `${xCat.ok ? xCat.data.length : "x"}`);
    else pend("G3. a programme naming a non-allowlisted catalogue", "Core Nursing not found here");

    // ── fixtures ──
    a = await makeUser(FIX.a); b = await makeUser(FIX.b);
    ok("P1. a person chooses a programme, and an unknown or inactive one is refused",
      (await store.setLearnerProgramme(admin, a, PROG.nursing)) === "ok" && (await store.setLearnerProgramme(admin, b, "harness-s2-does-not-exist")) === "unknown_programme"
      && (await store.learnerProgramme(admin, a)).ok && ((await store.learnerProgramme(admin, a)) as any).data?.code === PROG.nursing);

    // ── U. the notes ──
    materialId = await uploadPdf(a, PAGES, "Respiratory notes (harness).pdf");
    const chunks = materialId ? await store.listChunks(admin, a, materialId) : null;
    ok("U1. respiratory notes uploaded as a real PDF and split into one section per page", !!materialId && !!chunks?.ok && chunks.data.length === 3, `${chunks?.ok ? chunks.data.length : "none"}`);
    if (!materialId || !chunks?.ok) return;
    const [sec1, sec2, sec3] = chunks.data;

    // ── S. S2: concepts and proposals ──
    const start = await store.analysisStatus(admin, a, materialId);
    ok("S0. nothing is analysed before the person asks, and no competency was chosen at upload", start.ok && start.data.analysed === 0 && start.data.sections === 3);
    const next = await store.unanalysedSections(admin, a, materialId, 6);
    if (!next.ok) { ok("S1. sections to analyse", false); return; }

    const an = await runAnalysis(a, next.data, comps);
    if (!an.ok) { ok("S1. the analysis ran through the gateway", false, an.error); return; }
    const saved = await store.saveAnalysis(admin, a, { materialId, programmeCode: PROG.nursing, model: an.model, promptVersion: an.promptVersion, sentChunkIds: next.data.map(s => s.ref), sections: an.check.subjects });
    note(`analysis: ${an.check.subjects.length} sections, ${an.shown} competencies shown, ${saved.proposals} proposals, dropped ${JSON.stringify(an.check.dropped.map(d => d.reason))}`);
    const listed = await store.listMappings(admin, a, materialId);
    const maps = listed.ok ? listed.data.mappings : [];
    const byId = new Map(comps.map(c => [c.id, c]));
    ok("S1. every section is analysed, and each respiratory section has concepts that appear in it",
      (await store.analysisStatus(admin, a, materialId) as any).data?.analysed === 3 && listed.ok
      && [sec1, sec2].every(s => (listed.data.concepts.get(s.id) ?? []).length > 0 && (listed.data.concepts.get(s.id) ?? []).every(c => conceptInText(c, s.content))),
      JSON.stringify(listed.ok ? [...listed.data.concepts] : null));
    ok("S2. ⚠ every proposal names a competency the catalogue offered, in its catalogue layer, with model, prompt version and confidence",
      maps.length > 0 && maps.every(m => byId.has(m.competencyId) && byId.get(m.competencyId)!.layer === m.layer && m.source === "ai"
        && m.model && m.promptVersion === PROMPT_VERSIONS.map && m.confidence !== null && m.confidence >= 0.3 && m.confidence <= 1 && m.state === "proposed"),
      JSON.stringify(maps.map(m => [byId.get(m.competencyId)?.code, m.layer, m.confidence])));
    const codesFor = (chunkId: string) => maps.filter(m => m.chunkId === chunkId).map(m => byId.get(m.competencyId)?.code ?? "?");
    note(`section 1 -> ${codesFor(sec1.id).join(", ")} | section 2 -> ${codesFor(sec2.id).join(", ")} | section 3 -> ${codesFor(sec3.id).join(", ")}`);
    ok("S3. the slice: respiratory notes map to BOTH foundational and nursing respiratory competencies, several per section where they fit",
      maps.some(m => m.layer === "foundational") && maps.some(m => m.layer === "profession" && byId.get(m.competencyId)?.frameworkId === nr.id)
      && maps.filter(m => m.chunkId === sec1.id || m.chunkId === sec2.id).some(m => byId.get(m.competencyId)?.frameworkId === nr.id)
      && Math.max(...[sec1, sec2, sec3].map(s => codesFor(s.id).length)) >= 2);
    const again = await store.unanalysedSections(admin, a, materialId, 6);
    ok("S4. re-running analyses nothing twice (every section sent is marked)", again.ok && again.data.length === 0);

    // ── D. corrections ──
    const s1maps = maps.filter(m => m.chunkId === sec1.id).sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0));
    const s2maps = maps.filter(m => m.chunkId === sec2.id).sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0));
    const accept = s1maps[0] ?? s2maps[0];
    const reject = [...s1maps, ...s2maps].find(m => m.id !== accept?.id);
    const dA = accept ? await store.decideMapping(admin, a, accept.id, "accepted", null) : "failed";
    const dR = reject ? await store.decideMapping(admin, a, reject.id, "rejected", "Not what this section is about") : "failed";
    const st1 = await store.listMappings(admin, a, materialId);
    const get = (id: string | undefined) => st1.ok ? st1.data.mappings.find(m => m.id === id) : undefined;
    ok("D1. accepting and rejecting are recorded as decisions, and the state follows", dA === "ok" && dR === "ok" && get(accept?.id)?.state === "accepted" && get(reject?.id)?.state === "rejected");
    await store.decideMapping(admin, a, reject!.id, "accepted", null);
    await store.decideMapping(admin, a, reject!.id, "rejected", null);
    const st2 = await store.listMappings(admin, a, materialId);
    const rj = st2.ok ? st2.data.mappings.find(m => m.id === reject!.id) : undefined;
    const trail = (await admin.from("individual_scholar_competency_decision").select("decision").eq("map_id", reject!.id).order("created_at")).data ?? [];
    ok("D2. a change of mind is another row: every decision stays on the record, the latest decides", rj?.state === "rejected" && rj?.decisions === 3 && trail.map((t: any) => t.decision).join(",") === "rejected,accepted,rejected");
    const firstDecision = (await admin.from("individual_scholar_competency_decision").select("id").eq("map_id", accept!.id).limit(1).single()).data;
    const upd = await admin.from("individual_scholar_competency_decision").update({ decision: "rejected" }).eq("id", firstDecision.id).select("id");
    const del = await admin.from("individual_scholar_competency_decision").delete().eq("id", firstDecision.id).select("id");
    const still = (await admin.from("individual_scholar_competency_decision").select("decision").eq("id", firstDecision.id).maybeSingle()).data;
    ok("D3. ⚠ the trail refuses UPDATE and DELETE, even by the service role", !!upd.error && !!del.error && still?.decision === "accepted", `${upd.error?.message} | ${del.error?.message}`);
    const free = comps.find(c => !maps.some(m => m.chunkId === sec3.id && m.competencyId === c.id) && c.layer === "foundational")!;
    const add1 = await store.addMapping(admin, a, { chunkId: sec3.id, competencyId: free.id, layer: free.layer, programmeCode: PROG.nursing });
    const add2 = await store.addMapping(admin, a, { chunkId: sec3.id, competencyId: free.id, layer: free.layer, programmeCode: PROG.nursing });
    const st3 = await store.listMappings(admin, a, materialId);
    const mine = st3.ok ? st3.data.mappings.find(m => m.chunkId === sec3.id && m.competencyId === free.id) : undefined;
    ok("D4. a person can link a competency the AI did not propose: source student, accepted, no model or confidence -- and not twice",
      add1 === "ok" && add2 === "exists" && mine?.source === "student" && mine.state === "accepted" && mine.model === null && mine.confidence === null);
    // Competencies not yet linked to section 3, so a refusal below is the CHECK speaking, not the unique index.
    const spare = comps.filter(c => c.id !== free.id && !maps.some(m => m.chunkId === sec3.id && m.competencyId === c.id));
    const noProv = await admin.from("individual_scholar_competency_map").insert({ user_id: a, material_id: materialId, chunk_id: sec3.id, competency_id: spare[0].id, layer: spare[0].layer, source: "ai" }).select("id");
    const fakeConf = await admin.from("individual_scholar_competency_map").insert({ user_id: a, material_id: materialId, chunk_id: sec3.id, competency_id: spare[1].id, layer: spare[1].layer, source: "student", confidence: 0.9 }).select("id");
    for (const r of [noProv, fakeConf]) if (r.data?.length) await admin.from("individual_scholar_competency_map").delete().eq("id", r.data[0].id);
    ok("D5. ⚠ the schema refuses an AI proposal without its provenance (388), and a person's link claiming a confidence (390)",
      !!noProv.error && /provenance_check/.test(noProv.error.message) && !!fakeConf.error && /provenance_check/.test(fakeConf.error.message),
      `${noProv.error?.message ?? "stored"} | ${fakeConf.error?.message ?? "stored (390 not applied?)"}`);
    const c389 = await admin.from("individual_scholar_competency_map").insert({ user_id: a, material_id: materialId, chunk_id: sec3.id, competency_id: spare[2].id, layer: "context", source: "student" }).select("id");
    if (!c389.error) { ok("D6. 389: a mapping may carry any of the five S1 layers (context accepted)", true); await admin.from("individual_scholar_competency_map").delete().eq("id", c389.data[0].id); }
    else if (/layer_check/.test(c389.error.message)) pend("D6. the five S1 layers", "migration 389 is not applied here yet");
    else ok("D6. 389: a mapping may carry any of the five S1 layers", false, c389.error.message);

    // ── I. isolation ──
    const bDecide = await store.decideMapping(admin, b, accept!.id, "rejected", null);
    const bList = await store.listMappings(admin, b, materialId);
    const bChunk = await store.chunkMappings(admin, b, sec1.id);
    const bAdd = await store.addMapping(admin, b, { chunkId: sec1.id, competencyId: free.id, layer: free.layer, programmeCode: null });
    const cross = await admin.from("individual_scholar_competency_map").insert({ user_id: b, material_id: materialId, chunk_id: sec1.id, competency_id: free.id, layer: "foundational", source: "student" }).select("id");
    ok("I1. ⚠ another person's store calls with this person's ids find nothing and change nothing, and the schema refuses their row on this material",
      bDecide === "not_found" && bList.ok && bList.data.mappings.length === 0 && bChunk.length === 0 && bAdd === "not_found" && !!cross.error
      && (await store.listMappings(admin, a, materialId) as any).data.mappings.find((m: any) => m.id === accept!.id)?.state === "accepted");
    const asA = createClient(url!, anonKey!, { auth: { persistSession: false } }), asB = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const [sA, sB] = [await asA.auth.signInWithPassword({ email: FIX.a, password: FIX_PASSWORD }), await asB.auth.signInWithPassword({ email: FIX.b, password: FIX_PASSWORD })];
    if (sA.error || sB.error) ok("I2. signed-in sessions", false, `${sA.error?.message} ${sB.error?.message}`);
    else {
      const rA = await asA.from("individual_scholar_competency_map").select("id").eq("material_id", materialId);
      const rB = await asB.from("individual_scholar_competency_map").select("id").eq("material_id", materialId);
      const dB = await asB.from("individual_scholar_competency_decision").select("id");
      const wA = await asA.from("individual_scholar_competency_decision").insert({ user_id: a, map_id: accept!.id, decision: "rejected", decided_by: "reviewer" }).select("id");
      const cfgB = await asB.from("individual_scholar_programme").select("code");
      ok("I2. ⚠ under RLS a person reads only their own mappings, cannot write a decision (not even a reviewer one), and cannot read configuration",
        (rA.data?.length ?? 0) > 0 && (rB.data?.length ?? -1) === 0 && (dB.data?.length ?? -1) === 0 && !!wA.error && (cfgB.data?.length ?? 0) === 0);
    }

    // ── L. S3 ──
    const p1 = await store.getPassage(admin, a, sec1.id);
    // A withheld answer is the check doing its job, and a student can ask again: each step may try twice.
    // Every answer that IS shown has passed the check either way.
    const twice = async (go: () => ReturnType<typeof runExplain>, what: string) => {
      const first = await go();
      if (first.ok && first.check.ok) return first;
      const why = !first.ok ? first.error : first.check.ok ? "" : `withheld:${first.check.reason} ${JSON.stringify(first.check.violations ?? [])}`;
      note(`${what}: first try ${why}, asked again`);
      return go();
    };
    const simplify = await twice(() => runExplain(a, "Explain this section as simply as possible.", [p1!], "simplify"), "simplify");
    const deeper = await twice(() => runExplain(a, "Explain this section in depth.", [p1!], "deeper"), "deeper");
    note(`simplify: ${simplify.ok ? (simplify.check.ok ? "shown" : `withheld:${simplify.check.reason}`) : simplify.error}; supplementary ${simplify.ok ? JSON.stringify(simplify.supplementary) : "-"}`);
    note(`deeper: ${deeper.ok ? (deeper.check.ok ? "shown" : `withheld:${deeper.check.reason}`) : deeper.error}; supplementary ${deeper.ok ? (deeper.supplementary ? (deeper.supplementary.ok ? "shown" : `withheld:${deeper.supplementary.reason}`) : "none") : "-"}`);
    ok("L1. simplify answers from the notes and never shows background beyond them",
      simplify.ok && simplify.check.ok && (simplify.supplementary === null || (!simplify.supplementary.ok && simplify.supplementary.reason === "not_this_mode")));
    ok("L2. go deeper answers from the notes; any background beyond them is separate, and free of figures and doses when shown",
      deeper.ok && deeper.check.ok && (deeper.supplementary === null || !deeper.supplementary.ok || !/\d|dose|mg\b/i.test(deeper.supplementary.text)));
    const t1 = await twice(() => runExplain(a, "Teach me this section step by step.", [p1!], "tutor"), "tutor turn 1");
    const t2 = t1.ok && t1.check.ok ? await twice(() => runExplain(a, "You count it for a full minute.", [p1!], "tutor", [{ role: "tutor", text: (t1.check as { text: string }).text }]), "tutor turn 2") : null;
    note(`tutor: turn 1 ${t1.ok ? (t1.check.ok ? "shown" : t1.check.reason) : t1.error}; turn 2 ${t2 ? (t2.ok ? (t2.check.ok ? "shown" : t2.check.reason) : t2.error) : "-"}`);
    ok("L3. the tutor teaches a step and continues from the student's reply, each turn checked against the notes",
      t1.ok && t1.check.ok && !!t2 && t2.ok && t2.check.ok && /\[S1\]/.test(t2.check.text));

    // ── Q. S4 ──
    const lead = leadingCompetency(await store.chunkMappings(admin, a, sec1.id));
    ok("Q0. a question from section 1 practises its ACCEPTED competency, not a stronger proposal", lead === accept!.competencyId || accept!.chunkId !== sec1.id, `${lead} vs ${accept!.competencyId}`);
    const qs = await runQuestions(a, "mcq", p1!, 2);
    const qSaved = qs.ok ? await store.insertQuestions(admin, a, { passage: p1!, kind: "mcq", drafts: qs.check.kept, model: qs.model, provider: qs.provider, promptVersion: qs.promptVersion, competencyId: lead }) : { ok: false, ids: [] };
    const qRows = (await store.listQuestions(admin, a, { materialId, kind: "mcq" }) as any).data ?? [];
    ok("Q1. practice questions are stored tagged to that competency", qSaved.ok && qSaved.ids.length > 0 && qRows.length === qSaved.ids.length && qRows.every((q: any) => q.competencyId === lead && q.caseId === null),
      `kept ${qs.ok ? qs.check.kept.length : qs.error}, dropped ${qs.ok ? JSON.stringify(qs.check.dropped.map(d => d.reason)) : "-"}`);
    const p2 = await store.getPassage(admin, a, sec2.id);
    const cs = await runCase(a, p2!);
    note(`case: ${cs.ok ? `${cs.steps.length} steps, title "${cs.title}", dropped ${JSON.stringify(cs.dropped.map(d => d.reason))}` : cs.error}`);
    const caseLead = leadingCompetency(await store.chunkMappings(admin, a, sec2.id));
    const caseId = crypto.randomUUID();
    const cSaved = cs.ok && cs.steps.length >= CASE_MIN_STEPS
      ? await store.insertQuestions(admin, a, { passage: p2!, kind: "case", drafts: cs.steps, model: cs.model, provider: cs.provider, promptVersion: cs.promptVersion, competencyId: caseLead, caseId, caseTitle: cs.title })
      : { ok: false, ids: [] };
    const steps = (((await store.listQuestions(admin, a, { materialId, kind: "case" })) as any).data ?? []).filter((q: any) => q.caseId === caseId).sort((x: any, y: any) => x.caseStep - y.caseStep);
    ok("Q2. a multi-step practice case from the oxygen section: its steps stored in order under one case, the title on step 1 only, tied to the section's competency",
      cSaved.ok && steps.length >= CASE_MIN_STEPS && steps.every((s: any, i: number) => s.caseStep === i + 1 && (i === 0 ? !!s.caseTitle : s.caseTitle === null) && s.competencyId === caseLead));
    const badMcq = await admin.from("individual_scholar_question").insert({ ...base(a, materialId, sec2.id), kind: "mcq", case_id: caseId, case_step: 1 }).select("id");
    const badStep = await admin.from("individual_scholar_question").insert({ ...base(a, materialId, sec2.id), kind: "case", case_id: caseId, case_step: 6 }).select("id");
    const badTitle = await admin.from("individual_scholar_question").insert({ ...base(a, materialId, sec2.id), kind: "case", case_id: caseId, case_step: 2, case_title: "x" }).select("id");
    ok("Q3. ⚠ the schema refuses case steps on a practice question, a sixth step, and a title past step 1", !!badMcq.error && !!badStep.error && !!badTitle.error);

    // Answers, then progress by competency.
    for (const q of qRows) await store.recordAttempt(admin, a, q, q.correctIndex);
    if (qRows.length > 1) await store.recordAttempt(admin, a, qRows[1], (qRows[1].correctIndex + 1) % 4);
    if (steps[0]) await store.recordAttempt(admin, a, steps[0], steps[0].correctIndex);
    const rows = await store.competencyProgressRows(admin, a);
    const prog = rows.ok ? buildCompetencyProgress({
      competencies: comps, mappings: rows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
      questions: rows.data.questions, attempts: rows.data.attempts,
    }) : null;
    const prow = prog?.layers.flatMap(l => l.rows).find(r => r.id === lead);
    const rejOnly = prog?.layers.flatMap(l => l.rows).find(r => r.id === reject!.competencyId);
    const rejElsewhere = maps.some(m => m.competencyId === reject!.competencyId && m.id !== reject!.id);
    ok("Q4. progress by competency: the practised competency shows its linked sections and latest-try accuracy, unmeasured ones stay unmeasured",
      !!prow && prow.status === "practising" && prow.latestAccuracy !== null && prow.sectionsAccepted >= 1
      && !!prog && prog.layers.flatMap(l => l.rows).some(r => r.status === "no_notes" && r.latestAccuracy === null),
      JSON.stringify(prow));
    ok("Q5. a rejected link counts for nothing", rejElsewhere || (!!rejOnly && rejOnly.sectionsAccepted + rejOnly.sectionsProposed === 0), JSON.stringify(rejOnly));

    // ── A. the gateway ──
    const ai = (await admin.from("plat_ai_requests").select("operation, attribution_scope, tenant_id").eq("actor_id", a)).data ?? [];
    const ops = new Set(ai.map((r: any) => r.operation));
    ok("A1. every AI call went through generate(): person attribution, no tenant, the Scholar operations (map, explain, mcq, case steps)",
      ai.length > 0 && ai.every((r: any) => r.attribution_scope === "person" && r.tenant_id === null)
      && ["individual_scholar_map", "individual_scholar_explain", "individual_scholar_mcq", "individual_scholar_case_steps"].every(o => ops.has(o)), JSON.stringify([...ops]));

    // ── E. erasure through the append-only trail ──
    const er = await store.deleteMaterial(admin, a, materialId);
    const left = await Promise.all(["individual_scholar_competency_map", "individual_scholar_competency_decision", "individual_scholar_chunk_analysis", "individual_scholar_question"]
      .map(async t => (await admin.from(t).select("user_id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? -1));
    ok("E1. ⚠ erasing the material removes its concepts, mappings, decisions and questions -- the append-only trail still cascades", er.ok && left.every(n => n === 0), JSON.stringify(left));
    if (er.ok) materialId = null;
  } finally {
    await cleanupUsers();
    await cleanupProgrammes();
    // Compare-and-remove: only the row this run inserted, only while it is unchanged. Anything else is left alone.
    if (runAllowId) await admin.from("workspace_config_overrides").delete().eq("id", runAllowId).is("updated_by_name", null).is("updated_by", null);
    const now = (await admin.from("workspace_config_overrides").select("*").match(ALLOW).maybeSingle()).data;
    ok("Z1. the Scholar allowlist is as the run found it (the run removes only its own unchanged row)",
      runAllowId ? !now || now.id !== runAllowId : JSON.stringify(now) === JSON.stringify(before));
    const progLeft = (await admin.from("individual_scholar_programme").select("code").in("code", Object.values(PROG))).data ?? [];
    ok("Z2. the harness programmes and fixture identities are gone", progLeft.length === 0 && !(await findUser(FIX.a)) && !(await findUser(FIX.b)));
  }
}

function base(userId: string, materialId: string, chunkId: string) {
  return { user_id: userId, material_id: materialId, chunk_id: chunkId, stem: "harness?", options: ["a", "b", "c", "d"], correct_index: 0,
    rationale: "harness", source_quote: "harness", model: "harness", provider: "harness", prompt_version: "harness" };
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, e => { console.error(e); process.exit(1); });
