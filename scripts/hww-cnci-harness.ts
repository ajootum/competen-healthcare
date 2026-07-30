// One-off harness for the CNCI engine (HWW-ARCH-002 S9) — pure tests over the
// SHIPPED lib (@/lib/hww/cnci): component weights, band edges, driver
// explainability, monotonicity (worse signals never lower the score), the
// row-shape assembler and the S8 reassessment-due rule.
//   npx --yes tsx scripts/hww-cnci-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const { computeCnci, cnciBand, cnciInputFromRows, pewsTrend, reassessmentDue, CNCI_WEIGHTS } = await import("../src/lib/hww/cnci");

  const base = {
    acuityScore: null as number | null, acuityLevel: "stable", workloadPct: null as number | null,
    pewsLatest: null as number | null, pewsPrev: null as number | null, significantAcuityChange: false,
    activeAlerts: 0, openEscalations: 0, isolation: false, riskLevel: "low",
    obsOverdue: 0, obsDue: 0, medsOverdue: 0, medsDueSoon: 0, urgentTasks: 0, openConcerns: 0,
  };

  console.log("── computeCnci ──");
  let r = computeCnci(base);
  check(r.score <= 5 && r.band === "low", "quiet stable patient scores low", `${r.score} ${r.band}`);
  check(r.drivers.length === 1 && r.drivers[0] === "no elevated signals", "quiet patient states no elevated signals");

  const worst = { ...base, acuityScore: 18, acuityLevel: "critical", workloadPct: 120, pewsLatest: 9, pewsPrev: 6, significantAcuityChange: true, activeAlerts: 3, openEscalations: 2, isolation: true, riskLevel: "high", obsOverdue: 3, medsOverdue: 2, urgentTasks: 3, openConcerns: 2 };
  r = computeCnci(worst);
  check(r.score === 100 && r.band === "critical", "everything-maxed patient scores exactly 100", `${r.score}`);
  const compSum = Object.values(r.components).reduce((a, b) => a + b, 0);
  check(Math.abs(compSum - r.score) <= 2, "components sum to the score (rounding tolerance)", `${compSum} vs ${r.score}`);
  check(Object.values(CNCI_WEIGHTS).reduce((a, b) => a + b, 0) === 100, "component ceilings sum to 100");
  check(r.drivers.length >= 5, "worst case names its drivers", r.drivers.join(" | "));

  check(cnciBand(80) === "critical" && cnciBand(79) === "high" && cnciBand(60) === "high" && cnciBand(59) === "moderate" && cnciBand(30) === "moderate" && cnciBand(29) === "low", "band edges 80/60/30 (mockup legend)");

  // Monotonicity: adding a bad signal never lowers the score.
  const mid = { ...base, acuityScore: 10, acuityLevel: "high", workloadPct: 50, pewsLatest: 4, pewsPrev: 4 };
  const midScore = computeCnci(mid).score;
  for (const [key, val] of Object.entries({ activeAlerts: 1, openEscalations: 1, obsOverdue: 1, medsOverdue: 1, urgentTasks: 1, openConcerns: 1, isolation: true, significantAcuityChange: true }) as [string, any][]) {
    const s = computeCnci({ ...mid, [key]: val }).score;
    check(s >= midScore, `adding ${key} never lowers the score`, `${midScore} → ${s}`);
  }

  // Measured acuity beats the level fallback when higher.
  const lvlOnly = computeCnci({ ...base, acuityLevel: "moderate" }).score;
  const measured = computeCnci({ ...base, acuityLevel: "moderate", acuityScore: 16 }).score;
  check(measured > lvlOnly, "measured 16/18 outranks the 'moderate' fallback", `${lvlOnly} → ${measured}`);

  console.log("\n── assembler + helpers ──");
  const input = cnciInputFromRows({
    patient: { acuity_level: "high", isolation_status: "contact", risk_level: "high" },
    acuityLatest: { score: 12, significant_change: true },
    workloadLatest: { percentage: 81.2 },
    observations: [
      { status: "recorded", ews_score: 6, recorded_at: "2026-07-30T10:00:00Z" },
      { status: "recorded", ews_score: 4, recorded_at: "2026-07-30T06:00:00Z" },
      { status: "overdue" }, { status: "due" },
    ],
    meds: [{ effective_status: "overdue" }, { effective_status: "due" }, { effective_status: "administered" }],
    alerts: [{}], escalations: [{}], concerns: [{}], tasks: [{ priority: "urgent" }, { priority: "normal" }],
  });
  check(input.pewsLatest === 6 && input.pewsPrev === 4, "assembler picks latest/prev PEWS by recency", `${input.pewsLatest}/${input.pewsPrev}`);
  check(input.medsOverdue === 1 && input.medsDueSoon === 1, "administered meds never count as time-critical");
  check(input.obsOverdue === 1 && input.obsDue === 1 && input.urgentTasks === 1 && input.isolation, "row mapping correct");
  const assembled = computeCnci(input);
  check(assembled.band === "critical" || assembled.band === "high", "deteriorating isolated patient lands high/critical", `${assembled.score} ${assembled.band}`);

  check(pewsTrend(6, 4) === "up" && pewsTrend(3, 5) === "down" && pewsTrend(4, 4) === "flat" && pewsTrend(4, null) === null, "pewsTrend directions");

  console.log("\n── reassessmentDue (S8) ──");
  let d = reassessmentDue({ latestAcuityAt: "2026-07-30T08:00:00Z", latestObsEscalatedAt: "2026-07-30T10:00:00Z", acuityLevel: "moderate" });
  check(d.due === true, "deterioration AFTER last assessment → due", d.reason ?? "");
  d = reassessmentDue({ latestAcuityAt: "2026-07-30T11:00:00Z", latestObsEscalatedAt: "2026-07-30T10:00:00Z", acuityLevel: "moderate" });
  check(d.due === false, "already reassessed after the signal → not due");
  d = reassessmentDue({ latestAcuityAt: null, latestObsEscalatedAt: null, acuityLevel: "critical" });
  check(d.due === true, "unscored critical patient → due");
  d = reassessmentDue({ latestAcuityAt: null, latestObsEscalatedAt: null, acuityLevel: "stable" });
  check(d.due === false, "unscored stable patient → not nagged");

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
