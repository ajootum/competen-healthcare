/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Provisioning retry idempotency, proven against staging - CPR-PD-014 sections 7.4, 8.3, 12.
 *
 * !! THIS WRITES, SO IT IS NOT A CI HARNESS. It provisions a real workspace for a synthetic identity
 * and then runs the retry path over it. That cannot be rolled back through supabase-js, which speaks
 * HTTP and not transactions, so it runs against STAGING deliberately and leaves its fixture behind.
 * Naming it -proof rather than -harness keeps it out of the pure/local subset the coverage control
 * governs.
 *
 * !! IT DRIVES THE ENGINE THE ENDPOINT DRIVES. Run 2 passes exactly what the POST handler passes -
 * the original request row and the workspace id from run 1 - so what is proven is the endpoint path,
 * not a re-implementation of it.
 *
 * Section 7.4: "A failed retry cannot duplicate already-created resources." The membership assertion
 * is there because capability and membership duplication is the failure this estate has actually had,
 * not a hypothetical one.
 *
 *   npx tsx scripts/pd-retry-idempotency-proof.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { judgeTarget } from "./production-guard";
loadEnvConfig(process.cwd());

// The same guard the fixture provisioner uses. A test that writes must be certain where it writes.
const url = process.env.STAGING_SUPABASE_URL!, key = process.env.STAGING_SERVICE_ROLE_KEY!;
const v = judgeTarget(url);
if (!v.ok) { console.error("refusing:", v.reason); process.exit(1); }

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { fail++; console.log(`  FAIL  ${m}`); };

const payload: IndividualRequest = {
  displayName: "Retry Proof (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
};

async function main() {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `retry.proof@staging.competen.invalid`;

  // A synthetic identity of its own, so the fixture practitioner is untouched.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = (list?.users ?? []).find(u => (u.email ?? "").toLowerCase() === email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: `proof-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      email_confirm: true, user_metadata: { synthetic: true, purpose: "CPR-PD-014 retry proof" },
    });
    if (error) { console.error("could not create the proof identity:", error.message); process.exit(1); }
    user = data.user!;
  }
  console.log(`proof identity: ${email}`);

  const idem = "cpr-pd-014-retry-proof";
  let { data: req } = await admin.from("provisioning_request")
    .select("id, workspace_id, status").eq("idempotency_key", idem).maybeSingle();
  if (!req) {
    const ins = await admin.from("provisioning_request").insert({
      idempotency_key: idem, request_type: "pilot", actor_user_id: user.id, target_user_id: user.id,
      payload_hash: idem, correlation_id: idem, payload,
    }).select("id, workspace_id, status").single();
    req = ins.data as any;
  }

  // ── Run 1: the original ────────────────────────────────────────────────────────────────────────
  const r1 = await runProvisioning(admin, {
    id: (req as any).id, target_user_id: user.id, correlation_id: idem, workspace_id: (req as any).workspace_id,
  }, payload);
  console.log(`run 1: ok=${r1.ok} workspace=${String(r1.workspaceId).slice(0, 8)}...`);

  const after1 = await admin.from("practice_workspace").select("id").eq("owner_person_id", user.id);
  const count1 = (after1.data ?? []).length;

  // ── Run 2: EXACTLY what the retry endpoint does ────────────────────────────────────────────────
  const r2 = await runProvisioning(admin, {
    id: (req as any).id, target_user_id: user.id, correlation_id: idem, workspace_id: r1.workspaceId ?? null,
  }, payload);
  console.log(`run 2: ok=${r2.ok} workspace=${String(r2.workspaceId).slice(0, 8)}...`);

  const after2 = await admin.from("practice_workspace").select("id").eq("owner_person_id", user.id);
  const count2 = (after2.data ?? []).length;

  console.log("");
  if (count1 === 1) ok("run 1 created exactly one workspace"); else bad(`run 1 left ${count1} workspaces`);
  if (count2 === count1) ok(`a retry created NO additional workspace (still ${count2})`);
  else bad(`a retry DUPLICATED a resource: ${count1} -> ${count2}`);
  if (r2.workspaceId === r1.workspaceId) ok("the retry continued the SAME workspace");
  else bad(`the retry returned a different workspace: ${r1.workspaceId} -> ${r2.workspaceId}`);

  // Membership must not double either - the capability grant is the part that has bitten before.
  const mem = await admin.from("practice_membership").select("id, role_code")
    .eq("user_id", user.id).eq("workspace_id", r1.workspaceId!);
  const roles = (mem.data ?? []).map((m: any) => m.role_code);
  const dupes = roles.filter((r, i) => roles.indexOf(r) !== i);
  if (dupes.length === 0) ok(`memberships not duplicated (${roles.join(", ")})`);
  else bad(`duplicate memberships after retry: ${dupes.join(", ")}`);

  console.log(`\n${fail === 0 ? "ALL GREEN - retry is idempotent and creates no duplicate resources" : `RED ${fail} failure(s)`}`);
  console.log(`(staging retains the proof workspace and identity - staging is the disposable environment)`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
