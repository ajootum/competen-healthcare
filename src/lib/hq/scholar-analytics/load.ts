/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- the reads. Every select names its columns, and every table read here has an
// allowlist entry in src/lib/access/plane-boundary.ts restricted to this folder (onlyFrom), so the harness refuses a
// widened select or a read from anywhere else on the landlord plane. NOTHING here reads learner content: no note, no
// material text, no AI conversation, no answers, no case narrative. Ids, timestamps, statuses, counts and the AI
// gateway's own figures only. Names come from profiles and leave this module only through the API's identity rule.
import type { AiAllowance, AiRequest, AiSettled, LearnerAccount } from "./types";
import type { RawRows } from "./metrics";

export const BASE_INCLUDE = ["human", "unclassified"] as const;
export const TESTING_INCLUDE = ["demo", "test", "system"] as const;
/** Activity before the range is read back this far, for the returning-learner figure and the weekly trend. */
export const LOOKBACK_DAYS = 180;

export type LoadResult = {
  learners: LearnerAccount[];
  raw: RawRows;
  ai: AiRequest[];
  settled: AiSettled[];
  allowances: AiAllowance[];
  salt: string | null;
  limits: string[];
};

const isMissing = (e: any) => e && (String(e.code) === "42P01" || String(e.code) === "42703" || /does not exist|schema cache/i.test(String(e.message ?? "")));

export async function loadDashboardRows(admin: any, opts: { from: string; to: string; include: readonly string[]; now: Date }): Promise<LoadResult> {
  const limits: string[] = [];
  const since = new Date(new Date(opts.from).getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // 1. who holds Scholar now, on the database clock
  const live = await admin.from("individual_live_entitlement").select("user_id, experience_code").eq("experience_code", "scholar");
  if (live.error) return { learners: [], raw: emptyRaw(), ai: [], settled: [], allowances: [], salt: null, limits: ["Live Scholar access could not be read."] };
  const liveIds = [...new Set(((live.data ?? []) as { user_id: string }[]).map(r => r.user_id))];

  // 2. the administrative classification, and the people
  const [cls, people, cfg] = await Promise.all([
    liveIds.length ? admin.from("hq_account_classification").select("profile_id, account_type").in("profile_id", liveIds) : { data: [], error: null },
    liveIds.length ? admin.from("profiles").select("id, full_name, created_at, account_status").in("id", liveIds) : { data: [], error: null },
    admin.from("hq_config").select("analytics_pseudonym_salt").limit(1).maybeSingle(),
  ]);
  const salt: string | null = cfg.error || !cfg.data?.analytics_pseudonym_salt ? null : String(cfg.data.analytics_pseudonym_salt);
  if (!salt) limits.push("The pseudonym salt is not set up on this environment (migration 910), so the dashboard cannot be shown.");
  const classOf = new Map<string, string>(((cls.error ? [] : cls.data ?? []) as any[]).map(r => [r.profile_id, String(r.account_type ?? "unclassified")]));
  if (cls.error) limits.push("Account classifications could not be read: every learner is treated as unclassified.");
  const learners: LearnerAccount[] = ((people.error ? [] : people.data ?? []) as any[])
    .map(p => ({ userId: p.id as string, classification: classOf.get(p.id) ?? "unclassified", createdAt: p.created_at as string, accountStatus: (p.account_status ?? null) as string | null, fullName: (p.full_name ?? null) as string | null }))
    .filter(l => opts.include.includes(l.classification));
  const ids = learners.map(l => l.userId);
  if (!ids.length) return { learners, raw: emptyRaw(), ai: [], settled: [], allowances: [], salt, limits };

  // 3. the activity records, narrowly
  const q = async (name: string, chain: any): Promise<any[]> => {
    const r = await chain;
    if (r.error) { limits.push(isMissing(r.error) ? `${name}: not present on this environment.` : `${name}: could not be read.`); return []; }
    return r.data ?? [];
  };
  const [materials, learnSessions, learnEvents, artefacts, reviews, revisionSessions, caseSessions, osceAttempts, selfAssessments, evaluations, plans, calendar, aiRows, ledger, allowance] = await Promise.all([
    q("Uploads", admin.from("individual_scholar_material").select("id, user_id, created_at").in("user_id", ids).gte("created_at", since)),
    q("Learn sessions", admin.from("individual_scholar_learning_session").select("id, user_id, created_at, last_active_at, status").in("user_id", ids).gte("created_at", since)),
    q("Learn steps", admin.from("individual_scholar_learning_event").select("session_id, user_id, action, created_at").in("user_id", ids).gte("created_at", since)),
    q("Saved explanations", admin.from("individual_scholar_artefact").select("id, user_id, created_at, action, superseded_at").in("user_id", ids).gte("created_at", since)),
    q("Flashcard reviews", admin.from("individual_scholar_review").select("user_id, reviewed_at").in("user_id", ids).gte("reviewed_at", since)),
    q("Revision sessions", admin.from("individual_scholar_revision_session").select("id, user_id, created_at, last_active_at, completed_at, status").in("user_id", ids).gte("created_at", since)),
    q("Clinical cases", admin.from("individual_scholar_case_session").select("id, user_id, created_at, last_active_at, completed_at, status").in("user_id", ids).gte("created_at", since)),
    q("OSCE attempts", admin.from("individual_scholar_osce_attempt").select("id, user_id, started_at, finished_at, duration_seconds, created_at").in("user_id", ids).gte("created_at", since)),
    q("Self-assessments", admin.from("asmt_instance").select("id, respondent_id, subject_user_id, started_at, submitted_at, status").in("subject_user_id", ids).gte("started_at", since)),
    q("Evaluations", admin.from("individual_scholar_evaluation").select("id, user_id, created_at").in("user_id", ids).gte("created_at", since)),
    q("Study plans", admin.from("individual_scholar_study_plan").select("user_id, updated_at").in("user_id", ids).gte("updated_at", since)),
    q("Plan calendar", admin.from("individual_scholar_calendar_entry").select("user_id, created_at").in("user_id", ids).gte("created_at", since)),
    q("AI requests", admin.from("plat_ai_requests").select("actor_id, operation, input_tokens, output_tokens, cost_usd, created_at, status").in("actor_id", ids).gte("created_at", since)),
    q("AI metering ledger", admin.from("ai_usage_ledger").select("user_id, activity, cost_usd, status, created_at").in("user_id", ids).gte("created_at", since)),
    q("AI allowance", admin.from("ai_allowance_account").select("user_id, product, included_cau, used_cau, period_end").in("user_id", ids).eq("product", "scholar")),
  ]);

  const raw: RawRows = {
    materials, learnSessions, learnEvents, artefacts, reviews, revisionSessions, caseSessions, osceAttempts, selfAssessments, evaluations,
    planEdits: [
      ...plans.map((p: any) => ({ user_id: p.user_id as string, at: p.updated_at as string })),
      ...calendar.map((c: any) => ({ user_id: c.user_id as string, at: c.created_at as string })),
    ],
  };
  const ai: AiRequest[] = aiRows.filter((r: any) => r.actor_id && (r.status == null || r.status === "ok"))
    .map((r: any) => ({ userId: r.actor_id as string, at: r.created_at as string, operation: String(r.operation ?? "unknown"), tokens: Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0), costUsd: r.cost_usd == null ? null : Number(r.cost_usd) }));
  const settled: AiSettled[] = ledger.map((r: any) => ({ userId: r.user_id as string, at: r.created_at as string, activity: (r.activity ?? null) as string | null, costUsd: r.cost_usd == null ? null : Number(r.cost_usd), settled: r.status === "settled" }));
  if (!ledger.length) limits.push("The fair-use metering ledger holds no settled Scholar costs yet: AI expenditure shown is the gateway's estimate.");
  const nowIso = opts.now.toISOString();
  const allowances: AiAllowance[] = allowance.filter((a: any) => !a.period_end || a.period_end >= nowIso)
    .map((a: any) => ({ userId: a.user_id as string, includedCau: Number(a.included_cau ?? 0), usedCau: Number(a.used_cau ?? 0), periodEnd: (a.period_end ?? null) as string | null }));
  return { learners, raw, ai, settled, allowances, salt, limits };
}

const emptyRaw = (): RawRows => ({ materials: [], learnSessions: [], learnEvents: [], artefacts: [], reviews: [], revisionSessions: [], caseSessions: [], osceAttempts: [], selfAssessments: [], evaluations: [], planEdits: [] });
