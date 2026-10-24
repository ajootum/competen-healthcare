/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiFairUseEnabled } from "@/lib/ai/allowance";

// ── CASE INTELLIGENCE ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s11 ───────────────────────────────────────────────
//
// Counts and spend from STRUCTURED records only -- the ledger (410, 421), the candidates (423), the library (422)
// and its sessions (423). No AI analysis, ever (s11: "avoid expensive AI-based analysis when structured metadata or
// deterministic rules are sufficient").
//
// ⚠ MEASURED IS NOT ESTIMATED. Spend is what the ledger SETTLED: CAU and provider USD, per owner type, per activity,
// per session. The avoided cost is an ESTIMATE -- library sessions times the measured mean cost of generating a
// private case -- and is labelled so, with its basis, in its own field. Where nothing measured it, the answer is
// "not measured" with the reason, never a zero: metering OFF means the ledger records nothing, which is not the same
// as nothing being spent.
//
// Aggregates only. No person, no content: a count of candidates by status, never a candidate.

export type Measured = { measured: true; cau: number; usd: number; requests: number } | { measured: false; reason: string };
export type CaseIntelligence = {
  range: { from: string; to: string };
  meteringOn: boolean;
  privateCasesGenerated: { measured: true; count: number } | { measured: false; reason: string };
  candidates: Record<string, number>;
  library: { submitted: number; approved: number; published: number; superseded: number; retired: number };
  reuse: { sessionsStarted: number; sessionsCompleted: number; casesUsed: number };
  spendByOwner: { individual: Measured; platform: Measured; institution: Measured };
  spendPerPrivateGeneration: { measured: true; meanCau: number; meanUsd: number; generations: number } | { measured: false; reason: string };
  spendPerCompletedSession: { measured: true; meanCau: number; sessions: number; liveAiRequests: number } | { measured: false; reason: string };
  platformDevelopment: { activity: string; cau: number; usd: number; requests: number }[] | { measured: false; reason: string };
  estimatedAvoided: { estimated: true; cau: number; usd: number; basis: string } | { estimated: false; reason: string };
};

const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Pure: spend from settled ledger rows. Empty with metering off is not measured, not zero. */
export function measuredSpend(rows: any[], meteringOn: boolean): Measured {
  if (!meteringOn) return { measured: false, reason: "AI metering is off, so the ledger records no spend" };
  return { measured: true, cau: round(sum(rows, "settled_cau")), usd: round(sum(rows, "cost_usd"), 6), requests: rows.length };
}

/** Pure: the estimate of AI generation avoided by reusing stored cases -- sessions times the measured mean. */
export function estimateAvoided(sessions: number, perGeneration: CaseIntelligence["spendPerPrivateGeneration"]): CaseIntelligence["estimatedAvoided"] {
  if (!perGeneration.measured) return { estimated: false, reason: `No measured cost of generating a private case to estimate from (${perGeneration.reason})` };
  if (!perGeneration.generations) return { estimated: false, reason: "No private case was generated in this period, so there is no measured mean" };
  return { estimated: true, cau: round(sessions * perGeneration.meanCau), usd: round(sessions * perGeneration.meanUsd, 6),
    basis: `${sessions} library session${sessions === 1 ? "" : "s"} × the measured mean of ${perGeneration.generations} private case generation${perGeneration.generations === 1 ? "" : "s"} in the period` };
}

/** The case intelligence for a period. null = could not be read. */
export async function caseIntelligence(admin: any, range: { from: string; to: string }): Promise<CaseIntelligence | null> {
  const meteringOn = await aiFairUseEnabled(admin);
  const settled = (q: any) => q.eq("status", "settled").gte("created_at", range.from).lte("created_at", range.to);
  const [ledger, cands, versions, sessions] = await Promise.all([
    settled(admin.from("ai_usage_ledger").select("owner_type, product, activity, settled_cau, cost_usd, record_type, record_ref")).limit(50_000),
    admin.from("case_candidate").select("status").gte("offered_at", range.from).lte("offered_at", range.to).limit(50_000),
    admin.from("case_library_version").select("id, state, submitted_at, published_at, superseded_at, retired_at").limit(10_000),
    admin.from("case_library_session").select("id, version_id, status, started_at, completed_at").gte("started_at", range.from).lte("started_at", range.to).limit(50_000),
  ]);
  if (ledger.error || cands.error || versions.error || sessions.error) return null;
  const L = ledger.data ?? [], S = sessions.data ?? [];
  const inRange = (t: string | null) => !!t && t >= range.from && t <= range.to;
  const V = versions.data ?? [];
  const submitted = V.filter((v: any) => inRange(v.submitted_at));
  let approved = 0;
  for (const v of submitted) { const { data } = await admin.rpc("case_library_approved", { p_version: v.id }); if (data === true) approved++; }

  const gen = L.filter((r: any) => r.owner_type === "individual" && r.product === "scholar" && r.activity === "case_steps");
  const perGeneration: CaseIntelligence["spendPerPrivateGeneration"] = !meteringOn ? { measured: false, reason: "AI metering is off" }
    : { measured: true, generations: gen.length, meanCau: gen.length ? round(sum(gen, "settled_cau") / gen.length) : 0, meanUsd: gen.length ? round(sum(gen, "cost_usd") / gen.length, 6) : 0 };
  const completed = S.filter((s: any) => s.status === "completed");
  const live = L.filter((r: any) => r.record_type === "case_library_session" && completed.some((s: any) => s.id === r.record_ref));
  const byOwner = (t: string) => measuredSpend(L.filter((r: any) => r.owner_type === t), meteringOn);
  const platform = L.filter((r: any) => r.owner_type === "platform");
  const acts: string[] = [...new Set<string>(platform.map((r: any) => String(r.activity)))].sort();

  return {
    range, meteringOn,
    privateCasesGenerated: meteringOn ? { measured: true, count: gen.length } : { measured: false, reason: "AI metering is off, so generations are not counted by the ledger" },
    candidates: (cands.data ?? []).reduce((a: Record<string, number>, c: any) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {}),
    library: { submitted: submitted.length, approved, published: V.filter((v: any) => inRange(v.published_at)).length,
      superseded: V.filter((v: any) => inRange(v.superseded_at)).length, retired: V.filter((v: any) => inRange(v.retired_at)).length },
    reuse: { sessionsStarted: S.length, sessionsCompleted: completed.length, casesUsed: new Set(S.map((s: any) => s.version_id)).size },
    spendByOwner: { individual: byOwner("individual"), platform: byOwner("platform"), institution: byOwner("institution") },
    spendPerPrivateGeneration: perGeneration,
    spendPerCompletedSession: !meteringOn ? { measured: false, reason: "AI metering is off" }
      : { measured: true, sessions: completed.length, liveAiRequests: live.length, meanCau: completed.length ? round(sum(live, "settled_cau") / completed.length) : 0 },
    platformDevelopment: !meteringOn ? { measured: false, reason: "AI metering is off" }
      : acts.map(a => { const rs = platform.filter((r: any) => r.activity === a); return { activity: a, cau: round(sum(rs, "settled_cau")), usd: round(sum(rs, "cost_usd"), 6), requests: rs.length }; }),
    estimatedAvoided: estimateAvoided(S.length, perGeneration),
  };
}
