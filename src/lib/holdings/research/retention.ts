/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadResearchEngine } from "./load";

// ── RESEARCH RECORD RETENTION ── COMPETEN-RESEARCH-01 commissioning GO (28 Oct) ──────────────────────────────────────────
//
// Run by the existing background job runner (src/lib/platform/jobs.ts, research_retention, daily, recorded in
// plat_job_runs) -- not a new scheduler. It enforces the PUBLISHED retention (research.policy limits.retentionDays and each
// source's retentionDays, the shorter winning) on the research records Competen holds for convenience:
//   - the engine's public research cache (individual_scholar_research_cache rows written by the engine, provider
//     "holdings:..."): provider records and abstracts, removed once expired or past retention. Exam-paper web research
//     (570) has its own policy and is not touched.
//   - zero-cost research usage rows (plat_research_requests): operational counts, removed past retention.
//
// ⚠ PRESERVED, WHATEVER THE RETENTION SAYS:
//   - any usage row with a cost (cost_usd > 0): a FINANCIAL record of research spend;
//   - audit_log, plat_ai_requests (AI cost), plat_ai_outcomes, workspace_config_audit and versions: never touched here;
//   - a learner's own saved answers and their references: they belong to the learner and go with their material.
// ⚠ FAILS SAFE: if the configuration cannot be read, nothing is deleted.

export type RetentionResult = { ran: boolean; cache: number; usage: number; days: number; reason?: string };

const DAY = 86400000;

export async function pruneResearchRecords(admin: any, now = new Date()): Promise<RetentionResult> {
  const engine = await loadResearchEngine(admin);
  if (!engine.readable) return { ran: false, cache: 0, usage: 0, days: 0, reason: "configuration unreadable: nothing deleted" };
  const sourceDays = Object.values(engine.registry).filter(r => r.phase === 1).map(r => r.retentionDays);
  const days = Math.max(0, Math.min(engine.policy.limits.retentionDays, ...sourceDays));
  const nowIso = now.toISOString(), cutoff = new Date(now.getTime() - days * DAY).toISOString();

  const expired = await admin.from("individual_scholar_research_cache").delete({ count: "exact" }).like("provider", "holdings:%").lt("expires_at", nowIso);
  const aged = await admin.from("individual_scholar_research_cache").delete({ count: "exact" }).like("provider", "holdings:%").lt("created_at", cutoff);
  const usage = await admin.from("plat_research_requests").delete({ count: "exact" }).eq("cost_usd", 0).lt("created_at", cutoff);
  const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");
  if ((expired.error && !missing(expired.error)) || (aged.error && !missing(aged.error))) throw new Error(`research cache retention failed: ${(expired.error ?? aged.error).message}`);
  if (usage.error && !missing(usage.error)) throw new Error(`research usage retention failed: ${usage.error.message}`);
  return { ran: true, cache: (expired.count ?? 0) + (aged.count ?? 0), usage: usage.count ?? 0, days };
}
