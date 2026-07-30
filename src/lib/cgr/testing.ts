/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-017 — Competency Governance Simulation, Testing & Validation.
// "What will happen if we change this governance rule/workflow/policy before we release it?" The real validation
// backbone (deep authoring stays in Studio Release Readiness — cross-linked):
//   • configuration_test_suites (mig 097) — the governance/config validation suites: cases[], last_run
//     {passed,failed,total,gate}, status (draft/passing/failing).
//   • configuration_test_runs (mig 097) — the run history: per-run passed/failed/total + gate (pass/blocked).
// From them: release-readiness gate (§10, % suites passing), suite health, run history + pass rate (§14 testing
// completion / release success). Change-impact simulation (§5.3) is the frameworkImpact engine built for CGR-004,
// cross-linked. Validation framework (§8) + simulation lifecycle (§6) render as labelled reference. No migration.

type Admin = any;
const DAY = 86400000;
const STATUS_RANK: Record<string, number> = { failing: 0, draft: 1, passing: 2 };

export async function loadGovernanceTesting(admin: Admin) {
  const [suiteRes, runRes] = await Promise.all([
    admin.from("configuration_test_suites").select("suite_key, name, cases, last_run, status").limit(500),
    admin.from("configuration_test_runs").select("suite_key, passed, failed, total, gate, run_by_name, created_at").order("created_at", { ascending: false }).limit(300),
  ]);

  const suites = (suiteRes.error ? [] : suiteRes.data ?? []) as any[];
  const runs = (runRes.error ? [] : runRes.data ?? []) as any[];
  const now = Date.now();

  const suiteList = suites
    .map((s) => {
      const lr = s.last_run ?? null;
      return {
        key: s.suite_key,
        name: s.name,
        cases: Array.isArray(s.cases) ? s.cases.length : 0,
        status: s.status ?? "draft",
        lastPassed: lr?.passed ?? null,
        lastFailed: lr?.failed ?? null,
        lastTotal: lr?.total ?? null,
        gate: lr?.gate ?? null,
        at: lr?.at ?? null,
      };
    })
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.name.localeCompare(b.name));

  const passing = suites.filter((s) => s.status === "passing").length;
  const failing = suites.filter((s) => s.status === "failing").length;
  const draft = suites.filter((s) => s.status === "draft").length;
  const totalCases = suiteList.reduce((t, s) => t + s.cases, 0);
  const releaseReady = suites.length ? Math.round((passing / suites.length) * 100) : null;

  const runList = runs.slice(0, 12).map((r) => ({ suite: r.suite_key, passed: r.passed ?? 0, failed: r.failed ?? 0, total: r.total ?? 0, gate: r.gate ?? "blocked", by: r.run_by_name ?? "—", at: r.created_at }));
  const passRuns = runs.filter((r) => r.gate === "pass").length;
  const passRate = runs.length ? Math.round((passRuns / runs.length) * 100) : null;
  const last30Runs = runs.filter((r) => now - new Date(r.created_at).getTime() <= 30 * DAY).length;

  return {
    provisioned: suites.length > 0 || runs.length > 0,
    kpis: {
      suites: suites.length,
      passing,
      failing,
      draft,
      totalCases,
      releaseReady,
      totalRuns: runs.length,
      passRate,
      last30Runs,
    },
    suiteList,
    runList,
  };
}
