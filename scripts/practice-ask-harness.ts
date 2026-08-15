/**
 * CPR-PI-001 v2 s13 harness -- Ask Practice, the grounded flow.
 *
 * WHAT IT PROVES:
 *   1. The parser is deterministic: periods and intents parse the way the module claims, money
 *      questions outrank count questions, and an unparseable question is UNKNOWN, never a guess.
 *   2. The answers are THE ENGINES' OWN NUMBERS: the overdue figure equals a direct count under
 *      followUpIntelligence's exact predicate, patients-seen equals the overview metric, the
 *      condition answer equals diagnosisReport's rows, the investigation answer equals the rows.
 *   3. An unknown question refuses honestly: answered false, ZERO figures, and the refusal lists
 *      what can be asked instead.
 *   4. Every ask leaves an audit row carrying the question, the interpreted scope and the metric
 *      ids WITH their registry versions -- and the recent-questions list is read back from exactly
 *      those rows, so no second history store exists to drift.
 *   5. Source pins: the engine never touches the model layer, the page mounts the grounded area
 *      inside the assistant tab only, and the area renders denominators beside figures.
 *
 *   npx --yes tsx scripts/practice-ask-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, recordDiagnosis, transitionEncounter } from "../src/lib/practice/encounters";
import { recordInvestigation } from "../src/lib/practice/encounter-workspace";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { askPractice, parseAskIntent, parseAskPeriod } from "../src/lib/practice/ask-practice";
import { metricById } from "../src/lib/practice/intelligence-registry";
import { practiceToday } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a5c13";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nCPR-PI-001 v2 s13 Ask Practice harness\n");
  await cleanup();

  // ── 1. The parser, pure ────────────────────────────────────────────────────
  const fb = { fromDay: "2026-07-01", toDay: "2026-07-31" };
  ok("1-1. 'last 30 days' becomes a rolling window ending today",
    parseAskPeriod("patients in the last 30 days", "2026-08-15", fb).fromDay === "2026-07-16"
      && parseAskPeriod("patients in the last 30 days", "2026-08-15", fb).toDay === "2026-08-15");
  ok("1-2. 'this month' anchors to the month's first day",
    parseAskPeriod("how many this month", "2026-08-15", fb).fromDay === "2026-08-01");
  const lastM = parseAskPeriod("revenue last month", "2026-08-15", fb);
  ok("1-3. 'last month' is the WHOLE previous calendar month",
    lastM.fromDay === "2026-07-01" && lastM.toDay === "2026-07-31", JSON.stringify(lastM));
  ok("1-4. no period words = the page's own selected range, and the label says so",
    parseAskPeriod("top diagnoses", "2026-08-15", fb).fromDay === "2026-07-01"
      && /selected period/.test(parseAskPeriod("top diagnoses", "2026-08-15", fb).periodLabel));
  ok("1-5. intents parse: overdue, conditions, investigations, patients, consultations",
    parseAskIntent("show patients overdue for follow-up") === "overdue_followups"
      && parseAskIntent("what are my most common diagnoses") === "top_conditions"
      && parseAskIntent("which investigations do i order most") === "investigations"
      && parseAskIntent("how many patients did i see") === "patients_seen"
      && parseAskIntent("how many consultations this month") === "consultations");
  ok("1-6. ⚠ money outranks counting: 'how many invoices were paid' is FINANCIAL, not a count",
    parseAskIntent("how many invoices were paid") === "financial"
      && parseAskIntent("how much did I collect") === "financial");
  ok("1-7. an unparseable question is UNKNOWN -- the parser never guesses",
    parseAskIntent("what is the meaning of life") === "unknown");

  // ── 2. Registry: s13's own entries exist and carry the s14 contract ───────
  ok("2-1. pi.overdue_now and ask.investigations_ordered are registered",
    !!metricById("pi.overdue_now") && !!metricById("ask.investigations_ordered"));
  ok("2-2. v2 s14: the proportion-capable ask metric declares numerator AND denominator",
    !!metricById("ask.investigations_ordered")?.numerator && !!metricById("ask.investigations_ordered")?.denominator);

  // ── 3. Live: grounded answers equal the engines' own numbers ──────────────
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-ask-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-ask",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS ASK (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-ask", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-ask" };
  const today = practiceToday("Africa/Kampala");
  const dayShift = (days: number) => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const askArgs = { fromDay: dayShift(-30), toDay: today, todayDate: today, ...base };

  const p1 = await registerPatient(admin, { workspaceId: ws, displayName: "Asks About Me", sex: "female", birthDate: "1980-01-01", phone: "0772 000 011", ...base });
  const p2 = await registerPatient(admin, { workspaceId: ws, displayName: "Second Patient", sex: "male", birthDate: "1985-01-01", phone: "0772 000 012", ...base });
  if (!p1.ok || !p2.ok) { ok("patients register", false); return report(); }
  const e1 = await launchEncounter(admin, { workspaceId: ws, patientId: p1.data.id, pathway: "new_walk_in", ...base });
  const e2 = await launchEncounter(admin, { workspaceId: ws, patientId: p2.data.id, pathway: "new_walk_in", ...base });
  if (!e1.ok || !e2.ok) { ok("encounters launch", false); return report(); }
  const dx = await recordDiagnosis(admin, { workspaceId: ws, encounterId: e1.data.id, label: "Malaria", certainty: "confirmed", ...base });
  if (!dx.ok) { ok("diagnosis records", false, (dx as any).message); return report(); }
  const inv = await recordInvestigation(admin, { workspaceId: ws, encounterId: e1.data.id, label: "Malaria RDT", ...base });
  if (!inv.ok) { ok("investigation records", false, (inv as any).message); return report(); }
  const fu = await createFollowUp(admin, { workspaceId: ws, patientId: p1.data.id, reason: "harness overdue", dueOn: dayShift(-2), ...base });
  if (!fu.ok) { ok("follow-up fixture", false, (fu as any).message); return report(); }
  // Completed AFTER the clinical writes (recording against a completed encounter would be refused):
  // patients_seen counts COMPLETED/SIGNED/AMENDED only, so the count question needs a completed pair.
  // DM-001 s8.1: DRAFT cannot jump to COMPLETED -- it walks DRAFT -> ACTIVE -> COMPLETED.
  for (const enc of [e1, e2]) {
    for (const to of ["ACTIVE", "COMPLETED"]) {
      const t = await transitionEncounter(admin, { workspaceId: ws, encounterId: enc.data.id, to, ...base });
      if (!t.ok) { ok(`encounter reaches ${to}`, false, (t as any).message); return report(); }
    }
  }

  // 3-1. Overdue: the grounded figure equals a direct count under the SAME predicate the
  // follow-up module states (OPEN/SCHEDULED, due before the practice's today).
  const direct = await admin.from("practice_follow_up").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).in("status", ["OPEN", "SCHEDULED"]).lt("due_on", today);
  const aOver = await askPractice(admin, ctx, { question: "show patients overdue for follow-up", ...askArgs });
  ok("3-1. overdue: answered, and the figure IS the module's own count",
    aOver.answered && aOver.intent === "overdue_followups"
      && aOver.figures[0]?.value === String(direct.count) && direct.count === 1
      && aOver.figures[0]?.registryId === "pi.overdue_now",
    JSON.stringify({ figure: aOver.figures[0], direct: direct.count }));
  ok("3-2. overdue evidence: the identified caller sees the patient BY NAME, rows link, and the note carries the absence rule",
    aOver.evidence !== null && aOver.evidence!.identified
      && aOver.evidence!.rows[0]?.label === "Asks About Me"
      && aOver.evidence!.rows[0]?.href === `/practice/patients/${p1.data.id}`
      && /never a claim that care did not occur/.test(aOver.evidence!.note)
      && aOver.evidence!.href === "/practice/follow-ups?filter=overdue",
    JSON.stringify(aOver.evidence));

  // 3-3. Patients seen: the overview metric's own value, with the visits-per-patient ratio as its
  // OWN figure -- the first draft fused the two universes into one sentence and the harness caught
  // "You saw 0 patients (2 visits over 2 patients)" against an open-encounter fixture.
  const aSeen = await askPractice(admin, ctx, { question: "how many patients did I see in the last 30 days", ...askArgs });
  ok("3-3. patients seen: 2 from the overview metric, ratio as a SEPARATE figure, period from the question",
    aSeen.answered && aSeen.figures[0]?.value === "2"
      && aSeen.scope.periodLabel === "the last 30 days"
      && /counting completed consultations only/.test(aSeen.sentence)
      && aSeen.figures[1]?.value === "2 visits / 2 patients"
      && aSeen.figures[1]?.registryId === "pi.avg_visits_per_patient",
    JSON.stringify({ f: aSeen.figures, scope: aSeen.scope.periodLabel, s: aSeen.sentence }));

  // 3-4. Conditions: diagnosisReport's rows, the label as typed, and the question's own condition scoped.
  const aCond = await askPractice(admin, ctx, { question: "top conditions: malaria?", ...askArgs });
  ok("3-4. conditions: Malaria, 1 patient of 1 record, and the scope caught the condition word",
    aCond.answered && aCond.scope.condition === "Malaria"
      && aCond.figures[0]?.label === "Malaria" && aCond.figures[0]?.value === "1 patients"
      && /newly RECORDED here is not a claim of onset/.test(aCond.sentence),
    JSON.stringify({ scope: aCond.scope, f: aCond.figures[0] }));

  // 3-5. Investigations: the new registered aggregate, denominator carried on the figure.
  const aInv = await askPractice(admin, ctx, { question: "which investigations do I order most?", ...askArgs });
  ok("3-5. investigations: Malaria RDT 1 of 1 requests, requested-not-resulted stated",
    aInv.answered && aInv.figures[0]?.label === "Malaria RDT"
      && aInv.figures[0]?.value === "1" && aInv.figures[0]?.of === "1 requests"
      && aInv.figures[0]?.registryId === "ask.investigations_ordered"
      && /Requested is not resulted/.test(aInv.evidence?.note ?? ""),
    JSON.stringify(aInv.figures[0]));

  // 3-6. Financial: permitted caller, empty billing -> the honest-empty sentence, never zeros-as-failure.
  const aFin = await askPractice(admin, ctx, { question: "how much did I collect this month?", ...askArgs });
  ok("3-6. financial with no billing rows: answered, genuinely-empty language, zero figures",
    aFin.answered && aFin.intent === "financial" && aFin.figures.length === 0
      && /genuinely empty money picture/.test(aFin.sentence),
    aFin.sentence);

  // 3-7. Unknown: refused with ZERO figures, and the refusal teaches what can be asked.
  const aUnk = await askPractice(admin, ctx, { question: "what is the meaning of life", ...askArgs });
  ok("3-7. ⚠ unknown question: not answered, no figures, examples offered -- never a guess",
    !aUnk.answered && aUnk.figures.length === 0 && aUnk.evidence === null
      && /not answered rather than guessed/.test(aUnk.sentence)
      && /overdue for follow-up/.test(aUnk.sentence),
    aUnk.sentence);

  // 3-8. The audit trail IS the history: rows carry question, scope and metric ids with versions,
  // and the recent list of a later ask contains the earlier question.
  const { data: trail } = await admin.from("practice_audit_event")
    .select("payload").eq("workspace_id", ws).eq("event_type", "practice.ask_practice")
    .order("occurred_at", { ascending: false });
  const overRow = ((trail ?? []) as any[]).map(r => r.payload)
    .find(p => p?.question === "show patients overdue for follow-up");
  ok("3-8. every ask audited: the overdue row carries scope + pi.overdue_now v1, the unknown row says answered false",
    (trail ?? []).length >= 6 && !!overRow
      && overRow.metrics?.[0]?.id === "pi.overdue_now" && overRow.metrics?.[0]?.version === 1
      && overRow.scope?.fromDay === askArgs.fromDay
      && ((trail ?? []) as any[]).map(r => r.payload).some(p => p?.intent === "unknown" && p?.answered === false),
    JSON.stringify(overRow));
  ok("3-9. recent questions are read back FROM the trail (no second store), excluding the question just asked",
    aUnk.recent.some(r => r.question === "show patients overdue for follow-up")
      && !aUnk.recent.some(r => r.question === "what is the meaning of life"),
    JSON.stringify(aUnk.recent));

  // ── 4. Source pins ─────────────────────────────────────────────────────────
  const engineSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "ask-practice.ts"), "utf8");
  const pageSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "page.tsx"), "utf8");
  const areaSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "AskPracticeArea.tsx"), "utf8");
  ok("4-1. ⚠ the grounded engine never touches the model layer",
    !engineSrc.includes("runAssistant") && !engineSrc.includes("ai-assistant"));
  ok("4-2. the overdue predicate is the follow-up module's, verbatim",
    engineSrc.includes('.in("status", ["OPEN", "SCHEDULED"]).lt("due_on", practiceNow)'));
  ok("4-3. the page mounts the grounded area inside the assistant tab, gated on a real question",
    pageSrc.includes("AskPracticeArea") && pageSrc.includes("sp.q && sp.q.trim().length >= 3"));
  ok("4-4. the area renders the denominator beside the figure and swaps DERIVED for the refusal chip",
    areaSrc.includes("of {f.of}") && areaSrc.includes('answer.answered ? "derived" : "refused"'));
  ok("4-5. the area states the absence rule as a standing footer",
    areaSrc.includes("never a claim that care did not happen"));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
