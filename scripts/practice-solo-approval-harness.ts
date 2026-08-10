/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from the admin client. */
/**
 * SOLO-PRACTICE SELF-APPROVAL — the user's decision of 2026-08-10.
 *
 * ⚠ THE DEFECT IT CLOSES, found by the owner during a walkthrough: a one-person practice could NEVER
 * publish a guidance document. Send for approval worked, deciding it refused ("you cannot decide your own
 * request"), and publishing refused for want of a decision. A closed loop, in a product whose own
 * marketing says "a solo clinician runs the whole thing without a receptionist".
 *
 * ⚠ AND WHAT IT MUST NOT BREAK: segregation of duties everywhere else. The permission is granted ONLY
 * when the practice has exactly one distinct member, and the approval is RECORDED as self-approved --
 * derived from decided_by === requested_by, which was already stored, so there is no flag to forget and
 * nothing to edit away without rewriting who asked or who decided.
 *
 *   npx --yes tsx scripts/practice-solo-approval-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { decideApproval, requestApproval } from "../src/lib/practice/delegation";
import { renderSections } from "../src/lib/practice/knowledge";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const SOLO = "00000000-0000-4000-8000-00000000fc05";
const OTHER = "00000000-0000-4000-8000-00000000fc06";
const strip = (s: string) => s.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");

async function cleanup() {
  for (const u of [SOLO]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as any[]) await admin.from("practice_approval_request").delete().eq("workspace_id", w.id);
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await purgeWorkspacesOwnedBy(admin, [u], { quiet: true });
  }
}

async function main() {
  console.log("\n=== SOLO-PRACTICE SELF-APPROVAL ===\n");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-solo-${Date.now()}`, request_type: "pilot",
    actor_user_id: SOLO, target_user_id: SOLO, payload_hash: "harness", correlation_id: "harness-solo",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Solo", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: SOLO, correlation_id: "harness-solo", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed:", run.errorCode); process.exitCode = 1; return; }
  const workspaceId = run.workspaceId;

  const { data: mem } = await admin.from("practice_membership")
    .select("user_id").eq("workspace_id", workspaceId).eq("status", "active");
  const people = new Set(((mem ?? []) as any[]).map(m => m.user_id));
  ok("0a-control. ⚠ the fixture practice has ONE person but MORE THAN ONE membership row",
    people.size === 1 && (mem ?? []).length > 1,
    `${people.size} people, ${(mem ?? []).length} rows -- if rows were counted this would look like a pair`);

  // ── 1. THE SOLE MEMBER MAY DECIDE THEIR OWN REQUEST ──────────────────────────────────────────────
  const made = await requestApproval(admin, {
    workspaceId, subjectKind: "other", subjectId: null, area: "guidance",
    summary: "harness: a protocol nobody else can read", urgency: "routine",
    assignedTo: null, actorId: SOLO, correlationId: "harness-solo",
  });
  ok("1a-control. the approval request was created", made.ok, made.ok ? "" : made.message);
  if (!made.ok) { await cleanup(); report(); return; }

  const decided = await decideApproval(admin, {
    workspaceId, approvalId: made.data.id, decision: "APPROVED",
    note: "sole practitioner", actorId: SOLO, correlationId: "harness-solo",
  });
  ok("1b. ⚠ the sole member CAN decide their own request", decided.ok,
    decided.ok ? "" : `${(decided as any).code}: ${(decided as any).message}`);

  const { data: row } = await admin.from("practice_approval_request")
    .select("status, requested_by, decided_by, decided_at").eq("id", made.data.id).maybeSingle();
  ok("1c. it is recorded as APPROVED", (row as any)?.status === "APPROVED");
  ok("1d. ⚠ and self-approval is DERIVABLE from what was stored -- decided_by === requested_by",
    !!(row as any)?.decided_by && (row as any).decided_by === (row as any).requested_by);

  // ── 2. ⚠ THE DOCUMENT SAYS SO ────────────────────────────────────────────────────────────────────
  const selfApproval = {
    id: made.data.id, status: "APPROVED", assigned_to: null, requested_by: SOLO,
    decided_by: SOLO, decided_at: "2026-08-10T00:00:00.000Z", decision_note: "sole practitioner",
    decidedByName: "Harness Solo",
  };
  const rendered = renderSections(
    { effective_from: "2026-01-01", review_on: null, status: "published", version: 1 },
    [], selfApproval);
  const approvalSection = rendered.find(s => s.key === "approval");
  ok("2a. ⚠ the approval section says it was approved by THE AUTHOR",
    /approved by the author/i.test(approvalSection?.body ?? ""), approvalSection?.body ?? "");
  ok("2b. ⚠ and that nobody else has read it",
    /nobody else has read this document/i.test(approvalSection?.body ?? ""));
  ok("2c. ⚠ it never calls the author 'a colleague'",
    !/a colleague/i.test(approvalSection?.body ?? ""),
    "asserting a review that did not happen");

  const peerApproval = { ...selfApproval, decided_by: OTHER, decidedByName: "Dr Other" };
  const peer = renderSections(
    { effective_from: "2026-01-01", review_on: null, status: "published", version: 1 },
    [], peerApproval).find(s => s.key === "approval");
  ok("2d-control. a genuine peer approval reads normally and claims no self-approval",
    /approved by dr other/i.test(peer?.body ?? "") && !/nobody else has read/i.test(peer?.body ?? ""),
    peer?.body ?? "");

  // ── 3. ⚠ THE RULE STILL HOLDS WHERE THERE IS A COLLEAGUE ─────────────────────────────────────────
  const { data: anyMem } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).limit(1).maybeSingle();
  const { error: addErr } = await admin.from("practice_membership").insert({
    workspace_id: workspaceId, user_id: OTHER, role_code: "practitioner", status: "active",
  });
  ok("3a-control. a second person was added to the fixture", !addErr, addErr?.message ?? "");
  void anyMem;

  const second = await requestApproval(admin, {
    workspaceId, subjectKind: "other", subjectId: null, area: "guidance",
    summary: "harness: now there are two of us", urgency: "routine",
    assignedTo: null, actorId: SOLO, correlationId: "harness-solo",
  });
  const refused = second.ok ? await decideApproval(admin, {
    workspaceId, approvalId: second.data.id, decision: "APPROVED",
    note: "trying it on", actorId: SOLO, correlationId: "harness-solo",
  }) : null;
  ok("3b. ⚠ WITH A COLLEAGUE PRESENT, self-approval is refused again",
    !!refused && !refused.ok && (refused as any).code === "SELF_APPROVAL",
    refused && !refused.ok ? (refused as any).code : "IT WAS ALLOWED");

  const byOther = second.ok ? await decideApproval(admin, {
    workspaceId, approvalId: second.data.id, decision: "APPROVED",
    note: "read it", actorId: OTHER, correlationId: "harness-solo",
  }) : null;
  ok("3c-control. and the colleague CAN decide it, so 3b is the self-approval rule and not a broken fixture",
    !!byOther && byOther.ok);

  // ── 4. THE SOURCE RULES ──────────────────────────────────────────────────────────────────────────
  const del = strip(readFileSync("src/lib/practice/delegation.ts", "utf8"));
  ok("4a. ⚠ soleness is counted as DISTINCT PEOPLE, not membership rows",
    /new Set\(\(members as \{ user_id: string \}\[\]\)\.map\(m => m\.user_id\)\)/.test(del),
    "counting rows makes every solo practice look like a pair");
  ok("4b. ⚠ a failed member read REFUSES rather than admitting",
    /if \(mErr \|\| members == null\)[\s\S]{0,200}SELF_APPROVAL/.test(del),
    "a database blip would waive segregation of duties");

  const page = strip(readFileSync("src/app/practice/(shell)/people/page.tsx", "utf8"));
  ok("4c. the screen computes soleness server-side, not from the team list",
    /practice_membership"\)\.select\("user_id"\)/.test(page) && /soloPractice/.test(page));
  ok("4d. ⚠ and an unreadable list is null, which the console treats as NOT solo",
    /\? null\s*:\s*new Set/.test(page));

  const console_ = strip(readFileSync("src/app/practice/(shell)/people/DelegationConsole.tsx", "utf8"));
  ok("4e. ⚠ the buttons appear only when soloPractice is exactly true",
    /a\.requested_by === me && soloPractice !== true/.test(console_));
  ok("4f. ⚠ and the consequence is stated BEFORE the decision, not after",
    /soloPractice === true &&/.test(console_) && /stays on the document/.test(console_));

  const doc = readFileSync("src/app/practice/(shell)/knowledge-studio/[guidanceId]/GuidanceDocument.tsx", "utf8");
  ok("4g. the guidance screen no longer claims it cannot be approved",
    !/cannot be approved until somebody else joins/.test(strip(doc)));

  await admin.from("practice_approval_request").delete().eq("workspace_id", workspaceId);
  await admin.from("practice_membership").delete().eq("workspace_id", workspaceId).eq("user_id", OTHER);
  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
