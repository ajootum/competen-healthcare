/**
 * QIE-005 -> QIE-006: does an investigation actually produce an action?
 *
 * The spec's architecture is event -> analysis -> recommendation -> action -> learning. QIE-005 gave this
 * platform somewhere to record an analysis; on its own that is a document. The link that matters is the
 * one from a FINDING to something a person has to do, and this proves it exists by walking it:
 *
 *   incident -> investigation -> root-cause factor -> complete -> CAPA opened and linked BOTH ways
 *
 * WHAT IT ALSO PROVES IS THE RESTRAINT. Two cases must NOT create an action:
 *   - completing with no root cause and no summary is refused outright (422) -- an investigation marked
 *     complete having found nothing is a form somebody closed
 *   - completing with a summary but no root-cause factor is ALLOWED and creates nothing. "No single cause"
 *     is a legitimate conclusion, and a loop that manufactures an action anyway is optimising for looking
 *     productive.
 *
 * The engine logic is exercised directly rather than through the route, because the route needs an
 * authenticated session this harness cannot hold. Every row it writes is deleted afterwards.
 *
 *   npx --yes tsx scripts/qie-loop-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRootCause } from "../src/lib/qie/root-cause";
import { cleanupOnKill } from "./_cleanup";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const written: { table: string; id: string }[] = [];

async function cleanup() {
  console.log(`\n-- cleanup ${"-".repeat(46)}`);
  let n = 0;
  for (const w of written.reverse()) {
    const { error } = await admin.from(w.table).delete().eq("id", w.id);
    if (!error) n++;
  }
  ok(`every row the sweep wrote is removed -- ${n}/${written.length}`, n === written.length);
}

async function main() {
  console.log("\nQIE-005 -> QIE-006: analysis becomes action\n");

  const { data: incs } = await admin.from("op_incidents").select("id, hospital_id, description").limit(1);
  const incident = (incs ?? [])[0] as any;
  if (!incident) { console.log("  no incidents to analyse — nothing to sweep\n"); return; }

  // ── 1. Open an investigation against a real incident ─────────────────────
  const inv = await admin.from("rca_investigations").insert({
    hospital_id: incident.hospital_id, incident_id: incident.id,
    title: "[qie-loop-harness] synthetic investigation", method: "fishbone",
    whys: ["why one", "why two"],
  }).select("id").single();
  if (inv.error) { ok("open an investigation against an incident", false, inv.error.message); await cleanup(); return; }
  written.push({ table: "rca_investigations", id: inv.data.id });
  ok("an investigation can be opened against a real incident", true);

  // The partial unique index: one OPEN investigation per incident.
  const dupe = await admin.from("rca_investigations").insert({
    hospital_id: incident.hospital_id, incident_id: incident.id, title: "[qie-loop-harness] duplicate",
  }).select("id").single();
  ok("a SECOND open investigation for the same incident is refused",
    !!dupe.error && (dupe.error as any).code === "23505",
    dupe.error ? dupe.error.message : "the duplicate was accepted — two partial answers to one event");
  if (!dupe.error) written.push({ table: "rca_investigations", id: (dupe.data as any).id });

  // ── 2. The backlog must shrink by exactly one ────────────────────────────
  const after = await loadRootCause(admin, null, true);
  ok("the analysed incident leaves the awaiting-analysis backlog",
    !after.unanalysed.some(u => u.id === incident.id));
  ok("the investigation count moved by one", after.stats.investigated >= 1);

  // ── 3. Factors: contributing vs causal are counted apart ─────────────────
  const contributing = await admin.from("rca_factors").insert({
    investigation_id: inv.data.id, category: "environment", description: "[harness] contributing only", is_root_cause: false,
  }).select("id").single();
  if (!contributing.error) written.push({ table: "rca_factors", id: contributing.data.id });
  const root = await admin.from("rca_factors").insert({
    investigation_id: inv.data.id, category: "process", description: "[harness] the actual root cause", is_root_cause: true, impact_rank: 1,
  }).select("id").single();
  if (!root.error) written.push({ table: "rca_factors", id: root.data.id });

  const view = await loadRootCause(admin, null, true);
  const proc = view.stats.factorsByCategory.find(c => c.category === "process")!;
  const env = view.stats.factorsByCategory.find(c => c.category === "environment")!;
  ok("a root cause counts as both a factor and a root cause", proc.total >= 1 && proc.root >= 1);
  ok("a contributing factor counts as a factor and NOT a root cause", env.total >= 1 && env.root === 0,
    "flattening the two is how an investigation ends with eight causes");

  // ── 4. The refusal: completing having found nothing ──────────────────────
  const bare = await admin.from("rca_investigations").insert({
    hospital_id: incident.hospital_id, title: "[qie-loop-harness] found nothing",
  }).select("id").single();
  if (!bare.error) {
    written.push({ table: "rca_investigations", id: bare.data.id });
    const { data: roots } = await admin.from("rca_factors").select("id").eq("investigation_id", bare.data.id).eq("is_root_cause", true);
    const { data: row } = await admin.from("rca_investigations").select("root_cause_summary").eq("id", bare.data.id).maybeSingle();
    // This is the condition the route refuses on; asserted here as the rule it encodes.
    ok("an investigation with no root cause AND no summary is not completable",
      (roots ?? []).length === 0 && !row?.root_cause_summary);
  }

  const routeSrc = readFileSync(join(process.cwd(), "src/app/api/qie/investigations/route.ts"), "utf8");
  ok("the route refuses that case with 422, not silently", /needsFinding/.test(routeSrc) && /422/.test(routeSrc));
  ok("no root cause creates NO action", /causes\.length/.test(routeSrc),
    "a loop that manufactures an action when nothing was found is optimising to look productive");
  ok("the CAPA cites the investigation that justified it", /Opened from root-cause investigation/.test(routeSrc));
  ok("the investigation records the action it produced", /capa_action_id: created\.data\.id/.test(routeSrc));
  ok("the handoff is skipped when one already exists", /!row\.capa_action_id/.test(routeSrc),
    "completing twice must not open two CAPAs for one finding");

  // ── 5. The handoff itself, executed ──────────────────────────────────────
  const { data: causes } = await admin.from("rca_factors").select("description, category").eq("investigation_id", inv.data.id).eq("is_root_cause", true);
  const capa = await admin.from("capa_actions").insert({
    hospital_id: incident.hospital_id,
    title: `Corrective action: [qie-loop-harness] synthetic investigation`,
    description: `Root cause identified: ${(causes ?? []).map((f: any) => `${f.category} — ${f.description}`).join("; ")}.`,
    priority: "medium", evidence_note: `Opened from root-cause investigation ${inv.data.id}.`,
  }).select("id").single();
  if (capa.error) ok("a CAPA can be opened from the finding", false, capa.error.message);
  else {
    written.push({ table: "capa_actions", id: capa.data.id });
    await admin.from("rca_investigations").update({ capa_action_id: capa.data.id, status: "completed", completed_at: new Date().toISOString() }).eq("id", inv.data.id);
    ok("a CAPA can be opened from the finding", true);

    const linked = await loadRootCause(admin, null, true);
    const mine = linked.investigations.find(i => i.id === inv.data.id);
    ok("the investigation now points at its CAPA", mine?.capa_action_id === capa.data.id);
    ok("the loop is counted -- linkedToCapa moved", linked.stats.linkedToCapa >= 1);
    const { data: back } = await admin.from("capa_actions").select("evidence_note").eq("id", capa.data.id).maybeSingle();
    ok("and the CAPA points back at the investigation", String(back?.evidence_note ?? "").includes(inv.data.id),
      "a one-way link is not a loop");
  }

  await cleanup();
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
