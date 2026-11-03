// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- the shapes the dashboard computes and returns. Nothing here names a person: a row
// carries a pseudonym key, and the API adds `name` and `status` only for a caller who holds the identifiable right.

export type ActivityKind =
  | "upload" | "learn" | "explanation" | "flashcards" | "revise" | "case" | "osce" | "self_assessment" | "evaluate" | "plan";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  upload: "Upload", learn: "Learn session", explanation: "Saved explanation", flashcards: "Flashcard review",
  revise: "Revision session", case: "Clinical reasoning case", osce: "OSCE practice", self_assessment: "Competency self-assessment",
  evaluate: "Evaluate", plan: "My Plan",
};

export type ActivityStatus = "started" | "completed" | "abandoned";

/** One meaningful learning activity: one record, never a page view, and one per source row (a refresh writes no row). */
export type Activity = {
  userId: string;
  kind: ActivityKind;
  /** The source row id, or `<kind>:<day>` for a per-day bundle (flashcard reviews, plan edits). */
  ref: string;
  at: string;
  endedAt: string | null;
  status: ActivityStatus;
  /** Times the record shows the person came back to it (Learn resume events). */
  resumed: number;
  /** Estimated active seconds, or null where the record carries nothing to estimate from. */
  seconds: number | null;
  /** Items inside a bundle (cards reviewed), shown in the detail. */
  items: number;
};

export type AiRequest = { userId: string; at: string; operation: string; tokens: number; costUsd: number | null };
export type AiSettled = { userId: string; at: string; activity: string | null; costUsd: number | null; settled: boolean };
export type AiAllowance = { userId: string; includedCau: number; usedCau: number; periodEnd: string | null };

export type LearnerAccount = {
  userId: string;
  /** hq_account_classification.account_type, or "unclassified" */
  classification: string;
  createdAt: string;
  accountStatus: string | null;
  fullName: string | null;
};

export type DateRange = { from: string; to: string; label: string; preset: RangePreset };
export type RangePreset = "today" | "7d" | "30d" | "90d" | "custom";

export type SummaryCards = {
  learners: number;
  unclassifiedIncluded: number;
  dau: number;
  wau: number;
  mau: number;
  newLearners: number;
  returningLearners: number;
  activeInRange: number;
  activities: number;
  aiCostUsd: number;
  aiSettledUsd: number;
  aiCostPerActiveLearner: number | null;
  aiRequests: number;
};

export type LearnerRow = {
  key: string;
  label: string;
  /** Named View only. */
  name?: string;
  status?: string | null;
  classification?: string;
  activeDays: number;
  sessions: number;
  activeMinutes: number | null;
  activities: number;
  completed: number;
  aiRequests: number;
  aiCostUsd: number;
  aiSettledUsd: number;
  lastActive: string | null;
};

export type KindBreakdown = { kind: ActivityKind; label: string; started: number; completed: number; abandoned: number; resumed: number; items: number };
export type WeekPoint = { week: string; activities: number; activeDays: number; aiCostUsd: number };

export type LearnerDetail = {
  row: LearnerRow;
  kinds: KindBreakdown[];
  weeks: WeekPoint[];
  ai: { requests: number; tokens: number; costUsd: number; settledUsd: number; byOperation: { operation: string; requests: number; costUsd: number }[]; allowance: { includedCau: number; usedCau: number; periodEnd: string | null } | null };
  progress: { selfAssessmentsSubmitted: number; osceCompleted: number; casesCompleted: number; revisionCompleted: number; learnCompleted: number };
  recent: { at: string; kind: ActivityKind; label: string; status: ActivityStatus; items: number }[];
};

export type SortKey = "activities" | "activeDays" | "sessions" | "activeMinutes" | "aiRequests" | "aiCostUsd" | "lastActive";

export type DashboardResponse = {
  range: DateRange;
  named: boolean;
  canIdentify: boolean;
  include: string[];
  method: { activeTime: string; days: string; aiCost: string; classification: string };
  cards: SummaryCards;
  costByActivity: { operation: string; requests: number; costUsd: number }[];
  kinds: KindBreakdown[];
  leaderboard: { rows: LearnerRow[]; page: number; pageSize: number; total: number; sort: SortKey; q: string };
  detail: LearnerDetail | null;
  limits: string[];
};
