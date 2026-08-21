/**
 * CP-OFFLINE-SURVEY-001 s5 -- the FILING side of offline capture, which nothing tested.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS.
 *
 * offline-filing.ts carries the most consequential comment in the offline arc:
 *
 *     "A retry after a crash between the two writes (or after recordPayment's own compensating
 *      delete -- numbering down at sync deletes the payment and throws) finds the charge by that ref
 *      and REUSES it. Without this, every numbering outage would double-charge the patient on the
 *      retry that follows it."
 *
 * That protection is real code resting on a real database index, `ux_practice_charge_source`. Before
 * this file, NOTHING verified either half: no harness referenced fileOfflineCollection, and nothing
 * checked the index existed in the database rather than only in migration 303. A money guarantee
 * asserted in a comment and enforced by an index nobody checks is a guarantee in the weakest possible
 * position -- and it guards the RETRY path, which is the least-exercised path in the product.
 *
 * ⚠ THE POINT IS THE SECOND CALL. Filing once proves the happy path, which the walkthrough already
 * covers by hand. Filing TWICE with the same device-minted id is the assertion: one payment, one
 * charge, replayed=true, and the receipt number unchanged.
 *
 * ⚠ AND THE NUMBER MUST BE MINTED HERE, NOT ON THE DEVICE. The device supplies the row identity
 * (entityId) so a retry is idempotent; it never supplies the receipt number. Step 17 of
 * CPR-GATE-001 states this as "the receipt for money is numbered AT sync", and it is only true
 * because fileOfflineCollection routes through the same recordPayment every online caller uses.
 *
 *   npx tsx scripts/practice-offline-filing-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { runProvisioning } from "../src/lib/practice/provisioning";
import type { IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { fileOfflineCollection } from "../src/lib/practice/offline-filing";
import { registerPatient } from "../src/lib/practice/patients";
import { RECEIPT_NUMBER_RE } from "../src/lib/practice/billing-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000f111a";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-offfile-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-offfile",
  }).select("id").single();
  const run = await runProvisioning(
    admin,
    { id: req!.id, target_user_id: user, correlation_id: "harness-offfile", workspace_id: null },
    payload(name),
  );
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nPractice offline-filing harness (CP-OFFLINE-SURVEY-001 s5, migrations 284 + 303)\n");
  await cleanup();

  const ws = await provision(OWNER, "Offline Filing Harness", "a");
  const a = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!a.ok) throw new Error("could not resolve workspace context");
  const ctx = a.ctx;

  // Through the ENGINE, not a raw insert: a patient number is minted by registerPatient, and a row
  // pushed straight into the table would be a patient the product could never have produced.
  const pat = await registerPatient(admin, {
    workspaceId: ws, displayName: "Field Collection", sex: "unspecified",
    // CPR-V2-005 minimum dataset: a birth date (or age estimate) AND a primary contact are required.
    birthDate: "1990-01-01", phone: "0772 000 111",
    actorId: OWNER, correlationId: "harness-offfile",
  });
  if (!pat.ok) { console.error("patient did not register:", (pat as any).message); await cleanup(); process.exit(1); }
  const patientId = pat.data.id as string;

  // ── 1. THE INDEX, LIVE ─────────────────────────────────────────────────────────────────────────
  // ⚠ Read from the DATABASE, not from migration 303. A migration file proves what was written, not
  // what was applied -- this estate has already had a migration truncate silently, and has a standing
  // rule to probe rather than assume. The probe is a real duplicate insert: if the index is present it
  // is refused with 23505 and nothing is written; if it is absent the row lands and the double-charge
  // this whole module exists to prevent has just been demonstrated (and is cleaned up below).
  const sourceRef = randomUUID();
  const chargeRow = {
    workspace_id: ws, patient_id: patientId, source: "consultation", source_ref: sourceRef,
    description: "index probe", quantity: 1, unit_amount_minor: 1000, amount_minor: 1000,
    currency: "UGX", charged_on: "2026-08-21",
  };
  const first = await admin.from("practice_charge").insert(chargeRow).select("id").single();
  const second = await admin.from("practice_charge").insert(chargeRow).select("id").maybeSingle();
  ok("1a ux_practice_charge_source is LIVE: a second charge on the same source ref is refused",
    !!first.data && !!second.error && String((second.error as any).code) === "23505",
    second.error ? `code ${(second.error as any).code}` : "the duplicate was ACCEPTED");
  ok("1b and the refusal wrote nothing -- exactly one charge carries that ref",
    (await admin.from("practice_charge").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).eq("source_ref", sourceRef)).count === 1);
  await admin.from("practice_charge").delete().eq("workspace_id", ws).eq("source_ref", sourceRef);

  // ── 2. FILING ONCE ─────────────────────────────────────────────────────────────────────────────
  const entityId = randomUUID();
  const txId = randomUUID(); // stands in for the outbox transaction id the sync applier passes
  const args = {
    patientId, description: "Consultation, field collection",
    amountMinor: 50000, currency: "UGX", method: "cash",
    collectedAtIso: new Date().toISOString(), collectedOn: null,
    entityId, actorId: OWNER, correlationId: txId,
  };
  const one = await fileOfflineCollection(admin, ctx, args);
  ok("2a a field collection files, and comes back with a receipt number",
    one.ok === true && !!one.data?.receiptNumber, one.ok ? "" : JSON.stringify((one as any).error ?? one));
  ok("2b the number is minted AT SYNC by the shared engine, in the pinned receipt shape",
    !!one.ok && RECEIPT_NUMBER_RE.test(String(one.data!.receiptNumber)),
    one.ok ? String(one.data!.receiptNumber) : "");
  ok("2c and this first filing is not a replay",
    !!one.ok && one.data!.replayed === false);
  ok("2d the payment carries the DEVICE-minted id, which is what makes a retry idempotent",
    !!one.ok && one.data!.id === entityId);

  // ── 3. THE SECOND CALL, WHICH IS THE WHOLE POINT ───────────────────────────────────────────────
  const two = await fileOfflineCollection(admin, ctx, { ...args, correlationId: txId });
  ok("3a re-filing the same capture is REPLAYED, never filed twice",
    two.ok === true && two.data?.replayed === true,
    two.ok ? `replayed=${two.data!.replayed}` : "the retry failed outright");
  const twoReceipt = two.ok ? two.data.receiptNumber : null;
  ok("3b and it returns the SAME receipt number -- a retry never re-numbers money",
    two.ok === true && twoReceipt === (one.ok ? one.data.receiptNumber : undefined),
    `${one.ok ? one.data.receiptNumber : "?"} vs ${twoReceipt ?? "?"}`);

  const payments = await admin.from("practice_payment").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("patient_id", patientId);
  const charges = await admin.from("practice_charge").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("patient_id", patientId);
  const receipts = await admin.from("practice_receipt").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws);
  ok("3c ONE payment exists, not two", payments.count === 1, `count ${payments.count}`);
  ok("3d ONE charge exists, not two -- this is the double-charge the comment warns about",
    charges.count === 1, `count ${charges.count}`);
  ok("3e ONE receipt exists, not two", receipts.count === 1, `count ${receipts.count}`);

  // ── 4. THE REFUSAL HAPPENS BEFORE THE FIRST WRITE ──────────────────────────────────────────────
  // ⚠ Orphan-avoidance, not decoration: if the engines refused in their own order the charge would be
  // created and the payment then refused, leaving an uninvoiced unpaid charge from a filing that
  // reported failure. So the assertion is not merely "it refused" -- it is "and nothing was written".
  const noPay = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "payment.record") };
  const beforeCharges = (await admin.from("practice_charge").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)).count ?? 0;
  const refused = await fileOfflineCollection(admin, noPay as any, {
    ...args, entityId: randomUUID(), correlationId: randomUUID(),
  });
  const afterCharges = (await admin.from("practice_charge").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)).count ?? 0;
  ok("4a a caller without payment.record is refused", refused.ok === false);
  ok("4b and NO charge was created by the refused filing -- no orphan on the patient's account",
    afterCharges === beforeCharges, `${beforeCharges} -> ${afterCharges}`);

  // ── 6. THE CHARGE-REUSE PATH, WHICH SECTION 3 DOES NOT ACTUALLY REACH ──────────────────────────
  //
  // ⚠⚠ SECTION 3 IS SATISFIED BY THE WRONG MECHANISM, AND THAT IS WORTH SAYING OUT LOUD. The payment
  // replay check runs FIRST and returns early, so "one charge, not two" up there is proved by the
  // PAYMENT being found -- the charge-reuse branch is never executed. An assertion that passes for a
  // reason other than the one in its name is the shape this estate has been bitten by before.
  //
  // The branch the module's header actually warns about is the CRASH BETWEEN THE TWO WRITES: the
  // charge landed, then recordPayment's own compensating delete removed the payment and threw. On the
  // retry the payment lookup MISSES, and only source_ref stops the patient being charged a second
  // time. That is simulated here by deleting the payment and its receipt, leaving the charge.
  const beforeReuse = (await admin.from("practice_charge").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("source_ref", txId)).count ?? 0;
  await admin.from("practice_receipt").delete().eq("workspace_id", ws).eq("payment_id", entityId);
  await admin.from("practice_payment").delete().eq("workspace_id", ws).eq("id", entityId);

  const afterCrash = await fileOfflineCollection(admin, ctx, { ...args, correlationId: txId });
  const afterReuse = (await admin.from("practice_charge").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("source_ref", txId)).count ?? 0;

  ok("6a the retry after a lost payment succeeds rather than colliding on the charge",
    afterCrash.ok === true, afterCrash.ok ? "" : JSON.stringify((afterCrash as any).code));
  ok("6b and it REUSED the charge -- still one, which is the double-charge the header warns about",
    beforeReuse === 1 && afterReuse === 1, `${beforeReuse} -> ${afterReuse}`);
  ok("6c the replacement payment is filed fresh, not reported as a replay",
    afterCrash.ok === true && afterCrash.data.replayed === false);
  // ⚠ 6a/6c AND 6b GUARD DIFFERENT THINGS, which the break-test made visible. Blinding BOTH reuse
  // lookups turns 6a and 6c red with CHARGE_EXISTS -- and 6b stays GREEN, because
  // ux_practice_charge_source refused the duplicate anyway. So the index is what makes a second charge
  // impossible, and the reuse lookup is what turns a permanently-failing retry into a successful one.
  // Blinding only the FIRST lookup changes nothing: there are two, and the fallback still finds it.
  // A break-test that misses the second one reports a passing control and proves nothing.

  // ── 5. THE CORRELATION ID IS AN IDEMPOTENCY KEY, AND NOW SAYS SO ───────────────────────────────
  // ⚠ Found by writing this harness, not by using the product. correlationId becomes the charge's
  // source_ref -- a uuid column -- so a human-readable one, which EVERY other engine in this codebase
  // accepts, came back as a 500 carrying "invalid input syntax for type uuid". A database sentence, on
  // the money path, from a function that answers every other bad input with a 422 and an explanation.
  // Production was never affected: the sync applier passes tx.id. The contract was simply undeclared.
  const badCorr = await fileOfflineCollection(admin, ctx, {
    ...args, entityId: randomUUID(), correlationId: "not-a-uuid",
  });
  const badStatus = badCorr.ok ? 0 : (badCorr as any).status;
  const badCode = badCorr.ok ? "" : (badCorr as any).code;
  const badMessage = badCorr.ok ? "" : String((badCorr as any).message ?? "");
  ok("5a a non-uuid correlation id is REFUSED as a 422, not surfaced as a database error",
    badCorr.ok === false && badStatus === 422 && badCode === "BAD_CORRELATION_ID",
    badCorr.ok ? "it was accepted" : `${badStatus} ${badCode}`);
  ok("5b and the refusal names the CONSEQUENCE, never the column type",
    /charge the patient twice/.test(badMessage) && !/uuid|syntax|column/i.test(badMessage),
    badMessage);

  await cleanup();
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
