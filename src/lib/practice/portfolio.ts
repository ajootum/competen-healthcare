import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock } from "@/lib/practice/practice-time";

// CPR-240 PROFESSIONAL PORTFOLIO.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PORTFOLIO IS A DOCUMENT SOMEBODY SUBMITS FOR APPRAISAL AND REVALIDATION. IF IT OVERSTATES, IT IS
// THE CLINICIAN WHO SIGNED IT.
//
// This is the one module where an invented figure does not merely mislead a user: it travels, under
// their name, to a body that will act on it. The comp prints "Total Experience 8.6 yrs -- Since 2016"
// and "Patients Managed 2,348 -- All time". This product holds only what was recorded IN it, so "all
// time" means "since you started using this software".
//
// EVERY FIGURE IS WHAT THIS PRODUCT RECORDED, AND THE COVERAGE WINDOW IS PART OF THE PORTFOLIO -- in
// the header of the page and of the export, not a footnote. It is an extract, not a career.
//
// NOTHING IS "VERIFIED". Every item carries its PROVENANCE instead:
//   source_linked  it arose from clinical work recorded here
//   self_declared  a practitioner typed it in
// which is both true and more use to an appraiser than a tick.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const PORTFOLIO_KINDS = [
  ["qualification", "Qualification"],
  ["certification", "Certification"],
  ["publication", "Publication"],
  ["achievement", "Achievement or award"],
  ["teaching", "Teaching elsewhere"],
  ["leadership", "Leadership or committee"],
  ["research", "Research"],
  ["other", "Other"],
] as const;

export const PROVENANCE = {
  sourceLinked: {
    key: "source_linked",
    label: "From work recorded here",
    detail: "This arose from a consultation, procedure or activity recorded in this product at the time it happened.",
  },
  selfDeclared: {
    key: "self_declared",
    label: "Declared by you",
    detail: "You typed this in. Nothing here checked it against a registry, a journal or an employer.",
  },
} as const;

/**
 * What this portfolio does not claim.
 *
 * THE FIRST TWO ARE THE ONES THAT MATTER, because they are the two an appraiser would otherwise assume.
 */
export const PORTFOLIO_LIMITS = [
  {
    key: "coverage",
    label: "This is not your career",
    detail: "It covers work recorded in this product, and nothing before that. The design calls the same figures \"All time\" and puts \"Total Experience 8.6 yrs\" at the top. Your coverage window is printed on the portfolio and on every export, because a document that quietly passes an extract off as a career is one you would be signing.",
  },
  {
    key: "verification",
    label: "Nothing here is verified",
    detail: "The design says \"Verified and trustworthy\" and \"Comprehensive & Verified\". No registry was contacted, no employer confirmed a post, no journal confirmed a paper. Each item says instead whether it came from work recorded here or was declared by you -- which is true, and more use than a tick.",
  },
  {
    key: "score",
    label: "There is no portfolio score",
    detail: "The design shows 842/1000 marked \"Excellent\", a donut of its parts and a line chart of it rising. It is one invented number drawn three ways, and a weak portfolio with many entries would score above a strong one with few.",
  },
  {
    key: "attachments",
    label: "Certificates and documents cannot be stored here",
    detail: "The design counts 286 documents, 34 certificates and 62 photos. There is no file storage in this product. A certificate can be recorded with its number and expiry date; the certificate itself lives where it already lives.",
  },
  {
    key: "sharing",
    label: "Nothing is sent anywhere",
    detail: "The design offers to share with colleagues, for credentialing and for opportunities. This product sends nothing, to anybody, ever. You export the portfolio and send it yourself, which also means you see exactly what you sent.",
  },
  {
    key: "cpd_target",
    label: "No CPD target, and no progress against one",
    detail: "The design shows \"CPD Target (2025) 62%\". Nobody set a target in this product, and the requirement depends on your regulator. CPD minutes are counted; what they should add up to is not something this software knows.",
  },
] as const;

// ── THE PRACTITIONER ─────────────────────────────────────────────────────────────────────────────────

export async function getProfile(admin: any, ctx: WorkspaceContext) {
  const { data } = await admin.from("practice_practitioner_profile")
    .select("*").eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId).maybeSingle();
  return data ?? null;
}

export async function saveProfile(admin: any, ctx: WorkspaceContext, args: {
  fullName?: string; profession?: string; specialty?: string; subSpecialty?: string;
  registrationNumber?: string; registrationBody?: string; registrationExpiresOn?: string | null;
  practisingSince?: string | null; summary?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  for (const [value, label] of [
    [args.registrationExpiresOn, "registrationExpiresOn"], [args.practisingSince, "practisingSince"],
  ] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  const map: Record<string, string> = {
    fullName: "full_name", profession: "profession", specialty: "specialty", subSpecialty: "sub_specialty",
    registrationNumber: "registration_number", registrationBody: "registration_body",
    registrationExpiresOn: "registration_expires_on", practisingSince: "practising_since", summary: "summary",
  };
  for (const [k, column] of Object.entries(map)) {
    const v = (args as any)[k];
    if (v !== undefined) patch[column] = typeof v === "string" ? (v.trim() || null) : v;
  }

  const existing = await getProfile(admin, ctx);
  if (existing) {
    const { data: updated, error } = await admin.from("practice_practitioner_profile")
      .update(patch).eq("id", existing.id).select("id");
    if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
    // An update that matched nothing is not a success -- the silent-write class this codebase records.
    if (!updated || updated.length === 0)
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    return { ok: true, data: { id: existing.id as string } };
  }

  const { data, error } = await admin.from("practice_practitioner_profile")
    .insert({ workspace_id: ctx.workspaceId, user_id: ctx.userId, ...patch }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.profile_saved",
    payload: { profileId: data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

// ── DECLARED ENTRIES ─────────────────────────────────────────────────────────────────────────────────

export async function addEntry(admin: any, ctx: WorkspaceContext, args: {
  kind: string; title: string; detail?: string; organisation?: string;
  occurredOn?: string | null; expiresOn?: string | null; reference?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!PORTFOLIO_KINDS.some(([k]) => k === args.kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `kind must be one of: ${PORTFOLIO_KINDS.map(([k]) => k).join(", ")}` };
  if (args.title.trim().length < 3)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an entry needs a title" };

  for (const [value, label] of [[args.occurredOn, "occurredOn"], [args.expiresOn, "expiresOn"]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }
  // A certificate that expired before it was issued is a typo, and one that reaches an appraiser is a
  // question the practitioner has to answer.
  if (args.occurredOn && args.expiresOn && args.expiresOn < args.occurredOn)
    return { ok: false, status: 400, code: "EXPIRES_BEFORE_ISSUE", message: "that expires before it was awarded" };

  const { data, error } = await admin.from("practice_portfolio_entry").insert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId,
    kind: args.kind, title: args.title.trim(), detail: args.detail?.trim() || null,
    organisation: args.organisation?.trim() || null,
    occurred_on: args.occurredOn ?? null, expires_on: args.expiresOn ?? null,
    reference: args.reference?.trim() || null,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_entry_added",
    payload: { entryId: data.id, kind: args.kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function removeEntry(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  const { data: e } = await admin.from("practice_portfolio_entry")
    .select("id, user_id").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (e.user_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's portfolio" };

  await admin.from("practice_portfolio_entry").delete().eq("id", e.id);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_entry_removed",
    payload: { entryId: e.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

// ── THE PORTFOLIO ────────────────────────────────────────────────────────────────────────────────────

/**
 * What this product actually recorded for this person, and from when.
 *
 * THE COVERAGE WINDOW IS COMPUTED, NOT CONFIGURED. It is the earliest thing this product holds for
 * them -- so it cannot be set to a flattering date, and it moves only when the record does.
 */
async function coverage(admin: any, ctx: WorkspaceContext) {
  const earliestOf = async (table: string, column: string, userColumn: string) => {
    const { data } = await admin.from(table).select(column)
      .eq("workspace_id", ctx.workspaceId).eq(userColumn, ctx.userId)
      .order(column, { ascending: true }).limit(1).maybeSingle();
    return (data as any)?.[column] ?? null;
  };

  const dates = (await Promise.all([
    earliestOf("practice_encounter", "started_at", "created_by"),
    earliestOf("practice_procedure", "performed_at", "performed_by"),
    earliestOf("practice_clinical_activity", "occurred_at", "performed_by"),
    earliestOf("practice_reflection", "created_at", "author_id"),
  ])).filter(Boolean).map(String).sort();

  const { data: ws } = await admin.from("practice_workspace")
    .select("created_at").eq("id", ctx.workspaceId).maybeSingle();

  return {
    from: dates[0] ? dates[0].slice(0, 10) : null,
    workspaceCreated: ws?.created_at ? String(ws.created_at).slice(0, 10) : null,
    // THE SENTENCE THAT GOES ON THE EXPORT. Written here rather than on the page, so the page and the
    // document cannot drift apart about what the figures mean.
    statement: dates[0]
      ? `Covers work recorded in this product from ${String(dates[0]).slice(0, 10)} onwards. It is not a complete record of this practitioner's career.`
      : "Nothing has been recorded in this product yet, so this portfolio covers no clinical work. It is not a record of this practitioner's career.",
  };
}

export async function buildPortfolio(admin: any, ctx: WorkspaceContext) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);

  const [
    cover, profile,
    { data: encounters }, { data: procedures }, { data: activities },
    { count: reflections }, { count: learnings }, { data: entries },
  ] = await Promise.all([
    coverage(admin, ctx),
    getProfile(admin, ctx),
    admin.from("practice_encounter").select("id, patient_id, started_at")
      .eq("workspace_id", ctx.workspaceId).eq("created_by", ctx.userId).limit(5000),
    admin.from("practice_procedure").select("id, label, status, performed_at, cpd_minutes, portfolio")
      .eq("workspace_id", ctx.workspaceId).eq("performed_by", ctx.userId).limit(5000),
    admin.from("practice_clinical_activity").select("id, kind, title, occurred_at, duration_minutes, cpd_minutes, portfolio")
      .eq("workspace_id", ctx.workspaceId).eq("performed_by", ctx.userId).limit(5000),
    admin.from("practice_reflection").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId),
    admin.from("practice_case_learning").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId),
    admin.from("practice_portfolio_entry").select("*")
      .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId).order("occurred_on", { ascending: false }),
  ]);

  const encounterRows = (encounters ?? []) as any[];
  const procedureRows = ((procedures ?? []) as any[]).filter(p => p.status === "PERFORMED");
  const activityRows = (activities ?? []) as any[];
  const entryRows = (entries ?? []) as any[];

  const byProcedure = new Map<string, number>();
  for (const p of procedureRows) byProcedure.set(p.label, (byProcedure.get(p.label) ?? 0) + 1);
  const byActivity = new Map<string, number>();
  for (const a of activityRows) byActivity.set(a.kind, (byActivity.get(a.kind) ?? 0) + 1);

  const entriesByKind = PORTFOLIO_KINDS.map(([key, label]) => ({
    key, label,
    items: entryRows.filter(e => e.kind === key).map(e => ({
      ...e,
      // DERIVED, NEVER STORED -- the rule CPR-140 set for overdue. A stored "expired" flag needs
      // something to run, and an appraisal portfolio is exactly where a stale flag does damage.
      expired: !!e.expires_on && e.expires_on < today,
      expiringSoon: !!e.expires_on && e.expires_on >= today && e.expires_on <= addDays(today, 90),
      provenance: PROVENANCE.selfDeclared.key,
    })),
  })).filter(g => g.items.length > 0);

  const expiring = entriesByKind.flatMap(g => g.items).filter(i => i.expired || i.expiringSoon);
  const registrationExpired = !!profile?.registration_expires_on && profile.registration_expires_on < today;

  return {
    coverage: cover,
    profile: profile ? { ...profile, provenance: PROVENANCE.selfDeclared.key } : null,

    // ── FROM WORK RECORDED HERE ──────────────────────────────────────────────────────────────
    recorded: {
      provenance: PROVENANCE.sourceLinked.key,
      consultations: encounterRows.length,
      // A COUNT OF PEOPLE, NOT OF VISITS. The comp's "Patients Managed 2,348" over 2,348 encounters
      // would be one visit each, which is not what a practice looks like.
      patients: new Set(encounterRows.map(e => e.patient_id)).size,
      procedures: procedureRows.length,
      procedureTypes: [...byProcedure.entries()].map(([label, total]) => ({ label, total }))
        .sort((a, b) => b.total - a.total),
      activities: activityRows.length,
      activityKinds: [...byActivity.entries()].map(([kind, total]) => ({ kind, total }))
        .sort((a, b) => b.total - a.total),
      teachingSessions: activityRows.filter(a => a.kind === "teaching" || a.kind === "training").length,
      cpdMinutes: [...procedureRows, ...activityRows].reduce((n, r) => n + (r.cpd_minutes ?? 0), 0),
      markedForPortfolio: [...procedureRows, ...activityRows].filter(r => r.portfolio).length,
      reflections: reflections ?? 0,
      learningPoints: learnings ?? 0,
    },

    // ── DECLARED BY THE PRACTITIONER ─────────────────────────────────────────────────────────
    declared: {
      provenance: PROVENANCE.selfDeclared.key,
      total: entryRows.length,
      byKind: entriesByKind,
    },

    // WHAT AN APPRAISER WOULD ASK ABOUT FIRST. Derived, and the only "attention" this page has.
    attention: {
      expiring,
      registrationExpired,
      registrationExpiresOn: profile?.registration_expires_on ?? null,
      profileIncomplete: !profile || !profile.full_name || !profile.profession,
    },

    // The doctrine, as fields, so no client can render any of them.
    scored: false,
    verified: false,
    coversWholeCareer: false,
    limits: PORTFOLIO_LIMITS,
    today,
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The export.
 *
 * THE COVERAGE STATEMENT IS THE FIRST FIELD, not a footer. A document whose caveat is at the bottom is
 * a document whose caveat gets cropped.
 */
export async function exportPortfolio(admin: any, ctx: WorkspaceContext, args: {
  correlationId: string;
}): Promise<EngineResult<Record<string, unknown>>> {
  const portfolio = await buildPortfolio(admin, ctx);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_exported",
    payload: { coverageFrom: portfolio.coverage.from }, correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      // Deliberately first, and deliberately prose.
      coverage: portfolio.coverage.statement,
      notVerified: "Nothing in this document has been verified by this product. Items marked as declared were typed in by the practitioner; items marked as recorded arose from work entered here at the time.",
      generatedAt: nowIso(),
      generatedFor: portfolio.profile?.full_name ?? null,
      isClinicalDocument: false,
      profile: portfolio.profile,
      recorded: portfolio.recorded,
      declared: portfolio.declared,
      // NO SCORE, NO TOTALS ACROSS THE TWO HALVES. Adding a declared publication to a recorded procedure
      // produces a number that means nothing and reads as a career.
      scored: false,
      sentByThisProduct: false,
    },
  };
}
