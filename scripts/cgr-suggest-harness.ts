// One-off harness for the CGR-027 AI link suggester. Calls the SHIPPED engine (@/lib/cgr/suggest-links) — the
// same code the route runs — so the hallucination guard is exercised for real rather than in a replica.
// Env is loaded by @next/env; secrets are read by the process, never printed.
//   npx --yes tsx scripts/cgr-suggest-harness.ts          → dry run (no DB writes)
//   npx --yes tsx scripts/cgr-suggest-harness.ts --write  → live run (inserts proposed links)
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

async function main() {
  const write = process.argv.includes("--write");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env (URL / service-role key)."); process.exit(1); }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { suggestLearningLinks } = await import("../src/lib/cgr/suggest-links");

  // Ground truth first — so an empty result is diagnosable rather than mysterious.
  const [inc, comp, links] = await Promise.all([
    admin.from("op_incidents").select("id", { count: "exact", head: true }),
    admin.from("framework_competencies").select("id", { count: "exact", head: true }),
    admin.from("competency_learning_links").select("id", { count: "exact", head: true }),
  ]);
  console.log("── Ground truth ──");
  console.log("op_incidents:", inc.error ? `ERROR ${inc.error.message}` : inc.count);
  console.log("framework_competencies:", comp.error ? `ERROR ${comp.error.message}` : comp.count);
  console.log("competency_learning_links:", links.error ? `ERROR ${links.error.message}` : links.count);
  console.log();

  console.log(`── Running suggester (${write ? "LIVE — will insert" : "DRY RUN — no writes"}) ──`);
  const t0 = Date.now();
  // No human ran this interactively, so created_by stays null and the name says exactly what produced the row.
  // Attributing it to a real person would be false provenance on something that becomes governance evidence.
  const r = await suggestLearningLinks(admin, { userId: null, hospitalId: null, createdByName: "AI suggester (automated run)", dryRun: !write });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (!r.ok) { console.error("FAILED:", r.error); process.exit(1); }
  if (r.note) console.log("note:", r.note);

  console.log(`model: ${r.model ?? "—"}   (${secs}s)`);
  console.log("analysed (unlinked signals):", r.analysed);
  console.log("returned by model:          ", r.returned);
  console.log("proposed (passed guard):    ", r.proposed);
  console.log("DISCARDED by guard:         ", r.rejected);
  console.log("skipped (already linked):   ", r.skipped);
  console.log(`parse: ${r.parseStatus}  (raw ${r.rawLength} chars)`);
  if (r.parseStatus !== "parsed") console.log("\n── Raw model output (first 400 chars) ──\n" + (r.rawPreview || "(empty)"));

  if (r.rejectReasons.length) {
    console.log("\n── Discard reasons ──");
    r.rejectReasons.forEach((x, i) => console.log(`${i + 1}. ${x}`));
  }
  if (r.suggestions.length) {
    console.log("\n── Proposals ──");
    r.suggestions.slice(0, 10).forEach((s, i) => console.log(`${i + 1}. [${s.linkType}] ${s.signal}  →  ${s.competency}`));
  }

  const guardBit = r.returned > 0 ? `${Math.round((r.rejected / r.returned) * 100)}% of returned items` : "n/a (model returned nothing)";
  console.log(`\nGuard bite rate: ${guardBit}`);

  // A 0% discard rate is ambiguous — a well-behaved model and a broken guard look identical from outside.
  // Negative-test the guard directly with fabricated payloads so the rejection path is proven, not assumed.
  const { validateSuggestion } = await import("../src/lib/cgr/suggest-links");
  const realSignal = "11111111-1111-1111-1111-111111111111";
  const realComp = "22222222-2222-2222-2222-222222222222";
  const sigs = new Set([realSignal]);
  const comps2 = new Set([realComp]);
  const cases: [string, any, boolean][] = [
    ["valid control", { incident_id: realSignal, competency_id: realComp, rationale: "a sufficiently long rationale", link_type: "caused_change" }, true],
    ["invented competency_id", { incident_id: realSignal, competency_id: "deadbeef-0000-0000-0000-000000000000", rationale: "a sufficiently long rationale" }, false],
    ["invented incident_id", { incident_id: "deadbeef-0000-0000-0000-000000000000", competency_id: realComp, rationale: "a sufficiently long rationale" }, false],
    ["rationale too thin", { incident_id: realSignal, competency_id: realComp, rationale: "too short" }, false],
    ["bad link_type", { incident_id: realSignal, competency_id: realComp, rationale: "a sufficiently long rationale", link_type: "auto_approve" }, false],
    ["not an object", "just a string", false],
  ];
  console.log("\n── Guard negative test ──");
  let pass = 0;
  for (const [name, payload, shouldPass] of cases) {
    const reasons = validateSuggestion(payload, sigs, comps2);
    const passed = reasons.length === 0;
    const ok = passed === shouldPass;
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name} → ${passed ? "accepted" : `rejected (${reasons.join("; ")})`}`);
  }
  console.log(`${pass}/${cases.length} guard cases behaved as specified.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
