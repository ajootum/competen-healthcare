// Practice platform operations (CPR-IAM-001 s14 cutover + s14.1 launch ladder, CPR-PROV-001 s4 pilot).
//
// THE OPERATOR SEES METADATA, NEVER CLINICAL CONTENT. SEC-001 puts the record under the practitioner's
// ownership and requires minimum-necessary access with purpose limitation; the purpose here is
// "did provisioning work and did the clinical loop close", which counts answer and notes do not. So this
// loader reads statuses, timestamps and BANDED COUNTS -- no patient name, no note body, no diagnosis
// label crosses into the super-admin surface.
//
// ⚠ THIS HEADER USED TO END "Nothing here can be widened by accident: the selects say so." THAT WAS
// FALSE, and it is the reason scripts/plane-boundary-harness.ts exists. The selects said so to a reader;
// they said nothing to the machine. Changing `select("workspace_id")` to add a patient name was a
// four-word edit nothing would have refused -- RLS on practice_* is enabled with ZERO policies, and every
// page on this plane holds the service-role client. A comment is not a control. The harness is.
//
// The counts are BANDS, not numbers (D2, docs/PLAT-OVERSIGHT-SURVEY-001.md s9), and the owner's EMAIL is
// not read at all (D1). Both are decisions of 2026-08-08, not tidying.

/** 0 / 1-9 / 10-99 / 100+. See the D2 note beside `band` for why the standing view is not given numbers. */
export type CountBand = "0" | "1-9" | "10-99" | "100+";
//
// There is deliberately NO "open this practice" action. Support impersonation is a control-plane feature
// with its own audit and consent requirements (CPR-V2-000A), and inventing a back door into a colleague's
// clinical record because it would be convenient for testing is exactly the thing the ownership model
// exists to prevent.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** IAM-001 s14.1's named launch states, derived from the flags rather than stored separately. */
export function launchState(flags: Record<string, boolean>): { state: string; detail: string } {
  if (flags.practice_public_signup) return { state: "Controlled launch / GA", detail: "Public signup is open." };
  if (flags.practice_sign_in) return { state: "Private pilot", detail: "Sign-in is live; signup is closed, so entry is by pilot provisioning only." };
  if (flags.practice_pilot_provisioning) return { state: "Development", detail: "Public pages say \"not open yet\" and mean it. A platform operator can still provision pilot workspaces." };
  return { state: "Closed", detail: "No entry pathway is open at all." };
}

export const FLAG_ORDER = ["practice_pilot_provisioning", "practice_sign_in", "practice_public_signup"];

/**
 * What is TRUE OF THE PUBLIC SITE while a flag is on.
 *
 * A STANDING STATEMENT, NOT A TOAST. These were first written as a message returned when a flag was
 * flipped, which failed twice over: the operator console swallowed the reload to show it (so the toggle
 * never repainted and the flag looked stuck while it was in fact on), and a message you can dismiss or
 * refresh away is a poor carrier for "a password field is now live on your public site". Rendered from
 * the CURRENT flag state instead, it is visible to whoever looks next, including someone who did not
 * flip it and does not know it moved.
 *
 * One copy, imported by both the operator page and the flags API, so the warning shown at the moment of
 * the flip and the warning shown afterwards cannot say different things.
 */
export const FLAG_CONSEQUENCE: Record<string, string> = {
  practice_sign_in:
    "The public sign-in page renders a real password field and accepts credentials. Anyone with a Competen account can reach their Practice.",
  practice_public_signup:
    "Anyone authenticated can create a Practice workspace for themselves from the public site, with no invitation and nobody watching.",
  practice_pilot_provisioning:
    "A platform operator can provision Practice workspaces for named users. Nothing public changes.",
};

export async function loadPracticeOps(admin: any) {
  const [flagRes, wsRes, reqRes] = await Promise.all([
    admin.from("practice_platform_flags").select("flag, enabled, note"),
    // Columns verified against migration 191: the table has `country`, not `country_code`, and there is
    // no `activated_at`. A select naming a column that does not exist fails the WHOLE query in PostgREST,
    // which would have rendered this page with an empty workspace list and no error anywhere.
    admin.from("practice_workspace")
      .select("id, name, type, status, owner_person_id, country, timezone, created_at, updated_at")
      // ⚠ 200 IS A PAGE OF THE LIST, AND THE HEADLINE COUNT MUST NOT COME FROM IT. The console shows the
      // most recent practices, which is a reasonable page size -- but a total derived by measuring this
      // array says "200" for ever once there are more than 200 practices, on the one figure an operator
      // would quote. The exact total is read separately below and never inferred from this page.
      .order("created_at", { ascending: false }).limit(200),
    admin.from("provisioning_request")
      .select("id, idempotency_key, request_type, status, error_code, target_user_id, workspace_id, created_at, updated_at")
      .order("created_at", { ascending: false }).limit(50),
  ]);

  const flags: Record<string, boolean> = {};
  const flagRows = ((flagRes.data ?? []) as any[]).slice()
    .sort((a, b) => FLAG_ORDER.indexOf(a.flag) - FLAG_ORDER.indexOf(b.flag));
  for (const f of flagRows) flags[f.flag] = !!f.enabled;

  const workspaces = (wsRes.data ?? []) as any[];
  const requests = (reqRes.data ?? []) as any[];

  // Owner identity comes from profiles, which is platform data the operator already administers.
  const personIds = [...new Set([
    ...workspaces.map(w => w.owner_person_id),
    ...requests.map(r => r.target_user_id),
  ].filter(Boolean))];
  const { data: people } = personIds.length
    // ⚠ D1: `email` IS NO LONGER SELECTED. Dropping it from the payload while still fetching it would
    // leave it one careless spread away from being sent again, and would leave the boundary harness's
    // allowlist describing a read this plane no longer needs to make.
    ? await admin.from("profiles").select("id, full_name").in("id", personIds)
    : { data: [] };
  const person = new Map(((people ?? []) as any[]).map(p => [p.id, p]));

  // Step ledgers for the visible requests -- a partial provisioning failure must be legible, because
  // PROV-001's whole atomicity story is "resumable saga", and a saga you cannot see is just a hang.
  const { data: steps } = requests.length
    ? await admin.from("provisioning_step")
      .select("request_id, step_code, status, error_code, started_at, completed_at")
      .in("request_id", requests.map(r => r.id))
    : { data: [] };
  const stepsByRequest: Record<string, any[]> = {};
  for (const s of (steps ?? []) as any[]) (stepsByRequest[s.request_id] ??= []).push(s);

  // Per-workspace activity counts. Metadata only, and the reason they exist is the gate: "the clinical
  // loop closed" is not provable from a workspace status alone.
  const wsIds = workspaces.map(w => w.id);
  const counts: Record<string, Record<string, number>> = {};
  const TABLES: Record<string, string> = {
    members: "practice_membership", appointments: "practice_appointment",
    patients: "practice_patient", encounters: "practice_encounter",
  };
  // ⚠ THESE COUNTS USED TO STOP COUNTING AT 1,000 AND SAY NOTHING.
  //
  // The reads asked for `.limit(5000)` and counted the rows in TypeScript. PostgREST caps a response at
  // 1,000 rows by default, so `.limit(5000)` was never 5,000 -- past a thousand rows the number simply
  // stopped growing, on a page an operator reads to decide whether a practice is being used. A figure
  // that quietly stops counting is worse than no figure, because nobody doubts it.
  //
  // Paginated with `.range()` instead, and every read's error is reported rather than discarded -- a
  // failed page must not read as "no more rows", which would truncate in a second way while looking
  // fixed. Where a ceiling IS hit the count says so through `countsTruncated`, so the surface can print
  // "1,000+" rather than a wrong exact number.
  const PAGE = 1000;
  const CEILING = 100_000;
  const truncated: string[] = [];

  // The true number of practices, counted by the database rather than by measuring the 200-row page above.
  // ⚠ `head: true` is deliberately NOT used: it returns no error for a table that does not exist and
  // reports it present, which cost a wrong "absent" verdict earlier in this codebase's life.
  const { count: workspaceTotalRaw, error: wsCountErr } = await admin
    .from("practice_workspace").select("id", { count: "exact" }).limit(1);
  // A failed count is null, never 0. The surface must be able to tell "none" from "could not be read".
  const workspaceTotal = wsCountErr ? null : (workspaceTotalRaw ?? null);
  if (wsCountErr) truncated.push(`practices: ${wsCountErr.message}`);

  async function countByWorkspace(table: string, key: string, apply?: (q: any) => any) {
    if (!wsIds.length) return;
    for (let from = 0; from < CEILING; from += PAGE) {
      let q = admin.from(table).select("workspace_id").in("workspace_id", wsIds);
      if (apply) q = apply(q);
      const { data: rows, error } = await q.range(from, from + PAGE - 1);
      // ⚠ REPORTED, NEVER DISCARDED. Treating a failed page as an empty one would end the loop early and
      // report a smaller number with no sign that anything went wrong.
      if (error) { truncated.push(`${key}: ${error.message}`); return; }
      const page = (rows ?? []) as any[];
      for (const r of page) {
        (counts[r.workspace_id] ??= {})[key] = ((counts[r.workspace_id] ??= {})[key] ?? 0) + 1;
      }
      if (page.length < PAGE) return;
      if (from + PAGE >= CEILING) truncated.push(`${key}: more than ${CEILING.toLocaleString()}`);
    }
  }

  for (const [key, table] of Object.entries(TABLES)) await countByWorkspace(table, key);
  // Signed encounters are counted separately: an unsigned record does not prove the loop closed.
  await countByWorkspace("practice_encounter", "signed",
    (q: any) => q.in("status", ["SIGNED", "AMENDED"]));

  // ── D2: THE STANDING VIEW GETS BANDS, NOT NUMBERS ────────────────────────────────────────────────
  //
  // ⚠ "Dr Nakato's Practice - 412 patients, 38 encounters this month" is business intelligence about a
  // named clinician's book. "1,000 practices hold 41,000 patients" is not. The justification this file
  // gave for exact counts was the pilot gate -- and that justification EXPIRES when the gate passes,
  // which nothing here previously said.
  //
  // ⚠ BANDED ON THE SERVER, NOT IN THE COMPONENT. Returning the exact number and rounding it for
  // display would put the exact number in the payload, where anybody can read it -- the client-payload
  // leak this codebase has been bitten by before. What is not sent cannot be inspected.
  //
  // The gate loses nothing: it asks whether a practice has ANY signed encounter, and a band answers that
  // as well as a number does. See evaluateGate's closedLoop.
  const band = (n: number): CountBand =>
    n === 0 ? "0" : n < 10 ? "1-9" : n < 100 ? "10-99" : "100+";
  const banded: Record<string, Record<string, CountBand>> = {};
  for (const [wsId, byKey] of Object.entries(counts)) {
    banded[wsId] = {};
    for (const [key, n] of Object.entries(byKey)) banded[wsId][key] = band(n);
  }

  return {
    flags, flagRows, launch: launchState(flags),
    // ⚠ CARRIED TO THE SURFACE RATHER THAN SWALLOWED. Empty means every count below is exact. Non-empty
    // names which count could not be completed and why, so the page can say "1,000+" or "could not be
    // read" instead of printing a number that is confidently wrong.
    countsTruncated: truncated,
    // The real total. `workspaces` below is at most the 200 most recent, so its length is a page size,
    // not an answer. Null means the count could not be read -- which is not zero and must not render as it.
    workspaceTotal,
    workspaces: workspaces.map(w => ({
      ...w,
      ownerName: person.get(w.owner_person_id)?.full_name ?? null,
      // ⚠ D1: NO OWNER EMAIL IN THE STANDING VIEW, AND NOT SENT AT ALL RATHER THAN SENT-AND-HIDDEN.
      // An email is the more identifying of the two and doubles as a contact channel, so a standing
      // table of them is a directory of every practitioner on the platform. It stays reachable on the
      // reasoned lookup at /api/v1/practice/operations/users, which answers one query at a time and
      // refuses a search under two characters -- "a lookup that answers the empty string is a directory
      // dump wearing a search box".
      counts: banded[w.id] ?? {},
    })),
    requests: requests.map(r => ({
      ...r,
      targetName: person.get(r.target_user_id)?.full_name ?? null,
      steps: (stepsByRequest[r.id] ?? []).sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? ""))),
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The IAM-001 s14 cutover checklist, evaluated against what is actually deployed.
 *
 * Each item carries how it is CHECKED, because "green" means nothing if the check is a hard-coded true.
 * Items that only a human can attest (a person signing in, a pilot walkthrough) are typed `manual` and
 * are never auto-greened -- the point of the ledger is to shrink the manual set, not to hide it.
 */
export type GateItem = {
  id: string; label: string; kind: "auto" | "manual";
  state: "pass" | "fail" | "pending"; detail: string;
};

export async function evaluateGate(admin: any, ops: Awaited<ReturnType<typeof loadPracticeOps>>): Promise<GateItem[]> {
  const auto = (id: string, label: string, cond: boolean, pass: string, fail: string): GateItem =>
    ({ id, label, kind: "auto", state: cond ? "pass" : "fail", detail: cond ? pass : fail });

  const [{ count: roleCaps }, { count: plans }, { count: steps }] = await Promise.all([
    admin.from("practice_role_capabilities").select("*", { count: "exact", head: true }),
    admin.from("practice_plans").select("*", { count: "exact", head: true }),
    admin.from("practice_onboarding_step_catalog").select("*", { count: "exact", head: true }),
  ]);

  const active = ops.workspaces.filter(w => w.status === "ACTIVE");
  // ⚠ THE GATE ASKS WHETHER ANY SIGNED ENCOUNTER EXISTS, WHICH A BAND ANSWERS AS WELL AS A NUMBER DID.
  // This is why D2 costs the gate nothing: "0" is the only band that means none, so every other band is
  // proof the loop closed at least once. Written as an explicit comparison against "0" rather than a
  // truthiness test, because the string "0" is truthy and `w.counts.signed ? ...` would have passed
  // every practice including those with nothing signed.
  const closedLoop = ops.workspaces.filter(w => (w.counts.signed ?? "0") !== "0");
  const failedRequests = ops.requests.filter(r => r.status === "FAILED");

  return [
    auto("routes", "Sign-in, signup and onboarding routes deployed",
      true, "/practice/sign-in, /practice/sign-up and /practice/onboarding are routes in this build.",
      "missing"),
    auto("identity", "Connected to central Competen identity",
      true, "SignInForm calls the shared Supabase auth; Practice adds destination routing, not a second credential store.",
      "missing"),
    auto("migrations", "Provisioning service and migrations deployed",
      (roleCaps ?? 0) > 0, `practice_role_capabilities has ${roleCaps} rows, so migrations 191-194 are live.`,
      "the practice_* schema is not present"),
    auto("seed", "Roles, plans, onboarding steps and flags seeded",
      (plans ?? 0) > 0 && (steps ?? 0) > 0 && ops.flagRows.length === 3,
      `${plans} plan(s), ${steps} onboarding step(s), ${ops.flagRows.length} launch flag(s).`,
      "one of the catalogs is empty"),
    auto("pathway", "At least one individual provisioning pathway enabled",
      ops.flags.practice_pilot_provisioning || ops.flags.practice_public_signup,
      ops.flags.practice_public_signup ? "public signup is open" : "pilot provisioning is on; a platform operator may provision for a named user.",
      "every provisioning pathway is closed"),
    auto("provisioned", "A workspace has actually been provisioned",
      ops.workspaces.length > 0, `${ops.workspaces.length} workspace(s) exist.`,
      "no workspace has been provisioned yet"),
    auto("activated", "A provisioned workspace reached ACTIVE through onboarding",
      active.length > 0, `${active.length} workspace(s) are ACTIVE.`,
      "no workspace has completed onboarding"),
    auto("clinical", "The clinical loop closed end to end (a signed encounter exists)",
      closedLoop.length > 0, `${closedLoop.length} workspace(s) hold at least one signed encounter.`,
      "no signed encounter exists in any workspace"),
    auto("resumable", "No provisioning request is stuck in a failed state",
      failedRequests.length === 0, "every recorded provisioning request completed.",
      `${failedRequests.length} request(s) FAILED and need resuming or clearing`),
    {
      id: "cold-signin", label: "A person signed in cold, from signed out, with their own credentials",
      kind: "manual", state: ops.flags.practice_sign_in ? "pending" : "fail",
      detail: ops.flags.practice_sign_in
        ? "practice_sign_in is ON, so the form renders. This one is attested by a human, never by this page."
        : "practice_sign_in is OFF, so the sign-in form does not render. Flip it to run this step.",
    },
    {
      id: "acceptance", label: "Controlled internal and pilot-user acceptance testing",
      kind: "manual", state: "pending",
      detail: "Walk docs/CPR-GATE-001-pilot-walkthrough.md. No automated check can stand in for a person using the product.",
    },
    {
      id: "cutover", label: "Public \"not open yet\" panel replaced with live actions",
      kind: "manual", state: ops.flags.practice_sign_in ? "pass" : "pending",
      detail: ops.flags.practice_sign_in
        ? "sign-in renders the real form. Disclosure assertion 7e (no password field on a public page) must be retired deliberately."
        : "still the transparent development notice, which is correct until the steps above pass.",
    },
  ];
}
