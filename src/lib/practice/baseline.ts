import { resolveWorkspaceContext } from "@/lib/practice/access";
import { messagingStatus } from "@/lib/practice/messaging";
import { audit } from "@/lib/practice/audit";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PROV-DEFAULTS-001 -- COMPETEN STANDARD PRACTICE V1, the one canonical baseline.
//
// A fresh practice should spend its owner's time only on what is genuinely theirs: identity, places,
// the regular week, review, publish. Everything universal and safe is either INHERITED (the engine
// already behaves that way when nothing is configured) or MATERIALISED here, once, at provisioning.
//
// ---- THE THREE RULES THIS FILE LIVES BY ------------------------------------------------------------
//
//   1. MATERIALISE ONLY INTO EMPTINESS. Every seed below checks for existing configuration first and
//      skips. That is what makes retries converge (s10) and what makes established practices
//      structurally untouchable (s12): a practice with any configuration has nothing empty to seed.
//   2. CANONICAL SERVICES, REAL CONTEXT. The seed resolves the owner's actual WorkspaceContext and
//      writes through saveBookingRule / createTemplate / publishTemplate / setChannel -- so every
//      seeded record is capability-checked, versioned and audited exactly as a human's would be, and
//      no engine is written around.
//   3. NOTHING HERE PUBLISHES, FABRICATES OR GRANTS. No booking page is created, no location, session
//      or slot is invented, no privileged access is widened, and a deployment with no email provider
//      gets no email channel row -- readiness is never fabricated (s3).
//
// The version string is immutable: a changed baseline is a NEW version (CP_STANDARD_V2), and an
// existing practice keeps the version it was provisioned on (s9). The recorded version lives in
// practice_configuration.feature_flags.baseline_version, written only when absent.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CP_BASELINE_VERSION = "CP_STANDARD_V1";

/** The starter rule's name. It is the practitioner-visible face of "Using Competen default". */
export const BASELINE_RULE_NAME = "Competen standard booking";

/**
 * The V1 matrix, as data: what each area defaults to and WHERE that default is enforced. The UI may
 * render these; nothing but this file may define them (s2). "inherited" areas have no seeded record
 * at all -- the enforcement point behaves this way when a practice configures nothing.
 */
export const CP_STANDARD_V1 = {
  version: CP_BASELINE_VERSION,
  areas: [
    { key: "appointment_types", value: "Starter visit types and modes", enforcement: "materialised", where: "seedTaxonomy (provisioning)" },
    { key: "booking_horizon_days", value: 120, enforcement: "materialised", where: "the starter booking rule" },
    { key: "booking_cutoff_minutes", value: 30, enforcement: "materialised", where: "the starter booking rule" },
    { key: "confirmation", value: "immediate", enforcement: "materialised", where: "the starter booking rule" },
    { key: "patient_cancellation", value: "allowed, no notice period", enforcement: "materialised", where: "the starter booking rule" },
    { key: "overbooking", value: 0, enforcement: "materialised", where: "the starter booking rule" },
    { key: "walk_ins", value: "off until a clinic turns them on", enforcement: "inherited", where: "session booking defaults" },
    { key: "self_booking_required_fields", value: "first name, family name, email", enforcement: "materialised", where: "the starter booking rule's required information" },
    { key: "optional_booking_fields", value: "date of birth, phone, reason for visit", enforcement: "inherited", where: "intake levels default to optional" },
    { key: "guardian_logic", value: "guardian asked for when the patient is a minor", enforcement: "inherited", where: "the canonical intake condition machinery" },
    { key: "registration_form", value: "published starter template with the core fields", enforcement: "materialised", where: "createTemplate + publishTemplate" },
    { key: "email_channel", value: "on, sender named after the practice, where a provider is operational", enforcement: "materialised", where: "setChannel" },
    { key: "email_verification", value: "required for public self-booking", enforcement: "inherited", where: "otp_required database default" },
    { key: "sms_whatsapp", value: "not provisioned, never warned about", enforcement: "inherited", where: "absence" },
    { key: "public_booking_page", value: "not created, not published", enforcement: "inherited", where: "publishing stays the practitioner's deliberate act" },
    { key: "security_audit", value: "platform baselines", enforcement: "inherited", where: "security policy defaults / audit always on" },
  ],
} as const;

export type BaselineSeedOutcome = {
  ok: boolean;
  detail?: string;
  seeded: { version: boolean; rule: boolean; registration: boolean; email: boolean };
  skipped: string[];
};

/**
 * Materialise CP_STANDARD_V1 into a freshly provisioned workspace. Idempotent, non-destructive, and
 * safe to re-run: every part seeds only where nothing exists yet.
 */
export async function seedBaselineDefaults(
  admin: any, workspaceId: string, ownerId: string, correlationId: string,
): Promise<BaselineSeedOutcome> {
  const seeded = { version: false, rule: false, registration: false, email: false };
  const skipped: string[] = [];

  try {
    // The REAL owner context -- provisioning has already created the membership and capabilities, and
    // resolveWorkspaceContext admits a PROVISIONING/ONBOARDING workspace. Everything below is then
    // authorised the same way a signed-in owner would be.
    const resolved = await resolveWorkspaceContext(admin, ownerId, workspaceId);
    if (!resolved.ok) {
      return { ok: false, detail: `owner context could not be resolved: ${resolved.reason}`, seeded, skipped };
    }
    const ctx = resolved.ctx;

    // ── 1. PROVENANCE (s2): record the baseline version, never overwriting one already recorded (s9).
    const { data: cfg, error: cfgErr } = await admin.from("practice_configuration")
      .select("id, feature_flags").eq("workspace_id", workspaceId).eq("is_effective", true).maybeSingle();
    if (cfgErr || !cfg) {
      return { ok: false, detail: `configuration could not be read: ${cfgErr?.message ?? "no effective row"}`, seeded, skipped };
    }
    const flags = (cfg.feature_flags ?? {}) as Record<string, unknown>;
    if (typeof flags.baseline_version === "string" && flags.baseline_version) {
      skipped.push(`version (already ${flags.baseline_version})`);
    } else {
      const { error } = await admin.from("practice_configuration")
        .update({ feature_flags: { ...flags, baseline_version: CP_BASELINE_VERSION } })
        .eq("id", cfg.id).eq("workspace_id", workspaceId);
      if (error) return { ok: false, detail: `baseline version could not be recorded: ${error.message}`, seeded, skipped };
      seeded.version = true;
    }

    // ── 2. THE STARTER BOOKING RULE -- only into a practice with NO rules at all. A practice with any
    //    rule has decided things; the baseline never argues with a decision (s12).
    const { count: ruleCount, error: ruleCountErr } = await admin.from("practice_booking_rule")
      .select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    if (ruleCountErr || ruleCount === null || ruleCount === undefined) {
      return { ok: false, detail: `existing rules could not be counted: ${ruleCountErr?.message ?? "no count"}`, seeded, skipped };
    }
    if (ruleCount > 0) {
      skipped.push(`rule (${ruleCount} already exist)`);
    } else {
      // ⚠ IMPORTED WHERE IT IS USED: booking-rules imports provisioning, and provisioning imports this
      // file -- a static import here would close that cycle.
      const { saveBookingRule } = await import("@/lib/practice/booking-rules");
      const rule = await saveBookingRule(admin, ctx, {
        name: BASELINE_RULE_NAME,
        description: "Using Competen default. Change anything here, or archive it and write your own.",
        status: "active",
        priority: 0,
        bookingHorizonDays: 120,
        leadTimeMinutes: 30,
        cancellationNoticeMinutes: 0,
        overbookingAllowed: 0,
        confirmationMode: "instant",
        patientEligibility: "any",
        // ⚠ PUBLIC VISIBILITY, UNPUBLISHED PAGE. Nothing is reachable until the practitioner publishes
        // -- and because the window is already public-ready, publishing is the ONE deliberate act that
        // makes the practice bookable (s6 step 5). Open decision H1 records the one-line reversal.
        visibility: "public",
        // The pilot verification channel is email, so email is required at booking (s3). Names are the
        // engine's own floor; everything else stays optional exactly as an unset level means.
        requiredInformation: { fields: { contact_email: { level: "required" } } } as any,
        actorId: ownerId,
        correlationId,
      });
      if (!rule.ok) return { ok: false, detail: `starter rule refused: ${rule.message}`, seeded, skipped };
      seeded.rule = true;
    }

    // ── 3. THE STARTER REGISTRATION FORM -- only where no template exists. createTemplate seeds the
    //    canonical core fields with the canonical required keys; publishTemplate applies the same
    //    validation a human publish gets.
    const { count: tplCount, error: tplCountErr } = await admin.from("practice_registration_template")
      .select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    if (tplCountErr || tplCount === null || tplCount === undefined) {
      return { ok: false, detail: `existing templates could not be counted: ${tplCountErr?.message ?? "no count"}`, seeded, skipped };
    }
    if (tplCount > 0) {
      skipped.push(`registration (${tplCount} template${tplCount === 1 ? "" : "s"} already exist)`);
    } else {
      const { createTemplate, publishTemplate } = await import("@/lib/practice/registration-config");
      const created = await createTemplate(admin, ctx, { name: "Patient registration", correlationId });
      if (!created.ok) return { ok: false, detail: `starter registration form refused: ${created.message}`, seeded, skipped };
      const published = await publishTemplate(admin, ctx, { templateId: created.data.id, makeDefault: true, correlationId });
      if (!published.ok) return { ok: false, detail: `starter registration form could not be published: ${published.message}`, seeded, skipped };
      seeded.registration = true;
    }

    // ── 4. THE EMAIL CHANNEL -- on, named after the practice, ONLY where the deployment can actually
    //    send (s3: never fabricate provider readiness), and only where no channel row exists yet.
    if (!messagingStatus().email.configured) {
      skipped.push("email (no provider on this deployment)");
    } else {
      const { data: emailRow, error: emailErr } = await admin.from("practice_message_channel")
        .select("id").eq("workspace_id", workspaceId).eq("kind", "email").maybeSingle();
      if (emailErr) {
        return { ok: false, detail: `email channel could not be read: ${emailErr.message}`, seeded, skipped };
      }
      if (emailRow) {
        skipped.push("email (a channel row already exists)");
      } else {
        const { setChannel } = await import("@/lib/practice/messaging");
        const email = await setChannel(admin, ctx, {
          kind: "email", enabled: true, senderName: ctx.workspaceName, correlationId,
        });
        if (!email.ok) return { ok: false, detail: `email channel refused: ${email.message}`, seeded, skipped };
        seeded.email = true;
      }
    }

    await audit(admin, {
      workspaceId, actorId: ownerId, eventType: "practice.baseline_seeded",
      payload: { baselineVersion: CP_BASELINE_VERSION, seeded, skipped },
      correlationId,
    });

    return { ok: true, seeded, skipped };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "the baseline seed failed", seeded, skipped };
  }
}
