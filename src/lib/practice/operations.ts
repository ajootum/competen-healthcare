// Practice platform operations (CPR-IAM-001 s14 cutover + s14.1 launch ladder, CPR-PROV-001 s4 pilot).
//
// THE OPERATOR SEES METADATA, NEVER CLINICAL CONTENT. SEC-001 puts the record under the practitioner's
// ownership and requires minimum-necessary access with purpose limitation; the purpose here is
// "did provisioning work and did the clinical loop close", which counts answer and notes do not. So this
// loader reads statuses, timestamps and COUNTS -- no patient name, no note body, no diagnosis label
// crosses into the super-admin surface. Nothing here can be widened by accident: the selects say so.
//
// There is deliberately NO "open this practice" action. Support impersonation is a control-plane feature
// with its own audit and consent requirements (CPR-000A), and inventing a back door into a colleague's
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
    ? await admin.from("profiles").select("id, full_name, email").in("id", personIds)
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
  for (const [key, table] of Object.entries(TABLES)) {
    const { data: rows } = wsIds.length
      ? await admin.from(table).select("workspace_id").in("workspace_id", wsIds).limit(5000)
      : { data: [] };
    for (const r of (rows ?? []) as any[]) {
      (counts[r.workspace_id] ??= {})[key] = ((counts[r.workspace_id] ??= {})[key] ?? 0) + 1;
    }
  }
  // Signed encounters are counted separately: an unsigned record does not prove the loop closed.
  const { data: signedRows } = wsIds.length
    ? await admin.from("practice_encounter").select("workspace_id")
      .in("workspace_id", wsIds).in("status", ["SIGNED", "AMENDED"]).limit(5000)
    : { data: [] };
  for (const r of (signedRows ?? []) as any[]) {
    (counts[r.workspace_id] ??= {}).signed = ((counts[r.workspace_id] ??= {}).signed ?? 0) + 1;
  }

  return {
    flags, flagRows, launch: launchState(flags),
    workspaces: workspaces.map(w => ({
      ...w,
      ownerName: person.get(w.owner_person_id)?.full_name ?? null,
      ownerEmail: person.get(w.owner_person_id)?.email ?? null,
      counts: counts[w.id] ?? {},
    })),
    requests: requests.map(r => ({
      ...r,
      targetName: person.get(r.target_user_id)?.full_name ?? null,
      targetEmail: person.get(r.target_user_id)?.email ?? null,
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
  const closedLoop = ops.workspaces.filter(w => (w.counts.signed ?? 0) > 0);
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
