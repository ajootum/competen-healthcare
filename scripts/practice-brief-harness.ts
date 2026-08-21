/**
 * CPR-CORE-001 CORE-12: the derived brief with source references.
 *
 * WHAT THIS HAS TO PROVE:
 *   s3   "derived briefs must disclose WHEN they were calculated and WHAT SOURCE RECORDS were used"
 *   s7   "prioritised actionable sentences with source links", key rule "label DERIVED; no unsupported
 *        prediction"
 *   s11  the payload shape: {"status":"derived","items":[],"source_refs":[]}
 *   s13  "patient data must not be returned solely by human-readable name; use stable identifiers"
 *   s16  "no AI statement appears without authorised source data and a traceable basis"
 *
 * ⚠ THE PREDICTION CHECK IS THE ONE THAT MATTERS. Every other assertion here is structural and a
 * reviewer would notice it missing. "No unsupported prediction" is a claim about WORDING, which nothing
 * catches until somebody adds a helpful sentence about how the afternoon is going to go -- so it is
 * asserted against the sentences the service actually produces, with a control proving there were
 * sentences to check.
 *
 *   npx --yes tsx scripts/practice-brief-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { practiceBrief, FORBIDDEN_IN_BRIEF } from "../src/lib/practice/brief";
import { dashboardReadModel } from "../src/lib/practice/dashboard";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-00000000b21e";
const CORR = "harness-brief";
const ALL = ["practice.home.view", "practice.calendar.view", "encounter.list", "followup.view",
  "followup.manage", "task.view", "inbox.record", "document.view", "message.use", "patient.list",
  "patient.create", "report.view"];

const ctxFor = (workspaceId: string, caps = ALL): WorkspaceContext => ({
  userId: USER, workspaceId, workspaceName: "B", workspaceType: "individual_practice",
  workspaceStatus: "active",
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: "Africa/Kampala", roleCodes: ["owner"], capabilities: caps, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
});

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    for (const t of ["practice_follow_up_event", "practice_follow_up", "practice_domain_event",
      "practice_patient"]) {
      await admin.from(t).delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await admin.from("practice_audit_event").delete().eq("actor_id", USER);
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, ["practice_follow_up_event", "practice_follow_up", "practice_domain_event", "practice_patient"]);
}

async function main() {
  console.log("\n=== DERIVED BRIEF (CPR-CORE-001 CORE-12, s3/s7/s11/s16) ===\n");
  await cleanup();

  const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-brief-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (reqErr || !req) { console.error("provisioning request refused:", reqErr?.message); process.exitCode = 1; return; }
  const payload: IndividualRequest = {
    displayName: "Harness Brief", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: USER, correlation_id: CORR, workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed", run.errorCode); process.exitCode = 1; return; }
  const ws = run.workspaceId;
  const ctx = ctxFor(ws);

  // ── 1. The envelope s11 asks for ─────────────────────────────────────────────────────────────────
  const at = new Date("2026-08-05T09:30:00.000Z");
  const empty = practiceBrief({ attention: [], blindSpots: [] }, at);
  ok("1a. the brief is LABELLED derived, as a field rather than page text", empty.status === "derived");
  ok("1b. and discloses when it was calculated", empty.calculatedAt === at.toISOString(), empty.calculatedAt);
  ok("1c. and how, in the payload rather than in a component", empty.method.length > 20);
  ok("1d. an empty brief with nothing hidden is not 'unavailable'", !empty.unavailable);

  // ⚠ A CALLER WHO CAN SEE NOTHING HAS AN EMPTY BRIEF FOR A DIFFERENT REASON. Reporting both as "nothing
  // is waiting" would tell somebody with no permissions that their practice is calm.
  const blind = practiceBrief({ attention: [], blindSpots: ["follow-ups", "tasks"] }, at);
  ok("1e. an empty brief the caller cannot see past IS unavailable", blind.unavailable);
  ok("1f. and names what was withheld", blind.blindSpots.length === 2, blind.blindSpots.join(","));

  // ── 2. Source references, over a real overdue follow-up ──────────────────────────────────────────
  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .insert({ workspace_id: ws, display_name: "Trace Me", created_by: USER }).select("id").single();
  if (pErr || !patient) { console.error("patient fixture:", pErr?.message); process.exitCode = 1; return; }

  const fu = await createFollowUp(admin, {
    workspaceId: ws, patientId: patient.id, reason: "Overdue review for the brief",
    dueOn: "2020-01-01", priority: "urgent", actorId: USER, correlationId: CORR,
  });
  ok("2-setup. an overdue follow-up exists to be briefed about", fu.ok, fu.ok ? "" : JSON.stringify(fu));
  if (!fu.ok) { await cleanup(); report(); return; }

  const dash = await dashboardReadModel(admin, ctx);
  const brief = dash.brief;
  ok("2a-control. the brief has something to say", brief.items.length > 0,
    JSON.stringify(brief.items.map(i => i.key)));
  ok("2b. every sentence carries the rows it was counted from",
    brief.items.every(i => i.sourceRefs.length > 0),
    JSON.stringify(brief.items.map(i => [i.key, i.sourceRefs.length])));
  ok("2c. and every reference names its table AND a stable id",
    brief.sourceRefs.every(r => r.table.startsWith("practice_") && r.id.length > 10),
    JSON.stringify(brief.sourceRefs.slice(0, 3)));

  // ⚠ s13. A reference that carried the patient's NAME would make the brief a disclosure in itself --
  // readable over a shoulder on a shared screen, which s13 also legislates for.
  const refBlob = JSON.stringify(brief.sourceRefs);
  ok("2d. references are identifiers, NEVER the patient's name",
    !refBlob.includes("Trace Me"), refBlob.slice(0, 120));

  // The follow-up we created must be findable in the trace -- otherwise "traceable" is decorative.
  ok("2e. the row that caused the sentence is in the trace",
    brief.sourceRefs.some(r => r.id === fu.data.id),
    `${fu.data.id} not among ${brief.sourceRefs.length} refs`);

  ok("2f. a partial trace says so rather than implying it is the whole list",
    brief.items.every(i => i.refsArePartial === (i.count > i.sourceRefs.length)));

  // ── 3. ⚠ NO UNSUPPORTED PREDICTION (s7's key rule) ───────────────────────────────────────────────
  const sentences = brief.items.map(i => i.sentence).join(" | ").toLowerCase();
  ok("3-control. there are sentences to check", sentences.length > 10, sentences.slice(0, 80));
  const predictive = FORBIDDEN_IN_BRIEF.filter(w => sentences.includes(w));
  ok("3a. no sentence predicts, forecasts, trends or compares",
    predictive.length === 0, `${predictive.join(", ")} in: ${sentences.slice(0, 140)}`);
  ok("3b. and the method statement makes the same promise in the payload",
    /no model/i.test(brief.method) && /no prediction/i.test(brief.method), brief.method);

  // ── 4. It is a view of rows already read, not a second query ─────────────────────────────────────
  //
  // Asserted on the SOURCE, because the cost of a briefing service with its own reads is that it drifts
  // from the tiles beside it -- and it drifts only under load, which is the worst time to find out.
  const src = await import("node:fs").then(fs => fs.readFileSync("src/lib/practice/brief.ts", "utf8"));
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  ok("4a. the brief service runs no query of its own", !/\.from\(["']/.test(body));
  ok("4b. and is synchronous, so it cannot acquire one later", !/\bawait\b|\basync\b/.test(body));

  // ── 5. The payload survives a feeder failure ─────────────────────────────────────────────────────
  const broken = await dashboardReadModel(admin, ctxFor("not-a-uuid"));
  ok("5a. a brief that could not be read says so rather than reporting calm",
    broken.brief.unavailable && broken.brief.items.length === 0,
    JSON.stringify([broken.brief.unavailable, broken.brief.items.length]));
  ok("5b. and is still labelled and stamped", broken.brief.status === "derived"
    && !Number.isNaN(Date.parse(broken.brief.calculatedAt)));

  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
