/**
 * CPR-PD-010 §13 — AUDIT AND EVIDENCE, ACCEPTANCE.
 *
 *   S  structural: no is_valid column, and the link table uses typed parents
 *   V  validity is derived — evidence expires by the passage of time
 *   F  a finding cannot be closed without CURRENT closing evidence
 *   K  the four evidence kinds stay distinguishable (§20)
 *   Z  nothing this run created survives, INCLUDING through the typed-parent cascade
 *
 * ⚠ V2 IS THE ONE §22 EXISTS FOR. Evidence whose validity ended yesterday must read expired and
 * not-current with nothing having run — and F3 is the half that makes it bite: that same expired
 * evidence must not be able to close a finding. "Do not treat control as evidenced" is only a real rule
 * if stale evidence is actually refused somewhere.
 *
 *   npx --yes tsx scripts/gov-evidence-audit-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const FIXTURE = "PD010-EVD";
const madeEvidence: string[] = [];
const madeFindings: string[] = [];
const madeControls: string[] = [];
const madeRisks: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of madeFindings) {
    const d = await admin.from("gov_audit_finding").delete().eq("finding_id", id);
    if (d.error) cleanupError = `finding: ${String(d.error.message).slice(0, 60)}`;
  }
  // ⚠ CONTROLS BEFORE EVIDENCE. A link row hangs off both; deleting the control cascades its links, and
  // only then can the evidence go without a dangling reference stopping it.
  for (const id of madeControls) {
    const d = await admin.from("gov_control").delete().eq("control_id", id);
    if (d.error) cleanupError = `control: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeRisks) {
    const d = await admin.from("gov_product_risk").delete().eq("risk_id", id);
    if (d.error) cleanupError = `risk: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeEvidence) {
    const d = await admin.from("gov_evidence").delete().eq("evidence_id", id);
    if (d.error) cleanupError = `evidence: ${String(d.error.message).slice(0, 60)}`;
  }
  madeFindings.length = 0; madeControls.length = 0; madeRisks.length = 0; madeEvidence.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log("\nCPR-PD-010 §13 — AUDIT AND EVIDENCE\n");

  const probe = await admin.from("gov_evidence").select("evidence_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 325 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · structural ───────────────────────────────────────────────────────
  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("325-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const occ = (t: string, w: RegExp) => (t.match(w) ?? []).length;

  ok("S1", !/is_valid\s+boolean/.test(sql),
    "⚠ §22: gov_evidence declares NO is_valid column — evidence cannot stay valid because somebody set a flag when it was collected");
  ok("S1c", occ(rawSql, /is_valid/g) > occ(sql, /is_valid/g),
    `control: ${occ(rawSql, /is_valid/g)} occurrences in the file, ${occ(sql, /is_valid/g)} after stripping — S1 read DDL, not commentary`);
  ok("S2", /gov_evidence_link_one_parent/.test(sql) && !/record_type/.test(sql),
    "⚠ the link table uses TYPED parents with an exactly-one CHECK — migration 319's lesson applied preemptively rather than repeated");

  try {
    // ── V · derived validity ───────────────────────────────────────────────
    const current = await admin.from("gov_evidence").insert({
      reference: `${FIXTURE}-001`, title: "Current penetration test",
      evidence_kind: "external_assurance", owner_name: "Security",
      collected_at: new Date().toISOString(), collected_by: "Security",
      valid_from: day(-10), valid_until: day(80), held_at: "Assurance vault",
    }).select("evidence_id").limit(1);
    const currentId = current.data?.[0]?.evidence_id ?? null;
    if (currentId) madeEvidence.push(currentId);
    ok("V1", !!currentId, `evidence records — ${current.error ? String(current.error.message).slice(0, 50) : "created"}`);

    const cv = (await admin.from("gov_evidence_live").select("is_current, is_expired, days_to_expiry").eq("evidence_id", currentId).limit(1)).data?.[0];
    ok("V1b", cv?.is_current === true && cv?.is_expired === false,
      `it reads CURRENT with ${cv?.days_to_expiry} days to expiry`);

    const stale = await admin.from("gov_evidence").insert({
      reference: `${FIXTURE}-002`, title: "Last year's certificate",
      evidence_kind: "document", owner_name: "Security",
      collected_at: new Date(Date.now() - 400 * 86_400_000).toISOString(), collected_by: "Security",
      valid_from: day(-400), valid_until: day(-35),
    }).select("evidence_id").limit(1);
    const staleId = stale.data?.[0]?.evidence_id ?? null;
    if (staleId) madeEvidence.push(staleId);

    const sv = (await admin.from("gov_evidence_live").select("is_current, is_expired, days_to_expiry").eq("evidence_id", staleId).limit(1)).data?.[0];
    ok("V2", sv?.is_expired === true && sv?.is_current === false,
      `⚠⚠ §22: evidence 35 days past its validity reads EXPIRED and NOT current, with no job having run — days_to_expiry is ${sv?.days_to_expiry}`);

    // ── F · findings ───────────────────────────────────────────────────────
    const ctl = await admin.from("gov_control").insert({
      reference: `${FIXTURE}-CTL`, name: "Control under audit", owner_name: "Product Director",
    }).select("control_id").limit(1);
    const controlId = ctl.data?.[0]?.control_id ?? null;
    if (controlId) madeControls.push(controlId);

    // a second parent type, so F0d can name two of them
    const rsk = await admin.from("gov_product_risk").insert({
      reference: `${FIXTURE}-RSK`, title: "Risk under audit", category_code: "operational",
    }).select("risk_id").limit(1);
    const riskId = rsk.data?.[0]?.risk_id ?? null;
    if (riskId) madeRisks.push(riskId);

    const linked = await admin.from("gov_evidence_link").insert({
      evidence_id: currentId, control_id: controlId, note: "Supports the operating test",
    }).select("link_id").limit(1);
    ok("F0", !linked.error, `evidence links to a control through a typed parent — ${String(linked.error?.message ?? "linked").slice(0, 45)}`);

    // ⚠ THE CHECK SAYS "EXACTLY ONE", WHICH IS TWO CLAIMS, AND THE FIRST VERSION OF THIS ONLY TESTED
    // ONE OF THEM. It had a variable named `twoParents` that set a single parent, asserted the insert
    // was ACCEPTED, and called itself a control — so "not more than one" was never exercised at all.
    // A constraint half-tested is a constraint that fails in the untested half.
    const oneParent = await mustReject("gov_evidence_link", {
      evidence_id: currentId, control_id: controlId, note: "exactly one",
    }, "link_id");
    ok("F0b", !oneParent.rejected,
      "control: exactly ONE parent IS accepted — so F0c and F0d constrain the count rather than refusing every link");

    const noParent = await mustReject("gov_evidence_link", { evidence_id: currentId, note: "orphan" }, "link_id");
    ok("F0c", noParent.rejected, `a link with NO parent is refused — ${noParent.message}`);

    const twoParents = await mustReject("gov_evidence_link", {
      evidence_id: currentId, control_id: controlId, risk_id: riskId, note: "two",
    }, "link_id");
    ok("F0d", twoParents.rejected,
      `⚠ and a link naming TWO parents is refused — the other half of "exactly one", which the first version of this harness never exercised — ${twoParents.message}`);

    const finding = await admin.from("gov_audit_finding").insert({
      reference: `${FIXTURE}-F1`, title: "Check missing on two records",
      control_id: controlId, severity: "major", raised_by: "Auditor",
      owner_name: "Product Director", due_on: day(20), state: "open",
    }).select("finding_id").limit(1);
    const findingId = finding.data?.[0]?.finding_id ?? null;
    if (findingId) madeFindings.push(findingId);
    ok("F1", !!findingId, `a finding records — ${finding.error ? String(finding.error.message).slice(0, 50) : "created"}`);

    const closeBare = await admin.from("gov_audit_finding")
      .update({ state: "closed", closed_at: new Date().toISOString() }).eq("finding_id", findingId);
    ok("F2", !!closeBare.error,
      `⚠ §13: closing a finding with NO closing evidence is refused — a deficiency is closed by evidence it is gone, not by somebody marking it closed — ${String(closeBare.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const closeStale = await admin.from("gov_audit_finding")
      .update({ state: "closed", closed_at: new Date().toISOString(), closing_evidence_id: staleId })
      .eq("finding_id", findingId);
    ok("F3", !!closeStale.error,
      `⚠⚠ §22: closing it with EXPIRED evidence is refused — "do not treat control as evidenced" is only a rule if stale evidence is actually refused — ${String(closeStale.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const closeCurrent = await admin.from("gov_audit_finding")
      .update({ state: "closed", closed_at: new Date().toISOString(), closing_evidence_id: currentId })
      .eq("finding_id", findingId);
    ok("F4", !closeCurrent.error,
      `⚠ CONTROL — CURRENT evidence DOES close it, so F2 and F3 constrain the evidence and are not a ban on closing findings — ${String(closeCurrent.error?.message ?? "closed").slice(0, 45)}`);

    // ── K · the four kinds stay apart ──────────────────────────────────────
    const badKind = await mustReject("gov_evidence", {
      reference: `${FIXTURE}-003`, title: "x", evidence_kind: "screenshot",
    }, "evidence_id");
    ok("K1", badKind.rejected,
      `§20: the evidence kind is a closed vocabulary, so a system export and somebody's word stay distinguishable — ${badKind.message}`);

    const restrictedNoReason = await mustReject("gov_evidence", {
      reference: `${FIXTURE}-004`, title: "x", evidence_kind: "document", is_restricted: true,
    }, "evidence_id");
    ok("K2", restrictedNoReason.rejected,
      `§8/§19: restricting a record without saying why is refused — ${restrictedNoReason.message}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftEvidence = await admin.from("gov_evidence").select("evidence_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !leftEvidence.error && (leftEvidence.count ?? 0) === 0, `no fixture evidence is left — ${leftEvidence.count ?? "?"} found`);

  const leftLinks = await admin.from("gov_evidence_link").select("link_id", { count: "exact", head: true });
  ok("Z2", !leftLinks.error && (leftLinks.count ?? 0) === 0,
    `⚠ and no link row survives — the typed parents cascade, which is exactly what the polymorphic version could not do — ${leftLinks.count ?? "?"} found`);

  const leftFindings = await admin.from("gov_audit_finding").select("finding_id", { count: "exact", head: true });
  ok("Z3", !leftFindings.error && (leftFindings.count ?? 0) === 0, `nor any finding — ${leftFindings.count ?? "?"} found`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
