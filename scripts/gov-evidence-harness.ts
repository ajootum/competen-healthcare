/**
 * CPR-PD-010 — THE THREE EVIDENCE GATES, ACCEPTANCE.
 *
 *   P  posture is never determined without a published methodology, and IS determined once there is one
 *   C  control assurance never collapses design and operating effectiveness, and never calls untested effective
 *   T  no trend is drawn without a prior period, and one IS drawn once there is one
 *   S  the schema refuses to publish a methodology that cannot produce a posture
 *
 * ⚠ EVERY GATE IS TESTED IN BOTH DIRECTIONS. A gate that only ever refuses is indistinguishable from a
 * function that returns a constant — and it is the shape a "not yet built" placeholder has. The owner
 * asked for these to be trend-ready and posture-ready, so the assertions that matter most are the ones
 * proving each gate OPENS when its evidence arrives.
 *
 *   npx --yes tsx scripts/gov-evidence-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  posture, controlAssurance, trend,
  DESIGN_EFFECTIVENESS, OPERATING_EFFECTIVENESS,
  type RiskMethodology, type EffectivenessValue,
} from "../src/lib/hq/gov-evidence";

loadEnvConfig(process.cwd());
/* eslint-disable @typescript-eslint/no-explicit-any */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = url && key ? createClient(url, key, { auth: { persistSession: false } }) as any : null;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

/** A methodology that CAN produce a posture — used to prove the gate opens, not only that it shuts. */
const PUBLISHED: RiskMethodology = {
  methodologyId: "00000000-0000-4000-8000-000000000001",
  version: 1,
  name: "Acceptance methodology",
  aggregationRule: "Highest residual score across assessed risks.",
  publishedAt: "2026-08-18T00:00:00Z",
  effectiveFrom: "2026-08-18T00:00:00Z",
  bands: [
    { code: "low", label: "Low", definition: "No residual risk above 6.", sortOrder: 10 },
    { code: "moderate", label: "Moderate", definition: "At least one residual risk between 7 and 14.", sortOrder: 20 },
  ],
};

async function main() {
  console.log("\nCPR-PD-010 — THE THREE EVIDENCE GATES\n");

  // ── P · posture ──────────────────────────────────────────────────────────
  const none = posture(null, { bandCode: "moderate", assessedRisks: 40 });
  ok("P1", none.state === "not_determined",
    "⚠ with NO methodology, posture is not determined even when an aggregate and a band code are supplied");
  ok("P2", none.state === "not_determined" && /no approved, versioned risk scale and aggregation methodology is active/.test(none.why),
    "and the reason is the owner's sentence, verbatim, so eleven screens cannot each soften it");

  const noBands = posture({ ...PUBLISHED, bands: [] }, { bandCode: "moderate", assessedRisks: 40 });
  ok("P3", noBands.state === "not_determined",
    "a published methodology with NO bands still cannot state a posture — an aggregate needs somewhere to land");

  const noRisks = posture(PUBLISHED, { bandCode: "low", assessedRisks: 0 });
  ok("P4", noRisks.state === "not_determined" && /nobody has looked yet/.test(noRisks.why),
    "⚠ a methodology over ZERO assessed risks is not 'Low' — a separate refusal with a separate sentence");

  const unknownBand = posture(PUBLISHED, { bandCode: "catastrophic", assessedRisks: 5 });
  ok("P5", unknownBand.state === "not_determined",
    "an aggregate outside every declared band refuses rather than picking the nearest one");

  const determined = posture(PUBLISHED, { bandCode: "moderate", assessedRisks: 12 });
  ok("P6", determined.state === "determined" && determined.label === "Moderate",
    "⚠ CONTROL — the gate OPENS with no code change once a methodology is published. A gate that only refuses is a constant");
  ok("P7", determined.state === "determined" && determined.definition.length > 0 && determined.aggregationRule !== null,
    "§3: a determined posture carries its DEFINITION and the aggregation rule, so a reader never has to ask what Moderate meant");

  // ⚠ STRUCTURAL: there must be no way to ASK for a fallback. A `default`/`assume` parameter would make
  // every assertion above a statement about how this harness calls the function rather than about what
  // the function can do.
  //
  // ⚠ COMMENTS ARE STRIPPED FIRST, AND THE FIRST VERSION OF THIS PIN DID NOT DO IT — SO IT FAILED ON
  // ITS OWN EXPLANATION. The module argues at length that it has no fallback and draws no flat line;
  // those very words then matched the needle. The recorded class is "a needle that matches itself", and
  // it fails in the dangerous direction as often as this harmless one: had the module CONTAINED a
  // fallback and a comment forbidding it, a naive scan would have been just as red for the wrong reason
  // and I would have "fixed" the comment.
  const rawSrc = readFileSync("src/lib/hq/gov-evidence.ts", "utf8");
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

  ok("P8", !/fallback|assumeModerate|defaultPosture|\bdefaultBand\b/i.test(src),
    "structural: posture() accepts no fallback, default or assumed band — there is nowhere to pass one in");
  ok("P8c", /fallback/i.test(rawSrc) && !/fallback/i.test(src),
    "control: the word DOES appear in the module's prose and the stripper removed it, so P8 read code and not commentary");

  // ── C · control assurance ────────────────────────────────────────────────
  const controls: { designEffectiveness: EffectivenessValue; operatingEffectiveness: EffectivenessValue }[] = [
    ...Array(85).fill({ designEffectiveness: "effective", operatingEffectiveness: "effective" }),
    ...Array(28).fill({ designEffectiveness: "partial", operatingEffectiveness: "partial" }),
    ...Array(9).fill({ designEffectiveness: "ineffective", operatingEffectiveness: "ineffective" }),
    ...Array(10).fill({ designEffectiveness: "not_assessed", operatingEffectiveness: "not_tested" }),
  ];
  const ca = controlAssurance(controls);

  ok("C1", ca.aggregateEffectivenessPct === null,
    "⚠ NO aggregate effectiveness percentage is produced — not the comp's 87%, and not the honest-looking 64% either");
  ok("C2", ca.total === 132 && ca.assessed === 122 && ca.notTested === 10,
    `the summary card is a count and its denominator: ${ca.assessed} / ${ca.total} assessed, ${ca.notTested} not tested`);
  ok("C3", ca.design.length === DESIGN_EFFECTIVENESS.length && ca.operating.length === OPERATING_EFFECTIVENESS.length,
    "§6: design and operating effectiveness are reported as TWO distributions, never merged into one");
  ok("C4", !DESIGN_EFFECTIVENESS.includes("not_tested") && !OPERATING_EFFECTIVENESS.includes("not_assessed"),
    "the two axes have DIFFERENT vocabularies — a design is 'not assessed', an operation is 'not tested', and they are not synonyms");

  const untestedOnly = controlAssurance([{ designEffectiveness: "effective", operatingEffectiveness: "not_tested" }]);
  ok("C5", untestedOnly.assessed === 0 && untestedOnly.operating.find(o => o.value === "effective")?.n === 0,
    "⚠ §22: a well-DESIGNED but never-TESTED control counts as neither assessed nor operating-effective");
  ok("C6", untestedOnly.notTested === 1,
    "control: that same control IS counted as not tested — C5 is about where it lands, not about it vanishing");

  // ── T · trend ────────────────────────────────────────────────────────────
  const noPrior = trend({ current: 12, prior: null, series: [], priorPeriod: null });
  ok("T1", noPrior.state === "unavailable",
    "⚠ with no prior period, the trend is unavailable — never a flat line, a 0% delta or a repeated point");
  ok("T2", noPrior.state === "unavailable" && !("series" in noPrior) && !("delta" in noPrior),
    "structural: the unavailable case carries NO series and NO delta, so a component cannot plot one by accident");

  const onePoint = trend({ current: 12, prior: 12, series: [12], priorPeriod: "Apr 18 - May 17" });
  ok("T3", onePoint.state === "unavailable",
    "one observation is not a series — two points are a line, and one point repeated is a fabricated observation");

  const real = trend({ current: 12, prior: 14, series: [14, 13, 12], priorPeriod: "Apr 18 - May 17" });
  ok("T4", real.state === "available" && real.delta === -2 && real.series.length === 3,
    "⚠ CONTROL — the gate OPENS on its own once a prior period and enough observations exist");
  ok("T5", real.state === "available" && real.priorPeriod === "Apr 18 - May 17",
    "and the comparison NAMES its period rather than implying one, so 'vs' is checkable");

  ok("T6", !/flat|placeholder|comingSoon|notYetImplemented/i.test(src),
    "structural: no flat-series or placeholder path exists in the module");

  // ── S · the schema half of the same rule ─────────────────────────────────
  const sql = readdirSync("supabase/migrations").filter(f => f.startsWith("320-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  ok("S1", sql.length > 0, "migration 320 is on disk");
  ok("S2", /at least two likelihood and two impact scale points/.test(sql) && /at least one posture band/.test(sql),
    "⚠ the DATABASE refuses to publish a methodology that could not produce a posture — the gate is in both places");
  ok("S3", /definition\s+text not null check \(btrim\(definition\) <> ''\)/.test(sql),
    "§5: a scale point cannot be published without its definition, so '4' can never mean two things to two assessors");
  ok("S4", !/insert into gov_risk_methodology/.test(sql),
    "⚠ NO methodology is seeded — a plausible 5x5 in the migration would render a governed-looking posture within a minute of applying it");
  ok("S5", /insert into gov_risk_category/.test(sql),
    "control: the migration DOES seed something (categories), so S4 is about methodology specifically and not about an empty file");

  // ── live estate, if reachable ────────────────────────────────────────────
  if (admin) {
    const m = await admin.from("gov_risk_methodology").select("methodology_id, status").limit(5);
    if (m.error) {
      console.log(`\n  (migration 320 not applied yet — ${String(m.error.message).slice(0, 60)})`);
    } else {
      const published = (m.data as { status: string }[]).filter(r => r.status === "published");
      ok("L1", published.length === 0,
        `live: no methodology is published, so the overview will render Not Yet Determined — ${m.data.length} row(s) exist`);
    }
  }

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(e => { console.error("HARNESS CRASHED:", e); process.exit(1); });
