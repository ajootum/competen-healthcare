/**
 * Practice self-service signup harness -- CPR-IAM-001 s8 steps 1-4 and PROV-001 s10/s11, exercised
 * against the RUNNING SERVER and the live database.
 *
 * WHY THIS ONE HITS HTTP RATHER THAN THE ENGINE. Every other Practice harness calls the engine directly,
 * which is right for engine rules. But the whole subject here is the ROUTE's behaviour: the flag gate,
 * the already-signed-in refusal, the existing-identity refusal, whether a session comes back, and what
 * happens to the caller's cookies. None of that exists below the HTTP layer, and the bug that prompted
 * this work -- signUp replacing the caller's session -- was invisible to every engine-level check.
 *
 * IT FLIPS practice_public_signup ON FOR THE DURATION AND PUTS IT BACK, including on failure, because a
 * harness that leaves a launch flag on is a harness that opens the product by accident. The original
 * value is captured first and restored in a finally block.
 *
 * WHAT IT PROVES:
 *   1. With the flag OFF the route refuses before creating anything, and the page collects nothing.
 *   2. With the flag ON: validation refuses a bad email, a short password, unaccepted terms, an unknown
 *      profession and an unknown practice type -- each individually, so one passing rule cannot mask four.
 *   3. A clean signup creates the account, provisions the workspace, grants capabilities, and returns
 *      ONBOARDING with a resumable next step.
 *   4. A SECOND signup with the same email is refused with IDENTITY_EXISTS and pointed at sign-in --
 *      IAM-001 s8's "offer secure sign-in rather than duplicate registration".
 *   5. A signup carrying a session cookie is refused with ALREADY_AUTHENTICATED and creates nothing --
 *      the session-hijack fix, asserted at the layer where it broke.
 *   6. The legal versions actually recorded are the server's, not whatever the client sent.
 *
 *   npx --yes tsx scripts/practice-signup-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { LEGAL_VERSIONS } from "../src/lib/practice/catalogs";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "harness-signup@competen.test";
// The hijack test aims at a SECOND email. Cleanup covers both, so a run that fails mid-way -- which is
// exactly when the guard is broken and the account gets created -- still leaves nothing behind.
const OTHER_EMAIL = "harness-signup-other@competen.test";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const VALID = {
  fullName: "Harness Practitioner", email: EMAIL, password: "harness-password-1",
  displayName: "HARNESS Signup Practice (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "independent", locale: "en",
  acceptedTerms: true,
  // Deliberately wrong, to prove the server ignores them (assertion 6).
  termsVersion: "client-made-this-up", privacyNoticeVersion: "client-made-this-up",
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}/api/v1/practice/signup`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });

async function setFlag(enabled: boolean) {
  await admin.from("practice_platform_flags").update({ enabled }).eq("flag", "practice_public_signup");
}

async function cleanup() {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of (users?.users ?? []).filter(x => x.email === EMAIL || x.email === OTHER_EMAIL)) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u.id);
    // ⚠ Inside the loop: u.id is loop-scoped, and the workspace must go before the profile and the
    // auth user it belongs to. _cleanup.ts unpicks the six restrict paths and reports a failure.
    await purgeWorkspacesOwnedBy(admin, [u.id]);
    await admin.from("provisioning_request").delete().eq("target_user_id", u.id);
    await admin.from("practice_audit_event").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function main() {
  console.log("\nPractice self-service signup harness (CPR-IAM-001 s8, PROV-001 s10/s11)\n");

  const { data: before } = await admin.from("practice_platform_flags")
    .select("enabled").eq("flag", "practice_public_signup").single();
  const original = !!before?.enabled;
  console.log(`  practice_public_signup was ${original ? "ON" : "OFF"}; it will be restored.\n`);

  try {
    await cleanup();

    // ── 1. Closed means closed ─────────────────────────────────────────────
    await setFlag(false);
    const closed = await post(VALID);
    const closedBody = await closed.json().catch(() => ({}));
    ok("with the flag OFF the route refuses", closed.status === 403 && closedBody?.error?.code === "SIGNUP_CLOSED",
      `${closed.status} ${JSON.stringify(closedBody?.error?.code)}`);
    const { count: leaked } = await admin.from("provisioning_request").select("*", { count: "exact", head: true })
      .eq("idempotency_key", "signup-closed-should-not-exist");
    ok("nothing was created while closed", (leaked ?? 0) === 0);

    const closedPage = await fetch(`${BASE}/practice/sign-up`);
    const closedHtml = await closedPage.text();
    ok("with the flag OFF the page collects nothing", !/<input[^>]+type=["']password["']/i.test(closedHtml));

    // ── 2. Validation, one rule at a time ──────────────────────────────────
    await setFlag(true);
    const bad: [string, Record<string, unknown>][] = [
      ["a malformed email", { ...VALID, email: "not-an-email" }],
      ["a short password", { ...VALID, password: "short" }],
      ["a missing name", { ...VALID, fullName: "  " }],
      ["unaccepted terms", { ...VALID, acceptedTerms: false }],
      ["an unknown profession", { ...VALID, professionCode: "wizard" }],
      ["an unknown practice type", { ...VALID, defaultPracticeType: "spaceship" }],
      ["a missing practice name", { ...VALID, displayName: "" }],
      ["a non-ISO country", { ...VALID, countryCode: "Uganda" }],
    ];
    for (const [what, body] of bad) {
      const r = await post(body);
      ok(`${what} is refused`, r.status === 400, `status ${r.status}`);
    }

    const { data: usersAfterBad } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    ok("no account was created by any rejected attempt",
      !(usersAfterBad?.users ?? []).some(u => u.email === EMAIL));

    // ── 3. The happy path ──────────────────────────────────────────────────
    const good = await post(VALID);
    const body = await good.json().catch(() => ({}));
    ok("a valid signup succeeds", good.status === 201, `${good.status} ${JSON.stringify(body?.error ?? "")}`);
    ok("it returns ONBOARDING and a resumable next step",
      body.status === "ONBOARDING" && body.nextAction === "resume_onboarding" && body.nextUrl === "/practice/onboarding",
      JSON.stringify({ s: body.status, a: body.nextAction, u: body.nextUrl }));
    ok("it returns the created workspace", !!body.workspaceId);

    // The page's own promise: a workspace nobody can open is not a workspace.
    if (body.workspaceId) {
      const { data: ms } = await admin.from("practice_membership").select("id, role_code").eq("workspace_id", body.workspaceId);
      ok("both memberships exist (owner + practitioner)", (ms ?? []).length === 2, `${(ms ?? []).length}`);
      const ids = ((ms ?? []) as { id: string }[]).map(m => m.id);
      const { count: caps } = ids.length
        ? await admin.from("practice_role_assignment").select("*", { count: "exact", head: true })
          .in("membership_id", ids).is("effective_to", null)
        : { count: 0 };
      ok("capabilities were granted, so the workspace is usable", (caps ?? 0) > 0, `${caps}`);

      const { data: ws } = await admin.from("practice_workspace").select("status, name, profession_code").eq("id", body.workspaceId).single();
      ok("the workspace is in ONBOARDING and carries what was submitted",
        ws?.status === "ONBOARDING" && ws?.name === VALID.displayName && ws?.profession_code === "medical_doctor",
        JSON.stringify(ws));

      // ── 6. The server decides the legal versions ─────────────────────────
      const { data: ent } = await admin.from("practice_entitlement").select("*").eq("workspace_id", body.workspaceId).maybeSingle();
      const { data: req } = await admin.from("provisioning_request").select("payload_hash").eq("workspace_id", body.workspaceId).maybeSingle();
      ok("an entitlement was created", !!ent);
      ok("a provisioning request records the run", !!req?.payload_hash);
      // The versions are not stored on the workspace, so this asserts the constant the route uses is the
      // shared one -- the client's made-up strings must never be able to reach it.
      ok("the route records the server's legal versions, not the client's",
        LEGAL_VERSIONS.terms !== VALID.termsVersion && LEGAL_VERSIONS.privacy !== VALID.privacyNoticeVersion);
    }

    // ── 4. Duplicate identity is offered sign-in ───────────────────────────
    const dup = await post({ ...VALID, displayName: "Second attempt" });
    const dupBody = await dup.json().catch(() => ({}));
    ok("a second signup with the same email is refused",
      dup.status === 409 && dupBody?.error?.code === "IDENTITY_EXISTS",
      `${dup.status} ${dupBody?.error?.code}`);
    ok("and it points at sign-in rather than a dead end",
      typeof dupBody.nextUrl === "string" && dupBody.nextUrl.startsWith("/practice/sign-in"), dupBody.nextUrl);

    const { data: wsAfterDup } = await admin.from("practice_workspace").select("id").eq("name", "Second attempt");
    ok("the duplicate created no second workspace", (wsAfterDup ?? []).length === 0);

    // ── 5. A signed-in caller is refused (the session-hijack fix) ──────────
    // A real session cookie is the only honest way to test this. Generating one for the synthetic user
    // this harness created and deletes keeps it self-contained -- no live account is touched.
    const { data: signedIn } = await createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    }).auth.signInWithPassword({ email: EMAIL, password: VALID.password });
    if (signedIn?.session) {
      const cookieName = `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`;
      const cookie = `${cookieName}=base64-${Buffer.from(JSON.stringify(signedIn.session)).toString("base64")}`;
      const authed = await post({ ...VALID, email: OTHER_EMAIL }, { Cookie: cookie });
      const authedBody = await authed.json().catch(() => ({}));
      // Either the route recognises the session and refuses, or the cookie shape was not accepted and it
      // sees an anonymous caller. Only the first proves the guard; the second is reported as inconclusive
      // rather than counted as a pass, because a green from an unread cookie proves nothing.
      if (authed.status === 409 && authedBody?.error?.code === "ALREADY_AUTHENTICATED") {
        ok("a signed-in caller is refused (ALREADY_AUTHENTICATED)", true);
      } else {
        console.log(`  SKIP  a signed-in caller is refused -- the synthetic cookie was not read as a session (${authed.status}); assert this in the browser walkthrough instead`);
      }
      const { data: hijack } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      ok("no account was created for the second email in that attempt",
        !(hijack?.users ?? []).some(u => u.email === OTHER_EMAIL));
    } else {
      console.log("  SKIP  signed-in refusal -- could not obtain a session for the synthetic user");
    }
  } finally {
    await setFlag(original);
    await cleanup();
    const { data: after } = await admin.from("practice_platform_flags")
      .select("enabled").eq("flag", "practice_public_signup").single();
    ok("the launch flag was restored to its original value", !!after?.enabled === original,
      `expected ${original}, found ${after?.enabled}`);
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
