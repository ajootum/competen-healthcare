// ── ACCOUNT PARTICIPATION: A LABEL THAT DECIDES NO ACCESS ── HQ users directory, owner GO 2 Nov 2026 ───────────
//
// hq_account_participation (migration 850) holds one row per profile: Regular, Pilot or Staff tester, an optional
// cohort and an optional end. It is an administrative label for filtering and reporting. Nothing reads it to decide
// access, so the directory shows it beside the person's ACTUAL entitlements and never in place of them.
//
// ⚠ THE TABLE MAY BE ABSENT. Migration 850 is applied on staging first and on production only by the owner. An
// absent table or column (42P01, 42703, PGRST204, PGRST205) is "not set up here": the category filter is hidden and
// the detail section says so. It is never an error and never an empty "no category".

export const PARTICIPATION_CATEGORIES = ["regular", "pilot", "staff_tester"] as const;
export type ParticipationCategory = (typeof PARTICIPATION_CATEGORIES)[number];

export const PARTICIPATION_LABEL: Record<ParticipationCategory, string> = {
  regular: "Regular", pilot: "Pilot", staff_tester: "Staff tester",
};

export const isParticipationCategory = (v: unknown): v is ParticipationCategory =>
  typeof v === "string" && (PARTICIPATION_CATEGORIES as readonly string[]).includes(v);

export type ParticipationEntry = { category: ParticipationCategory; cohort: string | null; validUntil: string | null };
export type ParticipationMap = { available: boolean; byId: Map<string, ParticipationEntry> };

/** Postgres and PostgREST codes for "that relation or column is not there": migration 850 is not applied. */
const ABSENT_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isAbsent = (error: any): boolean => !!error && ABSENT_CODES.has(String(error.code ?? ""));

/** Every participation row, once. An absent table is `available: false`; any other failure is too (never "none"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadParticipations(admin: any): Promise<ParticipationMap> {
  const byId = new Map<string, ParticipationEntry>();
  try {
    const { data, error } = await admin.from("hq_account_participation")
      .select("user_id, category, cohort_code, valid_until").limit(100000);
    if (error) return { available: false, byId };
    for (const r of (data ?? []) as { user_id: string; category: string; cohort_code: string | null; valid_until: string | null }[]) {
      if (isParticipationCategory(r.category)) byId.set(r.user_id, { category: r.category, cohort: r.cohort_code ?? null, validUntil: r.valid_until ?? null });
    }
    return { available: true, byId };
  } catch {
    return { available: false, byId };
  }
}

// ── POST /api/super-admin/users/participation: the request, checked before any database call ───────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REASON_MAX = 600;
export const COHORT_MAX = 60;

export type ParticipationRequest = {
  userId: string; category: ParticipationCategory; reason: string; cohort: string | null; validUntil: string | null;
};

export function parseParticipationRequest(body: unknown): { ok: true; req: ParticipationRequest } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.userId !== "string" || !UUID.test(b.userId)) return { ok: false, error: "A valid person is required." };
  if (!isParticipationCategory(b.category)) return { ok: false, error: "Choose Regular, Pilot or Staff tester." };
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim() : "";
  if (!reason) return { ok: false, error: "Say why. The reason is recorded in the audit trail." };
  if (reason.length > REASON_MAX) return { ok: false, error: `The reason must be ${REASON_MAX} characters or fewer.` };
  let cohort: string | null = null;
  if (b.cohort !== undefined && b.cohort !== null && b.cohort !== "") {
    if (typeof b.cohort !== "string") return { ok: false, error: "Cohort must be text." };
    cohort = b.cohort.replace(/\s+/g, " ").trim() || null;
    if (cohort && cohort.length > COHORT_MAX) return { ok: false, error: `Cohort must be ${COHORT_MAX} characters or fewer.` };
  }
  let validUntil: string | null = null;
  if (b.validUntil !== undefined && b.validUntil !== null && b.validUntil !== "") {
    if (typeof b.validUntil !== "string" || Number.isNaN(Date.parse(b.validUntil))) return { ok: false, error: "The end date is not a date." };
    validUntil = new Date(b.validUntil).toISOString();
  }
  return { ok: true, req: { userId: b.userId, category: b.category, reason, cohort, validUntil } };
}
