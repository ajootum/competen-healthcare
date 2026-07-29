/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-010 — Testing & Sandbox (release readiness). Rather than a new store, this COMPOSES the checks the
// Studio already computes: content completeness (CST-107 loadContentQa), prerequisite cycles (CST-105
// loadDependencies) and traceability coverage (CST-104 loadMappingStudio). It produces a single
// "ready to publish?" verdict per framework with the blocking checks named — a pre-publication gate.
// A full persona-driven workflow sandbox (simulating worker/assessor journeys) is the next-phase layer.

import { loadContentQa } from "./content-qa";
import { loadDependencies } from "./dependencies";
import { loadMappingStudio } from "./mapping";

export type Check = { label: string; value: string; status: "pass" | "warn" | "fail" };
export type FwReadiness = { id: string; name: string; competencies: number; checks: Check[]; verdict: "ready" | "needs_work" | "blocked"; blockers: string[] };

export async function loadReleaseReadiness(admin: any, hid: string | null, isSuper: boolean) {
  const [qa, dep, map] = await Promise.all([
    loadContentQa(admin, hid, isSuper),
    loadDependencies(admin, hid, isSuper),
    loadMappingStudio(admin, hid, isSuper),
  ]);
  if (!qa.provisioned) return { provisioned: false as const };

  const covByFw = new Map<string, Record<string, number>>((map.provisioned ? map.matrix : []).map(m => [m.id, m.cells] as [string, Record<string, number>]));
  const qaFrameworks = qa.empty ? [] : qa.frameworks;

  const frameworks: FwReadiness[] = qaFrameworks.map(f => {
    const cells = covByFw.get(f.id) ?? {};
    const assess = cells.assessment ?? 0;
    const evi = cells.evidence ?? 0;
    const structural = !f.flags.includes("no domains") && f.competencies > 0;
    const checks: Check[] = [
      { label: "Content completeness", value: `${f.pct}%`, status: f.pct >= 75 ? "pass" : f.pct >= 50 ? "warn" : "fail" },
      { label: "Assessment coverage", value: `${assess}%`, status: assess >= 80 ? "pass" : assess >= 50 ? "warn" : "fail" },
      { label: "Evidence coverage", value: `${evi}%`, status: evi >= 50 ? "pass" : evi > 0 ? "warn" : "fail" },
      { label: "Structure", value: structural ? "OK" : "Incomplete", status: structural ? "pass" : "fail" },
      { label: "Review currency", value: f.flags.includes("review overdue") ? "Overdue" : "Current", status: f.flags.includes("review overdue") ? "warn" : "pass" },
    ];
    const fails = checks.filter(c => c.status === "fail");
    const warns = checks.filter(c => c.status === "warn");
    const verdict = fails.length > 0 ? "blocked" : warns.length > 0 ? "needs_work" : "ready";
    return { id: f.id, name: f.name, competencies: f.competencies, checks, verdict, blockers: fails.map(c => c.label) };
  });

  const cycles = dep.provisioned ? dep.cycles : [];
  const kpis = {
    frameworks: frameworks.length,
    ready: frameworks.filter(f => f.verdict === "ready").length,
    needsWork: frameworks.filter(f => f.verdict === "needs_work").length,
    blocked: frameworks.filter(f => f.verdict === "blocked").length,
    cycles: cycles.length,
    highIssues: qa.empty ? 0 : qa.kpis.high,
  };
  return { provisioned: true as const, empty: qa.empty, kpis, frameworks, cycles };
}
