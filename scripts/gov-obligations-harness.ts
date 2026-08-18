/**
 * CPR-PD-010 §10 — COMPLIANCE AND OBLIGATIONS, ACCEPTANCE.
 *
 *   S  structural: the obligation carries no compliance_state column
 *   N  the five states, and specifically that the TWO ABSENCES stay apart
 *   J  applicability is subject-scoped, so one jurisdiction cannot be hard-coded
 *   A  assessments are append only
 *   Z  nothing this run created survives
 *
 * ⚠ N1 AND N3 ARE THE PAIR THIS MODULE EXISTS FOR. An obligation nobody has assessed reads NOT ASSESSED
 * — the absence of a judgement. An obligation somebody examined and ruled irrelevant reads NOT
 * APPLICABLE — a judgement, with a name and a reason. They are epistemic opposites, and a
 * compliance_state column would make them one keystroke apart.
 *
 *   npx --yes tsx scripts/gov-obligations-harness.ts
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

const FIXTURE = "PD010-OBL";
const made: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of made) {
    const d = await admin.from("gov_obligation").delete().eq("obligation_id", id);
    if (d.error) cleanupError = String(d.error.message).slice(0, 70);
  }
  made.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

const stateOf = async (id: string) =>
  (await admin.from("gov_obligation_state")
    .select("state, never_assessed, subject_type, rationale").eq("obligation_id", id).limit(1)).data?.[0];

async function main() {
  console.log("\nCPR-PD-010 §10 — COMPLIANCE AND OBLIGATIONS\n");

  const probe = await admin.from("gov_obligation").select("obligation_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 326 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · structural ───────────────────────────────────────────────────────
  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("326-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const occ = (t: string, w: RegExp) => (t.match(w) ?? []).length;

  const obligationDdl = sql.slice(sql.indexOf("create table if not exists gov_obligation ("),
    sql.indexOf("comment on table gov_obligation "));
  ok("S1", !/compliance_state/.test(obligationDdl),
    "⚠ §10: gov_obligation declares NO compliance_state — so 'not assessed' cannot be a value somebody typed and then forgot");
  ok("S1c", occ(rawSql, /compliance_state/g) > occ(obligationDdl, /compliance_state/g),
    `control: the column exists ${occ(sql, /compliance_state/g)} times elsewhere in the file — on the ASSESSMENT — so S1 is about placement, not about the concept being absent`);

  try {
    // ── N · the five states, and the two absences ──────────────────────────
    const o = await admin.from("gov_obligation").insert({
      reference: `${FIXTURE}-001`, title: "Data retention schedule",
      requirement: "Retain clinical records for the statutory period.",
      source_kind: "law_regulation", source_authority: "Ministry of Health",
      owner_name: "Product Director", review_frequency: "annual",
    }).select("obligation_id").limit(1);
    const oblId = o.data?.[0]?.obligation_id ?? null;
    if (oblId) made.push(oblId);
    ok("N0", !!oblId, `an obligation registers — ${o.error ? String(o.error.message).slice(0, 50) : "created"}`);

    let st = await stateOf(oblId);
    ok("N1", st?.state === "not_assessed" && st?.never_assessed === true,
      `⚠⚠ §10: an obligation nobody has assessed reads NOT ASSESSED — the ABSENCE of a judgement, produced by a join finding nothing rather than by a default — got "${st?.state}"`);

    // NOT APPLICABLE requires a reason
    const bareNA = await mustReject("gov_obligation_assessment", {
      obligation_id: oblId, applicability: "not_applicable", assessed_by: "Compliance",
    }, "assessment_id");
    ok("N2", bareNA.rejected,
      `⚠ §10: NOT APPLICABLE without a rationale is refused — deciding a regulation does not bind you is a conclusion that carries a name and a reason — ${bareNA.message}`);

    const na = await admin.from("gov_obligation_assessment").insert({
      obligation_id: oblId, applicability: "not_applicable", assessed_by: "Compliance",
      rationale: "The product stores no clinical records in this market.",
      subject_type: "market", subject_id: "UG",
    }).select("assessment_id").limit(1);
    ok("N3a", !na.error, `a reasoned NOT APPLICABLE records — ${na.error ? String(na.error.message).slice(0, 50) : "recorded"}`);

    st = await stateOf(oblId);
    ok("N3", st?.state === "not_applicable" && st?.never_assessed === false && !!st?.rationale,
      `⚠⚠ and it now reads NOT APPLICABLE, distinctly from not_assessed, carrying its rationale — "${st?.state}"`);

    // the two halves cannot disagree
    const applicableNoState = await mustReject("gov_obligation_assessment", {
      obligation_id: oblId, applicability: "applicable", assessed_by: "Compliance",
    }, "assessment_id");
    ok("N4", applicableNoState.rejected,
      `§10: an APPLICABLE assessment with no compliance state is refused — the two halves cannot disagree — ${applicableNoState.message}`);

    const naWithState = await mustReject("gov_obligation_assessment", {
      obligation_id: oblId, applicability: "not_applicable", rationale: "x",
      compliance_state: "compliant", assessed_by: "Compliance",
    }, "assessment_id");
    ok("N5", naWithState.rejected,
      `⚠ and a NOT APPLICABLE assessment claiming "compliant" is refused — a verdict against something that does not bind you is the most misleading way to record it — ${naWithState.message}`);

    const adverseNoGap = await mustReject("gov_obligation_assessment", {
      obligation_id: oblId, applicability: "applicable", compliance_state: "non_compliant",
      assessed_by: "Compliance",
    }, "assessment_id");
    ok("N6", adverseNoGap.rejected,
      `§10: NON-COMPLIANT with no gap stated is refused — the gap is the actionable part — ${adverseNoGap.message}`);

    const compliant = await admin.from("gov_obligation_assessment").insert({
      obligation_id: oblId, applicability: "applicable", compliance_state: "compliant",
      assessed_by: "Compliance", subject_type: "product",
    }).select("assessment_id").limit(1);
    ok("N7", !compliant.error,
      "control: COMPLIANT needs no gap summary — N6 constrains adverse states, not every assessment");

    st = await stateOf(oblId);
    ok("N8", st?.state === "compliant",
      `⚠ CONTROL — the derived state MOVES to the newest assessment, so the resolver is not a constant — "${st?.state}"`);

    // ── J · subject scoping ────────────────────────────────────────────────
    ok("J1", /subject_type\s+text not null default 'product' references mos_subject_type/.test(sql),
      "⚠ §10: applicability is scoped to a canonical SUBJECT, so an obligation binding in one market and irrelevant in another does not need one of them to overwrite the other");
    ok("J2", !/'UG'|'KE'|'GB'|'US'/.test(sql),
      "and no jurisdiction is hard-coded anywhere in the migration — §10 forbids exactly that");

    // ── A · append only ────────────────────────────────────────────────────
    const anyA = await admin.from("gov_obligation_assessment").select("assessment_id").eq("obligation_id", oblId).limit(1);
    const aId = anyA.data?.[0]?.assessment_id;
    const upd = await admin.from("gov_obligation_assessment").update({ compliance_state: "compliant" }).eq("assessment_id", aId);
    ok("A1", !!upd.error,
      `⚠ §20: an UPDATE on an assessment is refused — "we used to think this did not apply to us" must stay recoverable — ${String(upd.error?.message ?? "ACCEPTED").slice(0, 50)}`);
    const del = await admin.from("gov_obligation_assessment").delete().eq("assessment_id", aId);
    ok("A2", !!del.error, `and a direct DELETE is refused — ${String(del.error?.message ?? "ACCEPTED").slice(0, 50)}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const left = await admin.from("gov_obligation").select("obligation_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !left.error && (left.count ?? 0) === 0, `no fixture obligation is left — ${left.count ?? "?"} found`);

  const leftA = await admin.from("gov_obligation_assessment").select("assessment_id", { count: "exact", head: true });
  ok("Z2", !leftA.error && (leftA.count ?? 0) === 0,
    `⚠ and no assessment survives — reachable only through the cascade, since a direct delete is refused — ${leftA.count ?? "?"} found`);

  ok("Z3", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
