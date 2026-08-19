/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Environment and service health — CPR-PD-014 §7.2 A.
 *
 * !! UNKNOWN IS PREFERRED TO A FABRICATED GREEN, and §7.2 says so outright. That single rule decides
 * almost every line below, because most "service health" dashboards are configuration checks wearing a
 * status light: they read an environment variable, find it set, and draw OPERATIONAL. That answers
 * "is it configured", which is a different question from "does it work", and the two diverge exactly
 * when it matters.
 *
 * So a service here is OPERATIONAL only when something was actually exercised in this request. Where
 * only configuration can be seen, the status is UNKNOWN and the check source says why.
 */

export type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "DOWN" | "UNKNOWN";

export type ServiceHealth = {
  name: string;
  status: ServiceStatus;
  /** §7.2: "Every status shows last verified time and check source." */
  checkedAt: string;
  /** What was actually done to reach this verdict. Never "n/a". */
  source: string;
};

const now = () => new Date().toISOString();

export async function loadServiceHealth(admin: any): Promise<ServiceHealth[]> {
  const services: ServiceHealth[] = [];

  // ── Database and PostgREST: genuinely exercised ────────────────────────────────────────────────
  //
  // A trivial read against a table this plane already reads. If it answers, the database is up, the
  // API layer is up, and the service-role credential is valid — three facts for one round trip.
  const t0 = Date.now();
  const { error: dbErr } = await admin.from("practice_platform_flags").select("flag").limit(1);
  const ms = Date.now() - t0;
  services.push({
    name: "Database & Practice API",
    status: dbErr ? "DOWN" : ms > 2000 ? "DEGRADED" : "OPERATIONAL",
    checkedAt: now(),
    source: dbErr
      ? `a read of the launch-flag table failed: ${dbErr.message.slice(0, 60)}`
      : `a read of the launch-flag table returned in ${ms}ms`,
  });

  // ── Storage: exercised ─────────────────────────────────────────────────────────────────────────
  try {
    const { error: sErr } = await admin.storage.listBuckets();
    services.push({
      name: "Storage",
      status: sErr ? "DOWN" : "OPERATIONAL",
      checkedAt: now(),
      source: sErr ? `listing buckets failed: ${sErr.message.slice(0, 60)}` : "the bucket list was retrieved",
    });
  } catch (e) {
    services.push({
      name: "Storage", status: "DOWN", checkedAt: now(),
      source: `listing buckets threw: ${String(e).slice(0, 60)}`,
    });
  }

  // ── Provisioning: inferred from its own ledger, and labelled as such ───────────────────────────
  //
  // Not a probe — running a provisioning saga to see whether provisioning works would create a
  // practice. What CAN be said is whether recent runs succeeded, which is evidence about the service
  // rather than a synthetic check, and the source sentence says exactly that.
  const { data: recent, error: rErr } = await admin
    .from("provisioning_request").select("status, updated_at")
    .order("updated_at", { ascending: false }).limit(10);
  if (rErr) {
    services.push({
      name: "Provisioning service", status: "UNKNOWN", checkedAt: now(),
      source: `the request ledger could not be read: ${rErr.message.slice(0, 50)}`,
    });
  } else {
    const rows = (recent ?? []) as any[];
    const failed = rows.filter(r => String(r.status).toUpperCase() === "FAILED").length;
    services.push({
      name: "Provisioning service",
      // A failure among the last ten is a real signal of degradation; none is not proof of health,
      // which is why the source sentence is careful about what it claims.
      status: rows.length === 0 ? "UNKNOWN" : failed > 0 ? "DEGRADED" : "OPERATIONAL",
      checkedAt: now(),
      source: rows.length === 0
        ? "no provisioning run has ever been recorded, so there is nothing to judge"
        : `${failed} of the last ${rows.length} recorded runs are FAILED. Inferred from the ledger, not a synthetic run.`,
    });
  }

  /**
   * ── The rest: configuration is visible, health is not ──────────────────────────────────────────
   *
   * !! THESE ARE THE ONES A DASHBOARD USUALLY LIES ABOUT. An API key being present in the environment
   * says a deployment intends to send email; it says nothing about whether the provider would accept
   * the next message. Sending a real probe message on every page load is not acceptable either, so the
   * honest answer is UNKNOWN with the configuration stated as what it is.
   */
  const configured = (label: string, present: boolean, provider: string): ServiceHealth => ({
    name: label,
    status: "UNKNOWN",
    checkedAt: now(),
    source: present
      ? `${provider} credentials are configured. No delivery probe is run, so this is configuration, not health.`
      : `no ${provider} credentials are configured, so nothing can be sent. Not a failure of the service.`,
  });

  services.push(configured("Email delivery", !!process.env.RESEND_API_KEY, "Resend"));
  services.push(configured("SMS delivery",
    !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), "Twilio"));

  // ── Authentication: deliberately not claimed ──────────────────────────────────────────────────
  //
  // The caller reached this page THROUGH authentication, which proves the auth service served at least
  // one request. That is worth stating and is not the same as a health check, so it is UNKNOWN with the
  // reasoning visible rather than OPERATIONAL on the strength of a single successful sign-in.
  services.push({
    name: "Authentication",
    status: "UNKNOWN",
    checkedAt: now(),
    source: "this page was reached through an authenticated session, which is evidence but not a probe. "
      + "No independent auth health check exists.",
  });

  // ── Background jobs: no substrate ─────────────────────────────────────────────────────────────
  services.push({
    name: "Background jobs",
    status: "UNKNOWN",
    checkedAt: now(),
    source: "no job-run ledger is readable from this plane, so neither health nor failure can be shown.",
  });

  return services;
}
