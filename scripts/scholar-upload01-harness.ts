/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR UPLOAD-01 HARNESS -- COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24), over HTTP, STAGING ONLY.
 *
 * The owner's acceptance scenario: three resources -- respiratory anatomy notes (a PDF with one scanned, empty
 * page), a pneumonia lecture (a PowerPoint with speaker notes) and oxygen therapy notes (a Word file) -- uploaded
 * in one session, read with real capabilities, ending in the EXISTING Learn experience (the Stage 3 hold stands).
 *
 *   U1  each is read by its real kind; PowerPoint slides cite "slide N"; the same file twice is refused, pointing at
 *       the copy; a macro-enabled or zip-bomb Office file is refused and its object removed
 *   U2  the empty PDF page is recorded and shown: "partly read", never a clean success
 *   U5  "Your notes are ready": all three, their read quality, Start learning = the existing material page,
 *       View original notes; rename, collections, topic correction (screened, personal, AI row kept)
 *   U3  AI suggestions record the catalogue version and (where named) a learning outcome that is the competency's
 *       own; a student's link may name an outcome, a bogus one is refused; the shared catalogue is unchanged
 *   U4  a question across the three is answered from more than one of them; chosen documents narrow it; a
 *       competency narrows it to the linked sections
 *   I   isolation: another student gets nothing of this library through any new route
 *   R1  (SCHOLAR_R1_ZZ=1 only) a catalogue-less zz programme: the absence is said, upload and learning still work.
 *       It CREATES and then deletes a synthetic programme row, which is shared staging configuration -- so it runs
 *       only when the owner asks for it with the flag
 *   E   erase-all leaves nothing: materials, objects, collections, topic corrections
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON, the staging-test legal versions AND
 * URLs (AI consent), an AI provider, migrations 406-409, the viewing programme with its allowlisted catalogues,
 * and "pptx" in scholar_upload_formats (scripts/seed-staging-scholar-pptx-format.ts, owner-run). What is missing
 * is a PEND with the reason, and nothing is written for it. It READS the shared configuration and never writes it
 * (except R1, behind its flag). Fixtures: harness-upl01-* identities, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-upload01
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, DOCX_MIME, PDF_MIME, PPTX_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { loadLearnerCatalogue } from "../src/lib/individual/scholar/competency-view";
import { tinyDocx, tinyPdf, tinyPptx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-upload01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const R1_ZZ = process.env.SCHOLAR_R1_ZZ === "1";
const ZZ_CODE = "zz-harness-no-catalogue";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-upl01-grantor@competen.test", a: "harness-upl01-a@competen.test", b: "harness-upl01-b@competen.test" };
const PW = `upl01-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// ── THE THREE RESOURCES ──
const ANATOMY_PDF = [
  ["Respiratory anatomy.", "The upper airway includes the nose, the pharynx and the larynx.", "The trachea divides into the right and left main bronchi, which branch into bronchioles."],
  [], // a scanned page: no text layer
  ["Gas exchange happens in the alveoli.", "Oxygen diffuses from the alveoli into the pulmonary capillaries.", "Hypoxaemia means a low level of oxygen in the blood."],
];
const PNEUMONIA_PPTX = [
  { text: ["Community-acquired pneumonia", "Pneumonia is an infection of the lung tissue that fills the alveoli with fluid."], notes: ["Ask about cough, fever and breathlessness."] },
  { text: ["Assessment", "Measure the respiratory rate and the oxygen saturation.", "A low oxygen saturation shows hypoxaemia."], notes: ["Count the respiratory rate for a full minute."] },
  { text: ["Management", "Give oxygen to reach the target saturation range.", "Antibiotics are prescribed according to local guidance."] },
];
const OXYGEN_DOCX = [
  "Oxygen therapy notes.",
  "Oxygen is a medicine and must be prescribed with a target saturation range.",
  "Check the prescription, the delivery device and the flow before starting oxygen therapy.",
  "A Venturi mask delivers a fixed concentration of oxygen.",
  "Monitor the oxygen saturation and escalate to the nurse in charge if hypoxaemia worsens.",
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
async function cleanup() {
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
    if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
    for (const t of ["individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
      await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  // R1's synthetic programme goes only after every learner row that names it (402 history has no cascade).
  if (R1_ZZ) await admin.from("individual_scholar_programme").delete().eq("code", ZZ_CODE);
}

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
async function get(path: string, jar?: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: jar ? { Cookie: cookieHeader(jar) } : {} });
  if (jar) absorb(jar, res);
  return { status: res.status, location: res.headers.get("location"), text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "" };
}
async function send(method: string, path: string, body: unknown, jar?: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookieHeader(jar) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) absorb(jar, res);
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}
async function signIn(email: string) {
  const jar: Jar = new Map();
  const r = await send("POST", "/api/auth/login", { email, password: PW }, jar);
  return { jar, status: r.status };
}
async function upload(jar: Jar, mime: string, bytes: Uint8Array, fileName: string) {
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return { slot, done: null as any };
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: mime });
  if (put.error) return { slot, done: { status: 0, json: { error: put.error.message } } };
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName, piiAttested: true }, jar);
  return { slot, done };
}
async function analyseAll(jar: Jar, id: string) {
  let left = 99, rounds = 0, proposals = 0;
  while (left > 0 && rounds < 8) {
    const r = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, jar);
    if (r.status !== 200) { note(`analyse ${id}: ${r.status} ${JSON.stringify(r.json)}`); break; }
    proposals += r.json.proposals ?? 0; left = r.json.remaining ?? 0; rounds++;
  }
  return { left, proposals };
}
/** The materials a set of explain passages came from. */
async function materialsOf(chunkIds: string[]): Promise<Set<string>> {
  if (!chunkIds.length) return new Set();
  const { data } = await admin.from("individual_scholar_chunk").select("material_id").in("id", chunkIds);
  return new Set(((data ?? []) as any[]).map(r => r.material_id));
}
async function explain(jar: Jar, body: Record<string, unknown>) {
  // A withheld answer is the grounding check doing its job; the student can ask again. Both tries are checked.
  let r = await send("POST", "/api/individual/scholar/explain", body, jar);
  if (r.status === 200 && !r.json?.answer && !r.json?.notInNotes) r = await send("POST", "/api/individual/scholar/explain", body, jar);
  const ids: string[] = r.json?.passageIds ?? (r.json?.sources ?? []).map((s: any) => s.chunkId);
  return { ...r, passages: ids, materials: await materialsOf(ids) };
}

async function main() {
  console.log(`SCHOLAR UPLOAD-01 HARNESS -- target ${ref}, server ${BASE}${R1_ZZ ? " (R1 zz programme ON)" : ""}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m406 = !(await admin.from("individual_scholar_material").select("extraction_quality").limit(0)).error;
  const m407 = !(await admin.from("individual_scholar_collection").select("id").limit(0)).error;
  const m408 = !(await admin.from("individual_scholar_topic_correction").select("chunk_id").limit(0)).error;
  note(`migrations here: 406 ${m406} · 407 ${m407} · 408 ${m408}`);

  await cleanup();
  const mk = async (email: string) => { const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw error; return data.user.id as string; };
  const grantor = await mk(FIX.grantor), a = await mk(FIX.a), b = await mk(FIX.b);
  const now = new Date().toISOString();
  for (const u of [a, b]) {
    const req = validateGrant({ targetUserId: u, experiences: ["scholar"], adultConfirmed: true });
    if (isGrantRefusal(req)) throw new Error(req.message);
    const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
    await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
      foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", u);
    await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", u);
  }
  const policy = await loadIndividualPolicy(admin);
  const rules = uploadRules(policy);
  const sa = await signIn(FIX.a), sb = await signIn(FIX.b);
  ok("0. two fixture students sign in", sa.status === 200 && sb.status === 200, `${sa.status}/${sb.status}`);
  const opts = await loadJoinOptions(admin, policy);
  const programme = opts.ok ? opts.options.programmes.find(p => p.code === "nursing-ug-diploma") ?? null : null;
  if (programme) await send("PUT", "/api/individual/scholar/programme", { code: programme.code, level: programme.levels[0]?.code ?? null }, sa.jar);
  note(`programme: ${programme?.code ?? "none"} · formats ${policy.scholarUploadFormats.join(", ")}`);
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const frameworkBefore = (await admin.from("framework_competencies").select("id", { count: "exact" }).limit(1)).count;

  // ── U1/U2: the three resources, in one session ──
  const pdf = await upload(sa.jar, PDF_MIME, tinyPdf(ANATOMY_PDF as any), "Respiratory anatomy notes.pdf");
  const docx = await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN_DOCX), "Oxygen therapy notes.docx");
  const pptxBytes = await tinyPptx(PNEUMONIA_PPTX);
  const pptx = pptxOn ? await upload(sa.jar, PPTX_MIME, pptxBytes, "Pneumonia lecture.pptx") : null;
  const ids = { pdf: pdf.done?.json?.id as string | undefined, docx: docx.done?.json?.id as string | undefined, pptx: pptx?.done?.json?.id as string | undefined };
  ok("U1a. the anatomy PDF and the oxygen therapy Word notes are read and kept", !!ids.pdf && !!ids.docx && docx.done.json.pages === null,
    `${pdf.done?.status} ${JSON.stringify(pdf.done?.json)} / ${docx.done?.status} ${JSON.stringify(docx.done?.json)}`);
  if (!pptxOn) pend("U1b. the pneumonia PowerPoint, slide by slide", `pptx is not in scholar_upload_formats here (${policy.scholarUploadFormats.join(", ")}) -- needs 406, then seed-staging-scholar-pptx-format.ts (owner-run)`);
  else {
    const chunks = ids.pptx ? (await admin.from("individual_scholar_chunk").select("page_from, content").eq("material_id", ids.pptx).order("ordinal")).data ?? [] : [];
    ok("U1b. the pneumonia PowerPoint is read slide by slide, speaker notes with their slide, each section on its slide",
      !!ids.pptx && pptx!.done.json.pages === 3 && (chunks as any[]).every(c => c.page_from >= 1 && c.page_from <= 3) && (chunks as any[]).some(c => /Speaker notes:/.test(c.content)),
      `${pptx!.done?.status} ${JSON.stringify(pptx!.done?.json)}`);
  }
  if (!m406) pend("U2. the empty PDF page is recorded and the material is partial", "406 not applied here: quality is not measured");
  else {
    const q = ids.pdf ? (await admin.from("individual_scholar_material").select("extraction_quality").eq("id", ids.pdf).single()).data?.extraction_quality : null;
    ok("U2. the scanned (empty) PDF page is recorded and the upload says partial -- never a clean success",
      pdf.done?.json?.status === "partial" && JSON.stringify(q?.empty_units) === "[2]" && q?.units === 3 && /Partly read/.test(pdf.done?.json?.quality?.summary ?? "")
      && docx.done?.json?.status === "ready", `${pdf.done?.json?.status} ${JSON.stringify(q)}`);
  }
  const objectsBefore = ((await admin.storage.from(BUCKET).list(a, { limit: 100 })).data ?? []).length;
  const dup = await upload(sa.jar, PDF_MIME, tinyPdf(ANATOMY_PDF as any), "anatomy again.pdf");
  const objectsAfter = ((await admin.storage.from(BUCKET).list(a, { limit: 100 })).data ?? []).length;
  ok("U1c. the same file twice is refused and points at the copy the student has; the second object is removed",
    dup.done?.status === 409 && dup.done?.json?.duplicateOf?.id === ids.pdf && objectsAfter === objectsBefore, `${dup.done?.status} ${JSON.stringify(dup.done?.json)} objects ${objectsBefore}->${objectsAfter}`);
  const { default: JSZip } = await import("jszip");
  const macro = await JSZip.loadAsync(await tinyDocx(["A harmless looking document."]));
  macro.file("word/vbaProject.bin", "macro project");
  const bomb = await JSZip.loadAsync(await tinyDocx(["Expands far."]));
  bomb.file("word/media/padding.xml", "0".repeat(130 * 1024 * 1024));
  const mac = await upload(sa.jar, DOCX_MIME, new Uint8Array(await macro.generateAsync({ type: "uint8array", compression: "DEFLATE" })), "macro.docx");
  const bom = await upload(sa.jar, DOCX_MIME, new Uint8Array(await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE" })), "bomb.docx");
  const scripted = new TextEncoder().encode(new TextDecoder("latin1").decode(tinyPdf([["A lecture handout."]]))
    .replace("/Type /Catalog", "/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"));
  const js = await upload(sa.jar, PDF_MIME, scripted, "handout.pdf");
  const objectsEnd = ((await admin.storage.from(BUCKET).list(a, { limit: 100 })).data ?? []).length;
  ok("U1d. ⚠ a macro-enabled Word file, a zip bomb and a PDF carrying a script are refused before they are read, and their objects removed",
    mac.done?.status === 422 && bom.done?.status === 422 && js.done?.status === 422 && /not read/.test(mac.done?.json?.error ?? "") && objectsEnd === objectsBefore,
    `${mac.done?.status} ${mac.done?.json?.error} / ${bom.done?.status} / pdf ${js.done?.status} / objects ${objectsEnd}`);

  const all = [ids.pdf, ids.docx, ids.pptx].filter((x): x is string => !!x);
  // ── U5: "Your notes are ready" ──
  const ready = await get(`/individual/scholar/study/ready?ids=${all.join(",")}`, sa.jar);
  ok("U5a. 'Your notes are ready' shows every new material, its read quality, Start learning on the EXISTING material page, and the original",
    ready.status === 200 && /Your notes are ready/.test(ready.text) && /Respiratory anatomy notes/.test(ready.text) && /Oxygen therapy notes/.test(ready.text)
    && (!m406 || /Partly read/.test(ready.text)) && all.every(id => ready.text.includes(`/individual/scholar/study/${id}"`)) && /View original notes/.test(ready.text)
    && /Explore competencies/.test(ready.text) && /Practise questions/.test(ready.text), `${ready.status}`);
  const readyB = await get(`/individual/scholar/study/ready?ids=${all.join(",")}`, sb.jar);
  ok("I1. ⚠ another student's 'notes are ready' with these ids shows none of them", readyB.status === 200 && !/Respiratory anatomy notes|Oxygen therapy notes/.test(readyB.text) && /nothing to show/i.test(readyB.text));

  // ── U3: AI mapping with versions and outcomes ──
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  if (consent.status !== 200) pend("U3/U4. AI topics, mapping and learning", `AI consent could not be given here (${consent.status} ${consent.json?.error ?? ""})`);
  else {
    const analysed = await Promise.all(all.map(id => analyseAll(sa.jar, id)));
    note(`analysis: ${analysed.map(r => `left ${r.left}, proposals ${r.proposals}`).join(" | ")}`);
    const full = await admin.from("individual_scholar_competency_map").select("id, competency_id, chunk_id, source, prompt_version, catalogue_version, outcome").eq("user_id", a);
    const maps = ((full.error ? (await admin.from("individual_scholar_competency_map").select("id, competency_id, chunk_id, source, prompt_version").eq("user_id", a)).data : full.data) ?? []) as any[];
    const ai = maps.filter(m => m.source === "ai");
    if (!programme) pend("U3a. suggestions record the catalogue version and a verified outcome", "no viewing programme here");
    else if (full.error) pend("U3a. suggestions record the catalogue version and a verified outcome", "408 not applied here");
    else {
      const comps = ((await admin.from("framework_competencies").select("id, learning_outcomes").in("id", [...new Set(ai.map(m => m.competency_id))])).data ?? []) as any[];
      const outcomesOf = new Map(comps.map(c => [c.id, (c.learning_outcomes ?? []) as string[]]));
      const named = ai.filter(m => m.outcome);
      ok("U3a. every AI suggestion records the catalogue version, the outcome-mapping prompt, and any outcome it names is the competency's own",
        ai.length > 0 && ai.every(m => /^\d+\.\d+\.\d+$/.test(m.catalogue_version ?? "") && m.prompt_version === "competency-map-v3-outcomes")
        && named.every(m => (outcomesOf.get(m.competency_id) ?? []).includes(m.outcome)), `${ai.length} ai rows, ${named.length} with an outcome`);
      note(`learning outcomes named by the AI this run: ${named.length} of ${ai.length}`);
      // A student's own link, naming an outcome of that competency -- one the learner's programme offers (S1, as the pages read it).
      const learnerCat = await loadLearnerCatalogue(admin, a);
      const offered = (learnerCat.competencies ?? []).find(c => c.outcomes.length && !maps.some(m => m.competency_id === c.id));
      const withOutcome = offered ? { id: offered.id, learning_outcomes: offered.outcomes } : null;
      const chunk = (await admin.from("individual_scholar_chunk").select("id").eq("material_id", ids.docx).order("ordinal").limit(1).single()).data?.id;
      if (!withOutcome || !chunk) pend("U3b. a student's own link may name one of the competency's outcomes", "no unlinked competency with outcomes in the programme");
      else {
        const bogus = await send("POST", "/api/individual/scholar/mappings", { chunkId: chunk, competencyId: withOutcome.id, outcome: "An outcome this competency does not have" }, sa.jar);
        const good = await send("POST", "/api/individual/scholar/mappings", { chunkId: chunk, competencyId: withOutcome.id, outcome: withOutcome.learning_outcomes[0] }, sa.jar);
        const row = (await admin.from("individual_scholar_competency_map").select("source, outcome, catalogue_version").eq("user_id", a).eq("chunk_id", chunk).eq("competency_id", withOutcome.id).maybeSingle()).data;
        const page = await get(`/individual/scholar/study/${ids.docx}`, sa.jar);
        ok("U3b. a student's link names one of the competency's own outcomes, with the catalogue version; an outcome it does not have is refused; the page shows it",
          bogus.status === 400 && good.status === 200 && row?.source === "student" && row?.outcome === withOutcome.learning_outcomes[0] && /^\d+\.\d+\.\d+$/.test(row?.catalogue_version ?? "")
          && page.text.includes("Learning outcome:"), `${bogus.status}/${good.status} ${JSON.stringify(row)}`);
      }
    }
    const frameworkAfter = (await admin.from("framework_competencies").select("id", { count: "exact" }).limit(1)).count;
    ok("U3c. ⚠ nothing the student did changed the shared catalogue", frameworkBefore === frameworkAfter, `${frameworkBefore} -> ${frameworkAfter}`);

    // ── U4: the cumulative library ──
    const across = await explain(sa.jar, { question: "How is oxygen given to a patient with hypoxaemia?", materialIds: all, mode: "explain" });
    ok("U4a. a question across the three materials is answered from more than one of them, each cited by name",
      across.status === 200 && across.materials.size >= 2 && (!across.json.answer || (across.json.sources ?? []).every((s: any) => s.materialTitle)),
      `${across.status} materials ${across.materials.size} ${across.json.answer ? "answered" : across.json.message}`);
    const chosen = await explain(sa.jar, { question: "How is oxygen given to a patient with hypoxaemia?", materialIds: [ids.docx], mode: "explain" });
    ok("U4b. choosing one document narrows the question to it", chosen.status === 200 && chosen.materials.size === 1 && chosen.materials.has(ids.docx!), `${[...chosen.materials].join(",")}`);
    const linked = ((await admin.from("individual_scholar_competency_map").select("competency_id, chunk_id").eq("user_id", a)).data ?? []) as any[];
    const target = linked[0]?.competency_id as string | undefined;
    if (!target) pend("U4c. a competency narrows the question to the linked sections", "no competency link in this run");
    else {
      const byComp = await explain(sa.jar, { question: "Explain this.", competencyId: target, mode: "explain" });
      const allowed = new Set(linked.filter(l => l.competency_id === target).map(l => l.chunk_id));
      ok("U4c. a competency narrows the question to the sections linked to it", byComp.status === 200 && byComp.passages.length > 0 && byComp.passages.every((c: string) => allowed.has(c)),
        `${byComp.status} ${byComp.passages.length} passages ${byComp.json.message ?? ""}`);
    }
    const bAsk = await explain(sb.jar, { question: "How is oxygen given to a patient with hypoxaemia?", materialIds: all, mode: "explain" });
    ok("I2. ⚠ another student asking of these material ids reaches none of them", bAsk.passages.length === 0, `${bAsk.status} ${bAsk.passages.length}`);
    const readyAfter = await get(`/individual/scholar/study/ready?ids=${all.join(",")}`, sa.jar);
    note(`ready page after analysis: topics ${/Topics/.test(readyAfter.text)}, related ${/Related in your library/.test(readyAfter.text)}, outcome ${/Learning outcome:/.test(readyAfter.text)}`);
  }

  // ── U5: organising and correcting ──
  if (!m407) pend("U5b. rename and collections", "407 not applied here");
  else {
    const coll = await send("POST", "/api/individual/scholar/collections", { name: "Respiratory module" }, sa.jar);
    const dupColl = await send("POST", "/api/individual/scholar/collections", { name: "respiratory module " }, sa.jar);
    const filed = await Promise.all(all.map(id => send("PATCH", `/api/individual/scholar/materials/${id}`, { collectionId: coll.json.id }, sa.jar)));
    const renamed = await send("PATCH", `/api/individual/scholar/materials/${ids.pdf}`, { title: "Respiratory anatomy (week 1)" }, sa.jar);
    const lib = await get("/individual/scholar/study", sa.jar);
    const bColl = await send("POST", "/api/individual/scholar/collections", { name: "Mine" }, sb.jar);
    const cross = await send("PATCH", `/api/individual/scholar/materials/${ids.pdf}`, { title: "taken" }, sb.jar);
    const crossShelf = await send("PATCH", `/api/individual/scholar/materials/${ids.docx}`, { collectionId: bColl.json.id }, sa.jar);
    ok("U5b. the student renames a material and shelves all three in a collection the library page groups by; a name they already use is refused",
      coll.status === 200 && dupColl.status === 409 && filed.every(f => f.status === 200) && renamed.status === 200
      && /Respiratory module/.test(lib.text) && /Respiratory anatomy \(week 1\)/.test(lib.text), `${coll.status}/${dupColl.status}/${filed.map(f => f.status)}/${renamed.status}`);
    ok("I3. ⚠ another student cannot rename this material, and this student cannot shelve into another's collection", cross.status === 404 && crossShelf.status === 404, `${cross.status}/${crossShelf.status}`);
  }
  if (!m408 || consent.status !== 200) pend("U5c. topic correction", !m408 ? "408 not applied here" : "no AI topics without consent");
  else {
    const chunk = (await admin.from("individual_scholar_chunk").select("id").eq("material_id", ids.pdf).order("ordinal").limit(1).single()).data?.id;
    const before = (await admin.from("individual_scholar_chunk_analysis").select("concepts").eq("chunk_id", chunk).maybeSingle()).data;
    const fix = await send("POST", "/api/individual/scholar/topics", { chunkId: chunk, topics: ["Upper airway", "Bronchial tree"] }, sa.jar);
    const pii = await send("POST", "/api/individual/scholar/topics", { chunkId: chunk, topics: ["NHS no 943 476 5919"] }, sa.jar);
    const bFix = await send("POST", "/api/individual/scholar/topics", { chunkId: chunk, topics: ["x y"] }, sb.jar);
    const after = (await admin.from("individual_scholar_chunk_analysis").select("concepts").eq("chunk_id", chunk).maybeSingle()).data;
    const page = await get(`/individual/scholar/study/${ids.pdf}`, sa.jar);
    ok("U5c. the student corrects a section's topics: theirs are shown, the AI record is kept, an identifier is refused, another student gets 404",
      fix.status === 200 && pii.status === 422 && bFix.status === 404 && JSON.stringify(before) === JSON.stringify(after)
      && /Corrected by you/.test(page.text) && /Bronchial tree/.test(page.text), `${fix.status}/${pii.status}/${bFix.status}`);
  }
  const learn = ids.docx ? await get(`/individual/scholar/study/${ids.docx}`, sa.jar) : null;
  ok("U5d. Start learning is the existing material page, with its Learn experience", learn?.status === 200 && /Ask about this material/.test(learn.text) && /Sections/.test(learn.text));

  // ── R1: a catalogue-less programme (flagged) ──
  if (!R1_ZZ) pend("R1. a catalogue-less zz programme says the absence and does not block learning", "run with SCHOLAR_R1_ZZ=1 (it creates and removes a synthetic programme row: owner's call)");
  else {
    const made = await admin.from("individual_scholar_programme").insert({ code: ZZ_CODE, label: "ZZ Harness Nursing (no catalogue)", profession: "Nursing", country: "UG", level: null, is_active: true });
    const set = await send("PUT", "/api/individual/scholar/programme", { code: ZZ_CODE, level: null }, sa.jar);
    const page = await get(`/individual/scholar/study/${ids.docx}`, sa.jar);
    const readyZ = await get(`/individual/scholar/study/ready?ids=${ids.docx}`, sa.jar);
    const ask = consent.status === 200 ? await explain(sa.jar, { question: "What does a Venturi mask deliver?", chunkId: (await admin.from("individual_scholar_chunk").select("id").eq("material_id", ids.docx).order("ordinal").limit(1).single()).data?.id, mode: "explain" }) : null;
    ok("R1. a catalogue-less programme: the material page and the ready page say so by name, and learning still works",
      !made.error && set.status === 200 && /ZZ Harness Nursing \(no catalogue\) has no competency catalogue Scholar can use yet/.test(page.text)
      && /has no competency catalogue Scholar can use yet/.test(readyZ.text) && (!ask || ask.status === 200),
      `${made.error?.message ?? "made"} / ${set.status} / ask ${ask?.status}`);
  }

  // ── E: erase-all leaves nothing ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = {
    materials: (await admin.from("individual_scholar_material").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count,
    objects: ((await admin.storage.from(BUCKET).list(a, { limit: 100 })).data ?? []).length,
    collections: m407 ? (await admin.from("individual_scholar_collection").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count : 0,
    topics: m408 ? (await admin.from("individual_scholar_topic_correction").select("chunk_id", { count: "exact" }).eq("user_id", a).limit(1)).count : 0,
  };
  ok("E1. erase-all leaves nothing of the library: materials, objects, collections, topic corrections", erase.status === 200 && Object.values(left).every(n => n === 0), `${erase.status} ${JSON.stringify(left)}`);
}

main()
  .catch(e => { fails.push(`crashed: ${e?.message ?? e}`); console.log(`  FAIL  crashed: ${e?.stack ?? e}`); })
  .finally(async () => {
    await cleanup().catch(() => {});
    const left = await Promise.all(Object.values(FIX).map(findUser));
    ok("Z1. fixture identities and their files are gone", left.every(x => !x));
    console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
    process.exit(fails.length ? 1 : 0);
  });
