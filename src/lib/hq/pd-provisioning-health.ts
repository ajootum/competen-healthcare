/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Provisioning health — CPR-PD-014 §4.
 *
 * Additive to loadPdOperations() rather than folded into it. That loader already answers "what is the
 * saga doing"; §4 asks a different product question — "are new practices being provisioned
 * successfully, and are provisioned practices progressing to operational use" — and the second half of
 * that sentence is about ONBOARDING, which the saga knows nothing about.
 *
 * !! EVERY NUMBER HERE IS NULLABLE, AND NULL IS NOT ZERO. §10: "Unavailable values: say 'Not yet
 * measured' or 'Unavailable'; never render 0." A duration with too few samples, a read that failed, a
 * projection that is not yet applied — each returns null and the screen says so. This is the same
 * discipline the existing loader already applies to `estate.total`.
 */

/** §8.1's projection, exactly. Nothing here can carry practitioner-entered content. */
export type OnboardingRow = {
  practiceId: string;
  practiceName: string | null;
  stage: string | null;
  stepsTotal: number | null;
  stepsCompleted: number | null;
  startedAt: string | null;
  lastProgressAt: string | null;
  completedAt: string | null;
  stalledReasonCode: string | null;
};

export type ProvisioningHealth = {
  /** Thresholds as configuration (§4.5), not constants in a component. Null when the table is absent. */
  stallHours: number | null;
  activationWindowHours: number | null;

  counts: {
    /** COMPLETED runs. Null when the read failed — which is not "none succeeded". */
    successful: number | null;
    /** Neither COMPLETED, FAILED nor EXPIRED. */
    inProgress: number | null;
    failed: number | null;
  };

  /**
   * !! p50/p95 ARE NULL UNTIL THERE IS ENOUGH REAL DATA, and that is a product requirement rather than
   * caution. §4.2: "Until implemented show 'Not yet measured', never 0." A p95 computed from two
   * samples is a number with the shape of a measurement and none of its meaning.
   */
  duration: {
    p50Seconds: number | null;
    p95Seconds: number | null;
    sampleSize: number;
    /** Why a duration is null, when it is. Rendered as the reason rather than left blank. */
    unavailableReason: string | null;
  };

  /** Age in hours of the oldest run that has not finished. Null when none are open. */
  oldestOpenHours: number | null;

  onboarding: OnboardingRow[];
  /** True when the §8.1 projection is not present on this database. The screen must say so. */
  onboardingUnavailable: boolean;
  onboardingUnavailableReason: string | null;
};

/** The smallest sample that makes a p95 mean anything. Below this the screen says "not yet measured". */
const MIN_SAMPLES_FOR_PERCENTILES = 5;

function percentile(sortedSeconds: number[], p: number): number {
  // Nearest-rank. With a small n this is honest in a way linear interpolation is not: it returns a
  // duration that a real run actually took, rather than one that no run took.
  const rank = Math.ceil((p / 100) * sortedSeconds.length);
  return sortedSeconds[Math.min(Math.max(rank, 1), sortedSeconds.length) - 1];
}

export async function loadProvisioningHealth(admin: any): Promise<ProvisioningHealth> {
  // ── Thresholds ────────────────────────────────────────────────────────────────────────────────
  let stallHours: number | null = null;
  let activationWindowHours: number | null = null;
  {
    const { data } = await admin.from("pd_ops_config").select("config_key, value_hours");
    for (const r of ((data ?? []) as any[])) {
      if (r.config_key === "onboarding_stall_hours") stallHours = r.value_hours;
      if (r.config_key === "activation_window_hours") activationWindowHours = r.value_hours;
    }
  }

  // ── Provisioning runs ─────────────────────────────────────────────────────────────────────────
  const { data: reqRows, error: reqErr } = await admin
    .from("provisioning_request")
    .select("id, status, created_at, updated_at");
  const requests = (reqRows ?? []) as any[];
  const readFailed = !!reqErr;

  const isDone = (s: string) => s === "COMPLETED";
  const isFinished = (s: string) => ["COMPLETED", "FAILED", "EXPIRED", "CANCELLED"].includes(s);

  const counts = readFailed
    ? { successful: null, inProgress: null, failed: null }
    : {
      successful: requests.filter(r => isDone(String(r.status).toUpperCase())).length,
      inProgress: requests.filter(r => !isFinished(String(r.status).toUpperCase())).length,
      failed: requests.filter(r => String(r.status).toUpperCase() === "FAILED").length,
    };

  // ── Duration ──────────────────────────────────────────────────────────────────────────────────
  //
  // !! MEASURED ONLY ON COMPLETED RUNS. A failed run's elapsed time is the time until it broke, which
  // is not "how long provisioning takes" and would drag the percentiles toward a number describing
  // nothing. created_at → updated_at is the only pair the substrate offers.
  const durations = readFailed ? [] : requests
    .filter(r => isDone(String(r.status).toUpperCase()) && r.created_at && r.updated_at)
    .map(r => (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 1000)
    .filter(s => s >= 0)
    .sort((a, b) => a - b);

  const enough = durations.length >= MIN_SAMPLES_FOR_PERCENTILES;
  const duration = {
    p50Seconds: enough ? Math.round(percentile(durations, 50)) : null,
    p95Seconds: enough ? Math.round(percentile(durations, 95)) : null,
    sampleSize: durations.length,
    unavailableReason: readFailed
      ? "the provisioning request table could not be read"
      : enough
        ? null
        : `only ${durations.length} completed run${durations.length === 1 ? "" : "s"} recorded; `
          + `${MIN_SAMPLES_FOR_PERCENTILES} are needed before a percentile means anything`,
  };

  // ── Oldest open run ───────────────────────────────────────────────────────────────────────────
  const openAges = readFailed ? [] : requests
    .filter(r => !isFinished(String(r.status).toUpperCase()) && r.created_at)
    .map(r => (Date.now() - new Date(r.created_at).getTime()) / 3_600_000);
  const oldestOpenHours = openAges.length ? Math.max(...openAges) : null;

  // ── Onboarding projection (§8.1) ──────────────────────────────────────────────────────────────
  //
  // !! A MISSING PROJECTION IS REPORTED, NOT SWALLOWED. §4.2 requires the stage counts to be labelled
  // unavailable until this exists, and §13 forbids inferring missing substrate. PostgREST answers a
  // missing function with an error, so the absence is detectable rather than silently empty — the
  // head+count trap this repo has hit before does not apply to an rpc call.
  let onboarding: OnboardingRow[] = [];
  let onboardingUnavailable = false;
  let onboardingUnavailableReason: string | null = null;

  const { data: projRows, error: projErr } = await admin.rpc("plat_practice_onboarding_projection");
  if (projErr) {
    onboardingUnavailable = true;
    // ⚠ NO MIGRATION NUMBER IN THIS SENTENCE. It is rendered to an operator, and
    // CPR-PD-SCREEN-DOCTRINE counts an implementation identifier in visible loader text against a
    // ratchet pointing downward. The substrate is migration 339; a developer finds that here, in a
    // comment, rather than in the message an operator reads.
    onboardingUnavailableReason = /could not find the function/i.test(projErr.message)
      ? "the onboarding projection is not present on this database"
      : `the onboarding projection could not be read: ${projErr.message.slice(0, 80)}`;
  } else {
    const rows = (projRows ?? []) as any[];
    // Practice NAME only. §4.3 permits an operational identity and forbids a standing email column, so
    // this join takes the name and nothing else.
    const ids = rows.map(r => r.practice_id).filter(Boolean);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ws } = await admin.from("practice_workspace").select("id, name").in("id", ids);
      for (const w of ((ws ?? []) as any[])) names.set(w.id, w.name);
    }
    onboarding = rows.map(r => ({
      practiceId: r.practice_id,
      practiceName: names.get(r.practice_id) ?? null,
      stage: r.stage ?? null,
      stepsTotal: r.steps_total ?? null,
      stepsCompleted: r.steps_completed ?? null,
      startedAt: r.started_at ?? null,
      lastProgressAt: r.last_progress_at ?? null,
      completedAt: r.completed_at ?? null,
      stalledReasonCode: r.stalled_reason_code ?? null,
    }));
  }

  return {
    stallHours, activationWindowHours, counts, duration, oldestOpenHours,
    onboarding, onboardingUnavailable, onboardingUnavailableReason,
  };
}

/**
 * §4.3 default sort: needs attention first, then oldest last-progress timestamp.
 * Exported so the ordering is testable without rendering a page.
 */
export function sortOnboarding(rows: OnboardingRow[]): OnboardingRow[] {
  const attention = (r: OnboardingRow) => (r.stalledReasonCode ? 0 : r.completedAt ? 2 : 1);
  return [...rows].sort((a, b) =>
    attention(a) - attention(b)
    || new Date(a.lastProgressAt ?? 0).getTime() - new Date(b.lastProgressAt ?? 0).getTime());
}
