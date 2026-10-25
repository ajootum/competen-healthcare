/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR CLINICAL-REASONING-01 HARNESS -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A), over HTTP, STAGING ONLY.
 *
 * IND-004's steps of the owner's 19-step Stage 5 journey, on the respiratory materials, with REAL capabilities:
 *   C1  a private respiratory case written from the student's notes        C2  mapped to the CFCA where the notes are
 *   C3  a progressive scenario (nothing ahead)    C4  findings revealed appropriately, when asked for
 *   C5  findings interpreted and decisions made   C6  structured reasoning feedback and the debrief
 *   C7  saved and resumable, decisions append-only   C8  back to Teach Me or Revision
 *   C14 another student reuses a governed library case with no new generation (needs case_library ON and a
 *       deliverable case: IND-007's steps 9-13), else PEND. CASE_VERSION_ID picks the case. It is played to its
 *       first written decision through the shared delivery.
 *   C15 live AI on the Individual budget -- needs metering ON and METERED=1, else PEND: the private case's drafting,
 *       and the live AI feedback on the library case's written decision (charged by rule against the library
 *       session in ai_usage_ledger, recorded by the shared delivery, shown again on return, audited)
 *   C18 stored cases playable after the AI allowance is exhausted (synthetic quota rows for THIS fixture only)
 *   C19 no mandatory programme competency catalogue
 *   C9  (Scholar side) a case offered by the student's explicit action, as a source-free snapshot -- needs the flag
 *   C17 student privacy: isolation                 E1  erase-all, through the append-only trail
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON, the staging-test legal versions and URLs
 * (AI consent), an AI provider, migrations 406-409, 414-417, 422-424, 435-436, and the viewing programme. It READS
 * shared configuration (the case_library flag included) and never writes it. Fixtures: harness-clinical01-*,
 * deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-clinical01
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, DOCX_MIME, PDF_MIME, PPTX_MIME, TEXT_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyDocx, tinyPdf, tinyPptx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-clinical01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-clinical01-grantor@competen.test", a: "harness-clinical01-a@competen.test", b: "harness-clinical01-b@competen.test" };
const PW = `clinical01-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// The Stage 2 respiratory materials (as scholar-learn01-harness uses them).
const ANATOMY = [
  ["Respiratory anatomy.", "The upper airway includes the nose, the pharynx and the larynx.", "The trachea divides into the right and left main bronchi, which branch into bronchioles."],
  ["Gas exchange happens in the alveoli.", "Oxygen diffuses from the alveoli into the pulmonary capillaries.", "Hypoxaemia means a low level of oxygen in the blood."],
];
const PNEUMONIA = [
  { text: ["Community-acquired pneumonia", "Pneumonia is an infection of the lung tissue that fills the alveoli with fluid, which reduces gas exchange."], notes: ["Ask about cough, fever and breathlessness."] },
  { text: ["Assessment", "Measure the respiratory rate and the oxygen saturation.", "A low oxygen saturation shows hypoxaemia."], notes: ["Count the respiratory rate for a full minute."] },
  { text: ["Management", "Give oxygen to reach the target saturation range.", "Antibiotics are prescribed according to local guidance."] },
];
const OXYGEN = [
  "Oxygen therapy notes.",
  "Oxygen is a medicine and must be prescribed with a target saturation range.",
  "A target range is used because too little oxygen causes hypoxaemia and too much oxygen can also cause harm.",
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
    for (const t of ["case_candidate", "case_candidacy", "case_library_session", "individual_scholar_case_session", "individual_scholar_case", "individual_scholar_revision_session", "individual_scholar_revision_set", "individual_scholar_learning_session", "individual_scholar_learning_preference",
      "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context",
      "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
      await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
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
  return { status: res.status, text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "" };
}
async function send(method: string, path: string, body: unknown, jar?: Jar, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers, ...(jar ? { Cookie: cookieHeader(jar) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  if (slot.status !== 200) return null;
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: mime });
  if (put.error) return null;
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName, piiAttested: true }, jar);
  return done.status === 200 ? done.json.id as string : null;
}
async function analyseAll(jar: Jar, id: string) {
  for (let rounds = 0, left = 99; left > 0 && rounds < 8; rounds++) {
    const r = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, jar);
    if (r.status !== 200) break;
    left = r.json.remaining ?? 0;
  }
}
/** Start a case from notes. A withheld draft (422: the checks refused it) is the checks working; the student may ask again (once). A 502 is retried once and reported. */
async function makeCase(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `clin01-${Math.random().toString(36).slice(2, 12)}` });
  for (let tries = 1; tries < 3 && (r.status === 422 || r.status === 502); tries++) {
    note(`case: ${r.status} (${r.json?.error ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `clin01-${Math.random().toString(36).slice(2, 12)}` });
  }
  return r;
}
const CASE_PAGE = (kind: string, id: string) => `/individual/scholar/study/apply/case?kind=${kind}&session=${id}`;

async function main() {
  console.log(`SCHOLAR CLINICAL-REASONING-01 HARNESS -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m435 = !(await admin.from("individual_scholar_case").select("id").limit(0)).error;
  const libFlag = ((await admin.from("practice_platform_flags").select("enabled").eq("flag", "case_library").maybeSingle()).data as any)?.enabled === true;
  note(`migrations here: 435/436 ${m435} · case_library flag ${libFlag ? "ON" : "OFF"}`);
  if (!m435) { pend("C1-C19", "435 and 436 must be applied on this environment"); return; }

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
  note(`programme for A: ${programme?.code ?? "none"} · B has none · contexts ${policy.scholarCaseContexts.join(",")} · entries ${policy.scholarCaseEntries.join(",")}`);
  const consentA = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  const consentB = await send("POST", "/api/individual/scholar/consent", { grant: true }, sb.jar);
  if (consentA.status !== 200 || consentB.status !== 200) { pend("C1-C19", `AI consent could not be given here (${consentA.status}/${consentB.status} ${consentA.json?.error ?? ""})`); return; }
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const ids = {
    anatomy: await upload(sa.jar, PDF_MIME, tinyPdf(ANATOMY as any), "Respiratory anatomy notes.pdf"),
    pneumonia: pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
      : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt"),
    oxygen: await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx"),
  };
  const docs = Object.values(ids).filter((x): x is string => !!x);
  for (const id of docs) await analyseAll(sa.jar, id);
  note(`materials: ${docs.length} uploaded and analysed`);

  // ── C1: a private respiratory case from the notes ──
  const genBefore = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0;
  const made = await makeCase(sa.jar, { entry: "notes", scope: { kind: "documents", materialIds: [ids.oxygen, ids.pneumonia].filter(Boolean) }, context: "medical", mode: "guided", generateAnyway: true });
  const play = made.json?.play;
  const audits = ((await admin.from("audit_log").select("new_value").eq("actor_id", a).eq("entity_type", "individual_scholar_case_blueprint").order("created_at")).data ?? []) as any[];
  for (const x of audits) note(`case draft: ${x.new_value.outcome} ${JSON.stringify(x.new_value.problems ?? [])}`);
  const caseRow = made.json?.caseId ? ((await admin.from("individual_scholar_case").select("blueprint, review_status, origin, context").eq("user_id", a).eq("id", made.json.caseId).maybeSingle()).data as any) : null;
  ok("C1. a private respiratory case is written from the student's notes, checked, stored private formative, and its session starts",
    made.status === 200 && !!play?.sessionId && caseRow?.review_status === "private_formative" && caseRow?.blueprint?.schema === "case-blueprint/1" && caseRow.blueprint.progression.length === 0,
    `${made.status} ${made.json?.error ?? ""} · stages ${caseRow?.blueprint?.stages?.length} decisions ${caseRow?.blueprint?.decisionPoints?.length}`);
  if (!play) return;
  const bp = caseRow.blueprint;
  const compRows = ((await admin.from("individual_scholar_case_competency").select("competency_id").eq("user_id", a).eq("case_id", made.json.caseId)).data ?? []) as any[];
  const srcRows = ((await admin.from("individual_scholar_case_source").select("chunk_id").eq("user_id", a).eq("case_id", made.json.caseId)).data ?? []) as any[];
  ok("C2. the case is mapped to the CFCA where the notes are: its objectives name the linked competencies, kept as typed links, and it names its source sections",
    srcRows.length > 0 && (compRows.length > 0 || (bp.learningObjectives ?? []).every((l: any) => (l.competencyIds ?? []).length === 0)),
    `competencies ${compRows.length} · objectives ${(bp.learningObjectives ?? []).length} · sources ${srcRows.length}`);
  note(`case: "${bp.title}" · ${bp.stages.length} stages · ${bp.decisionPoints.length} decisions (${bp.decisionPoints.map((d: any) => d.kind).join(",")}) · ${bp.facts.length} findings · ${bp.safetyCriteria.length} safety criteria · CFCA ${compRows.length}`);

  // ── C3/C4: progressive, nothing ahead; findings revealed when asked for ──
  const v0 = play.view;
  const json0 = JSON.stringify(play);
  ok("C3. the scenario is progressive: the first stage only, no future stage, no key, rationale, expected answer, safety flag, source reference or salt",
    v0.stages.length === 1 && !/"correct"|"rationale"|expectedResponse|sourceRefs|safetyCritical|view_salt|viewSalt/.test(json0) && !bp.stages.slice(1).some((s: any) => json0.includes(s.title)));
  const askable = v0.stages[0].decisionPoints.flatMap((d: any) => d.canReveal);
  let revealOk = true, revealedLabel = "";
  if (askable.length) {
    const rv = await send("POST", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}/reveal`, { factToken: askable[0].token }, sa.jar);
    revealedLabel = askable[0].label;
    revealOk = rv.status === 200 && rv.json.play.view.facts.some((f: any) => f.label === askable[0].label);
    const bogus = await send("POST", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}/reveal`, { factToken: "not-a-token" }, sa.jar);
    revealOk = revealOk && bogus.status === 400;
  }
  ok("C4. findings are revealed appropriately: what the decision permits is shown when asked for, and nothing else can be asked for",
    revealOk, askable.length ? `asked for "${revealedLabel}"` : "this case permits no request at the first decision");

  // ── C5/C6: interpret, decide, with structured feedback; leave and resume (C7) mid-case ──
  const answerFor = (dp: any, right: boolean, salt: string, token: string) => {
    const d = bp.decisionPoints.find((x: any) => x.prompt === dp.prompt);
    if (!d) return null;
    if (d.kind === "free_text") return { decisionToken: token, text: right ? d.expectedResponse : "I am not sure." };
    const pick = d.options.filter((o: any) => (right ? o.correct : !o.correct)).slice(0, d.kind === "single" ? 1 : 2).map((o: any) => d.options.indexOf(o));
    return { decisionToken: token, optionTokens: pick.map((i: number) => dp.options[i].token) };
  };
  let cur = play, wrongOnce = false, resumeOk = false;
  const feedbacks: any[] = [];
  for (let step = 0; step < 10 && cur.status === "active"; step++) {
    const stage = cur.view.stages[cur.view.stages.length - 1];
    const dp = stage.decisionPoints.find((d: any) => !cur.answered.includes(d.token));
    if (!dp) break;
    const body = answerFor(dp, wrongOnce, "", dp.token);
    wrongOnce = true;
    if (!body) break;
    const r = await send("POST", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}/answer`, body, sa.jar);
    if (r.status !== 200) { note(`answer ${r.status} ${r.json?.error ?? ""}`); break; }
    feedbacks.push(r.json.feedback);
    cur = r.json.play;
    if (step === 0) {
      const back = await send("GET", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}`, undefined, sa.jar);
      resumeOk = back.status === 200 && back.json.play.answered.length === cur.answered.length && back.json.play.view.stages.length === cur.view.stages.length;
    }
  }
  ok("C5. the student interprets findings and makes decisions: each decision is recorded and the case moves on by its own progression to the end",
    cur.status === "completed" && cur.answered.length === bp.decisionPoints.length, `status ${cur.status} · answered ${cur.answered.length}/${bp.decisionPoints.length}`);
  ok("C6. structured reasoning feedback: each decision shows the key and its rationale and says how it was marked; the debrief reports by dimension, safety points, and objectives, labelled formative",
    feedbacks.length === bp.decisionPoints.length && feedbacks.every(f => f.answered && typeof f.markingLabel === "string") && !!cur.debrief && Array.isArray(cur.debrief.dimensions) && /not an assessment/.test(cur.debrief.label ?? ""),
    `feedback ${feedbacks.length} · markings ${[...new Set(feedbacks.map(f => f.marking))].join(",")} · debrief dims ${cur.debrief?.dimensions?.length}`);
  const decisions = ((await admin.from("individual_scholar_case_answer").select("id").eq("user_id", a).eq("session_id", play.sessionId)).data ?? []) as any[];
  const rewrite = decisions[0] ? await admin.from("individual_scholar_case_answer").update({ correct: true }).eq("id", decisions[0].id) : { error: { message: "none" } };
  ok("C7. the case is saved and resumable: leaving after the first decision and coming back shows the same place; every decision is kept as made (append-only)",
    resumeOk && decisions.length === bp.decisionPoints.length && !!rewrite.error, `resume ${resumeOk} · rows ${decisions.length} · rewrite refused ${!!rewrite.error}`);

  // ── C8: back to Teach Me or Revision ──
  const pageC = await get(CASE_PAGE("private", play.sessionId), sa.jar);
  const firstSrc = srcRows[0]?.chunk_id;
  const learn = firstSrc ? await get(`/individual/scholar/study/learn?section=${firstSrc}`, sa.jar) : { status: 0 };
  const apply = firstSrc ? await get(`/individual/scholar/study/apply?section=${firstSrc}&from=teach`, sa.jar) : { status: 0, text: "" };
  ok("C8. the student can return to Teach Me or Revision: the case page links to Revise and Try another case, Teach me opens on the case's section, and Teach Me can start a case on its section",
    pageC.status === 200 && pageC.text.includes("Revise related knowledge") && pageC.text.includes("Try another case") && learn.status === 200 && apply.status === 200 && (apply as any).text.includes("The section you were learning"),
    `${pageC.status} · learn ${learn.status} · apply ${apply.status}`);

  // ── C14: library reuse without generation (needs the case_library flag and a deliverable case) ──
  let libWritten: { sessionId: string; token: string; feedback: any } | null = null;
  if (!libFlag) pend("C14", "the case_library flag is OFF on this environment (the owner's), so the library entry and reuse are not offered");
  else {
    const lib = await send("GET", "/api/individual/scholar/clinical/library", undefined, sb.jar);
    // CASE_VERSION_ID (optional) names the published case to play, where the run was given one.
    const offers = (lib.json?.offers ?? []) as any[];
    const offer = offers.find(o => o.versionId === process.env.CASE_VERSION_ID) ?? (process.env.CASE_VERSION_ID ? null : offers[0]);
    if (!offer) pend("C14", process.env.CASE_VERSION_ID ? `version ${process.env.CASE_VERSION_ID} is not offered here (offers: ${offers.map(o => o.versionId).join(",") || "none"})` : "no published, approved library case on this environment yet (IND-007's steps 9-13)");
    else {
      const aiB0 = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", b).limit(1)).count ?? 0;
      const st = await send("POST", "/api/individual/scholar/clinical/sessions", { versionId: offer.versionId }, sb.jar);
      const aiB1 = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", b).limit(1)).count ?? 0;
      ok("C14. another student plays a governed library case with no new generation: through the shared delivery, labelled approved for its exact version, no AI call",
        st.status === 200 && st.json?.kind === "library" && /clinically approved for this exact version/.test(st.json?.play?.label ?? "") && aiB1 === aiB0, `${st.status} ${st.json?.error ?? ""} · ai ${aiB0}->${aiB1}`);
      // Played to its first WRITTEN decision through the shared delivery (choices: the first option, not the key --
      // the harness never reads the blueprint either). That written answer is where the live AI feedback is given.
      let lp = st.json?.play;
      for (let step = 0; lp && lp.status === "active" && step < 12 && !libWritten; step++) {
        const dp = lp.view.stages[lp.view.stages.length - 1].decisionPoints.find((d: any) => !lp.answered.includes(d.token));
        if (!dp) break;
        const body = dp.kind === "free_text" ? { decisionToken: dp.token, text: "I would reassess the airway, breathing and oxygen saturation, give oxygen to the target range, and escalate if it does not improve." }
          : { decisionToken: dp.token, optionTokens: [dp.options[0].token] };
        const r = await send("POST", `/api/individual/scholar/clinical/sessions/library/${lp.sessionId}/answer`, body, sb.jar);
        if (r.status !== 200) { note(`library answer ${r.status} ${r.json?.error ?? ""}`); break; }
        if (dp.kind === "free_text") libWritten = { sessionId: lp.sessionId, token: dp.token, feedback: r.json.feedback };
        lp = r.json.play;
      }
      note(`library case ${offer.versionId}: ${libWritten ? "a written decision answered" : "no written decision reached"} · status ${lp?.status}`);
    }
  }

  // ── C15: live case AI on the Individual budget (metering ON, the owner's switch, then METERED=1) ──
  if (process.env.METERED !== "1") pend("C15", "the Individual budget attribution of live case AI needs metering switched on for the run (the owner's switch), then METERED=1");
  else {
    const ledger = async (user: string, activity: string) => ((await admin.from("ai_usage_ledger").select("owner_type, product, activity, status, record_type, record_ref")
      .eq("user_id", user).eq("activity", activity).order("created_at", { ascending: false })).data ?? []) as any[];
    const drafts = await ledger(a, "case_steps");
    ok("C15. live AI on the Individual budget: drafting a private case is reserved and settled on the student's own Individual account, product scholar",
      drafts.length > 0 && drafts.every(r => r.owner_type === "individual" && r.product === "scholar") && drafts.some(r => r.status === "settled"),
      `case_steps rows ${drafts.length} · ${[...new Set(drafts.map(r => `${r.owner_type}/${r.status}`))].join(",")}`);
    if (!libFlag || !libWritten) pend("C15-library", !libFlag ? "the case_library flag is OFF" : "the library case played has no written decision reached (or none was offered)");
    else {
      const evals = (await ledger(b, "evaluate")).filter(r => r.record_ref === libWritten!.sessionId);
      const again = await send("GET", `/api/individual/scholar/clinical/sessions/library/${libWritten.sessionId}`, undefined, sb.jar);
      const kept = (again.json?.play?.feedback ?? []).find((f: any) => f.token === libWritten!.token);
      const audited = ((await admin.from("audit_log").select("new_value").eq("actor_id", b).eq("entity_type", "individual_scholar_case_reasoning").eq("entity_id", libWritten.sessionId)).data ?? []) as any[];
      ok("C15. live AI feedback on a library case's written decision: labelled AI evaluation, charged to the student's Individual budget by rule against the library session, recorded by the shared delivery and shown again on return",
        libWritten.feedback?.marking === "ai_evaluation" && typeof libWritten.feedback?.aiFeedback === "string" && libWritten.feedback.aiFeedback.length > 0
          && evals.length > 0 && evals.every(r => r.owner_type === "individual" && r.product === "scholar" && r.record_type === "case_library_session") && evals.some(r => r.status === "settled")
          && again.status === 200 && kept?.aiFeedback === libWritten.feedback.aiFeedback && audited.some(x => x.new_value?.outcome === "recorded"),
        `marking ${libWritten.feedback?.marking} · ledger ${evals.length} ${[...new Set(evals.map(r => `${r.owner_type}/${r.record_type}/${r.status}`))].join(",")} · kept ${!!kept} · audit ${audited.map(x => x.new_value?.outcome).join(",")}`);
    }
  }

  // ── C18: stored cases stay playable with the AI allowance used up (the Individual quota, THIS fixture only) ──
  const usage = Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_clinical01_continuity", new_value: { synthetic: true } }));
  await admin.from("audit_log").insert(usage);
  const replay = await send("POST", "/api/individual/scholar/clinical/sessions", { caseId: made.json.caseId }, sa.jar);
  const rAns = replay.json?.play ? await send("POST", `/api/individual/scholar/clinical/sessions/private/${replay.json.play.sessionId}/answer`,
    answerFor(replay.json.play.view.stages[0].decisionPoints[0], true, "", replay.json.play.view.stages[0].decisionPoints[0].token), sa.jar) : null;
  const newCase = await send("POST", "/api/individual/scholar/clinical/cases", { entry: "notes", scope: { kind: "document", materialId: ids.oxygen }, generateAnyway: true }, sa.jar);
  const pages = await Promise.all([CASE_PAGE("private", play.sessionId), "/individual/scholar/study/apply"].map(p => get(p, sa.jar)));
  ok("C18. with the AI allowance used up, stored cases stay playable and marked by their key, the finished case and history open, and only a NEW case is refused, saying so",
    replay.status === 200 && rAns?.status === 200 && (newCase.status === 429 || newCase.status === 409) && pages.every(p => p.status === 200),
    `replay ${replay.status} · answer ${rAns?.status} ${rAns?.json?.feedback?.marking ?? ""} · new ${newCase.status} ${newCase.json?.error ?? ""} · pages ${pages.map(p => p.status)}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_clinical01_continuity");

  // ── C19: no mandatory programme competency catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  if (bDoc) await analyseAll(sb.jar, bDoc);
  const bCase = bDoc ? await makeCase(sb.jar, { entry: "notes", scope: { kind: "document", materialId: bDoc }, generateAnyway: true }) : null;
  for (const x of ((await admin.from("audit_log").select("new_value").eq("actor_id", b).eq("entity_type", "individual_scholar_case_blueprint").order("created_at")).data ?? []) as any[])
    note(`case draft (B): ${x.new_value.outcome} ${JSON.stringify(x.new_value.problems ?? [])}`);
  ok("C19. without an assigned competency catalogue the workflow works: a case is written from the notes, starts, and Apply renders",
    bCase?.status === 200 && !!bCase.json?.play?.sessionId && (await get("/individual/scholar/study/apply", sb.jar)).status === 200, `${bCase?.status} ${bCase?.json?.error ?? ""}`);

  // ── 5B Scholar side: offer a case (needs the flag), and isolation ──
  if (!libFlag) pend("C9-offer", "the case_library flag is OFF: granting candidacy and offering a case are not available (IND-007's steps 9-13 follow from here)");
  else {
    const cand = await send("GET", "/api/individual/scholar/clinical/candidacy", undefined, sa.jar);
    const g = await send("POST", "/api/individual/scholar/clinical/candidacy", { attestation: "own_notes", attestationVersion: cand.json?.attestationVersion }, sa.jar);
    const off = await send("POST", `/api/individual/scholar/clinical/cases/${made.json.caseId}/offer`, { kind: "case" }, sa.jar);
    const row = ((await admin.from("case_candidate").select("snapshot, status").eq("user_id", a).order("offered_at", { ascending: false }).limit(1)).data ?? [])[0] as any;
    ok("C9. an offered case enters the review pipeline by the student's explicit action only, as a snapshot with no source references, screened by Holdings",
      g.status === 200 && off.status === 200 && ["eligible", "ineligible"].includes(off.json?.status) && (!row?.snapshot || !JSON.stringify(row.snapshot).includes("sourceRefs")),
      `grant ${g.status} ${g.json?.error ?? ""} · offer ${off.status} ${off.json?.status ?? off.json?.error} ${JSON.stringify(off.json?.reasons ?? [])}`);
  }
  const iGet = await send("GET", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}`, undefined, sb.jar);
  const iAns = await send("POST", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}/answer`, { decisionToken: "x" }, sb.jar);
  const iStart = await send("POST", "/api/individual/scholar/clinical/sessions", { caseId: made.json.caseId }, sb.jar);
  const iPage = await get(CASE_PAGE("private", play.sessionId), sb.jar);
  ok("C17. ⚠ student privacy: another student reaches none of it -- the session, an answer on it, the case, the case page -- all not found",
    iGet.status === 404 && iAns.status === 404 && iStart.status === 404 && iPage.text.includes("could not be found"), `${iGet.status}/${iAns.status}/${iStart.status}`);

  // ── E: erase-all leaves nothing of it ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = {
    cases: (await admin.from("individual_scholar_case").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
    sessions: (await admin.from("individual_scholar_case_session").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
    answers: (await admin.from("individual_scholar_case_answer").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
  };
  ok("E1. erase-all leaves no private case, session or decision (the append-only trail yields to the cascade)", erase.status === 200 && left.cases === 0 && left.sessions === 0 && left.answers === 0, `${erase.status} ${JSON.stringify(left)}`);
  note(`AI rows for A over the run: ${genBefore} -> ${(await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0}`);
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
