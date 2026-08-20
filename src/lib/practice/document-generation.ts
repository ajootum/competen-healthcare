import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { getConfiguration } from "@/lib/practice/configuration";
import { createDocument } from "@/lib/practice/documentation";
import { MERGE_FIELDS } from "@/lib/practice/document-constants";
import { practiceToday } from "@/lib/practice/practice-time";

// CPR-330 REPORTS, DOCUMENTS AND CORRESPONDENCE -- generation, rebuilt after CPR-AUDIT-001.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AN UNRESOLVED MERGE FIELD RENDERS AS A VISIBLE MARKER. NEVER AS BLANK.
//
// This is the rule the whole module turns on. A template reads "Dear {{referral.addressee}}," and the
// field has no value; blanking it produces "Dear ," which a practitioner skims past and signs. Leaving
// [[referral.addressee]] visible in the draft is impossible to miss and impossible to sign by accident.
//
// The same argument, harder, for clinical facts: a certificate whose {{patient.date_of_birth}} silently
// vanished is a certificate about nobody. Every unresolved field is also RETURNED in the result, so the
// caller can refuse to generate at all rather than hand somebody a document to proofread.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO FOURTH DOCUMENT MODEL. Generation produces an ordinary practice_clinical_document -- CPR-130's
// object, with its signing, versioning and release register intact. A template is a way of typing
// faster, not a different kind of record.
//
// THE LETTERHEAD IS PRINTED FROM WHAT THE PRACTICE SUPPLIED, and from nothing else. CPR-130 refused
// letterheads because there was no source for the facts; CPR-360 built one. Every field is optional and
// an unsupplied field prints nothing -- a practice that fills in none of it gets a document with no
// letterhead rather than one with placeholders where its registration number should be.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIELD_PATTERN = /\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*\}\}/gi;

export type MergeContext = Record<string, string | null>;

/**
 * Substitute merge fields, and report every one that could not be filled.
 *
 * Two kinds of failure are distinguished, because they are different mistakes:
 *   UNKNOWN  the template names a field this product does not have -- an authoring error.
 *   EMPTY    the field exists and this record has no value for it -- a data gap.
 * Both render as a visible marker; only the caller can decide which is acceptable.
 */
export function mergeTemplate(body: string, context: MergeContext): {
  text: string; unresolved: { field: string; reason: "unknown" | "empty" }[];
} {
  const unresolved: { field: string; reason: "unknown" | "empty" }[] = [];
  const known = new Set<string>(MERGE_FIELDS.map(([f]) => f));

  const text = body.replace(FIELD_PATTERN, (_match, rawField: string) => {
    const field = rawField.toLowerCase();
    if (!known.has(field)) {
      unresolved.push({ field, reason: "unknown" });
      return `[[unknown field: ${field}]]`;
    }
    const value = context[field];
    if (value === null || value === undefined || String(value).trim() === "") {
      unresolved.push({ field, reason: "empty" });
      return `[[${field} not recorded]]`;
    }
    return String(value);
  });

  return { text, unresolved };
}

/** The signing practitioner's name, so {{practitioner.name}} is the real person rather than a caller id. */
export async function practitionerNameFor(admin: any, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}

/** Everything a template may draw on, for one patient and optionally one consultation. */
export async function buildMergeContext(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId?: string | null; practitionerName?: string | null;
}): Promise<MergeContext | null> {
  // patient_number is CPR-PID-001's identifier and is selected for {{patient.identifier}} -- see the
  // ladder where practiceId is computed below.
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name, sex, birth_date, age_estimate_years, patient_number")
    .eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return null;

  const [{ data: identifiers }, { data: contacts }, config] = await Promise.all([
    admin.from("practice_patient_identifier").select("value, identifier_type").eq("workspace_id", ctx.workspaceId).eq("patient_id", args.patientId),
    admin.from("practice_patient_contact").select("value, contact_type, preferred").eq("workspace_id", ctx.workspaceId).eq("patient_id", args.patientId),
    getConfiguration(admin, ctx.workspaceId),
  ]);

  let encounter: any = null;
  let diagnoses: any[] = [];
  let planNote: string | null = null;
  if (args.encounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id, started_at, reason_for_visit")
      .eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    // A consultation belonging to somebody else must not leak into this patient's letter.
    if (enc && enc.patient_id === args.patientId) {
      encounter = enc;
      const [{ data: dx }, { data: notes }] = await Promise.all([
        admin.from("practice_diagnosis").select("label, certainty").eq("workspace_id", ctx.workspaceId).eq("encounter_id", enc.id).order("created_at"),
        admin.from("practice_encounter_note").select("note_type, body").eq("workspace_id", ctx.workspaceId).eq("encounter_id", enc.id).eq("note_type", "plan"),
      ]);
      diagnoses = (dx ?? []) as any[];
      planNote = ((notes ?? []) as any[])[0]?.body ?? null;
    }
  }

  // ⚠ THIS READ THE RETIRED IDENTIFIER ONLY, AND {{patient.identifier}} HAS BEEN RENDERING
  // "[[patient.identifier not recorded]]" INTO REFERRAL LETTERS EVER SINCE.
  //
  // Migration 289 (CPR-PID-001 v1.0, FROZEN, owner decision 2026-08-11) made YY-NNNNNN on
  // practice_patient.patient_number the patient identifier, and said of the old one in as many words:
  // "existing P-XXXXXX practice ids RETIRE to searchable legacy aliases and stay in
  // practice_patient_identifier untouched. New registrations stop issuing them." So this line was
  // looking in the one place a patient registered after that date can never appear -- measured today:
  // 60 patients, ALL 60 with a patient_number, and only 10 with a practice_id alias.
  //
  // A letter that says the practice identifier is not recorded, about a patient whose identifier is
  // recorded, is a false statement leaving the practice on headed paper.
  //
  // ⚠ THE LADDER IS THE PRODUCT'S OWN, NOT A NEW ONE. CohortTable.tsx documents it as "the
  // patientNumber ?? practiceId ?? 'none yet' ladder" and ContextBanner.tsx spells the same thing;
  // every surface that shows a patient identifier already reads the number first and falls back to the
  // legacy alias. This module was the one left behind, so it gets the established idiom rather than an
  // invented one. The fallback still earns its place: it is what a pre-289 patient's letter shows.
  const legacyPracticeId = ((identifiers ?? []) as any[])
    .find(i => i.identifier_type === "practice_id")?.value ?? null;
  const practiceId = patient.patient_number ?? legacyPracticeId;
  const phone = ((contacts ?? []) as any[]).find(c => c.contact_type === "phone" && c.preferred)?.value
    ?? ((contacts ?? []) as any[]).find(c => c.contact_type === "phone")?.value ?? null;

  const age = patient.birth_date
    ? String(Math.floor((Date.now() - Date.parse(patient.birth_date)) / (365.25 * 86400000)))
    : (patient.age_estimate_years != null ? `${patient.age_estimate_years}` : null);

  return {
    "patient.name": patient.display_name ?? null,
    "patient.sex": patient.sex ?? null,
    "patient.date_of_birth": patient.birth_date ?? null,
    "patient.age": age,
    "patient.identifier": practiceId,
    "patient.phone": phone,
    "encounter.date": encounter ? String(encounter.started_at).slice(0, 10) : null,
    "encounter.reason": encounter?.reason_for_visit ?? null,
    "encounter.diagnoses": diagnoses.length ? diagnoses.map(d => `- ${d.label} (${d.certainty})`).join("\n") : null,
    "encounter.plan": planNote,
    "practice.name": config?.workspace?.name ?? null,
    "practitioner.name": args.practitionerName ?? null,
    "today": practiceToday(config?.workspace?.timezone),
  };
}

/**
 * The letterhead, from what the practice supplied and nothing else.
 *
 * Returns null when nothing has been configured, so a document simply has no header rather than one
 * made of empty lines.
 */
export async function letterhead(admin: any, workspaceId: string): Promise<string | null> {
  const config = await getConfiguration(admin, workspaceId);
  if (!config) return null;
  const c = config.config as any;
  const lines = [
    c.letterhead_name || config.workspace.name,
    c.letterhead_registration,
    c.letterhead_address,
    c.letterhead_contact,
  ].filter(v => v && String(v).trim());
  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Generate one document from a template.
 *
 * REFUSES BY DEFAULT WHEN A FIELD CANNOT BE FILLED. `allowUnresolved` exists because a practitioner may
 * legitimately want the draft anyway and will fill the gap by hand -- but it has to be asked for, so
 * nobody generates forty certificates with a hole in each and finds out at the signing.
 */
export async function generateFromTemplate(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; patientId: string; encounterId?: string | null; title?: string;
  addressedTo?: string; allowUnresolved?: boolean; practitionerName?: string | null;
  batchId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string; unresolved: { field: string; reason: string }[] }>> {
  const { data: template } = await admin.from("practice_note_template")
    .select("id, workspace_id, title, kind, status, body_template, include_letterhead")
    .eq("id", args.templateId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.workspace_id !== null && template.workspace_id !== ctx.workspaceId)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.status !== "published")
    return { ok: false, status: 422, code: "TEMPLATE_NOT_PUBLISHED", message: "this template is not published" };
  if (template.kind === "encounter_note")
    return {
      ok: false, status: 422, code: "WRONG_TEMPLATE_KIND",
      message: "an encounter-note template fills a consultation's SOAP segments; it does not generate a document",
    };
  if (!template.body_template || !template.body_template.trim())
    return { ok: false, status: 422, code: "NO_BODY", message: "this template has no body to merge" };

  const context = await buildMergeContext(admin, ctx, {
    patientId: args.patientId, encounterId: args.encounterId,
    practitionerName: args.practitionerName !== undefined
      ? args.practitionerName : await practitionerNameFor(admin, ctx.userId),
  });
  if (!context) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const merged = mergeTemplate(template.body_template, context);
  if (merged.unresolved.length > 0 && !args.allowUnresolved) {
    return {
      ok: false, status: 422, code: "UNRESOLVED_FIELDS",
      message: `${merged.unresolved.length} field(s) could not be filled: ${merged.unresolved.map(u => u.field).join(", ")}. Generate anyway to fill them by hand.`,
    };
  }

  // THE LETTERHEAD IS NOT WRITTEN INTO THE BODY, and this was worth getting right. Baking it in would
  // freeze a copy of the practice's address inside every signed clinical record, so a practice that
  // corrects its registration number would leave a hundred documents quietly disagreeing with it -- and
  // the print view would then have to guess whether a header was already there. A letterhead is
  // stationery, not clinical content. It is composed at print time from one definition, and the signed
  // body stays exactly the text that was merged and signed.
  const body = merged.text;

  const created = await createDocument(admin, {
    workspaceId: ctx.workspaceId, patientId: args.patientId, encounterId: args.encounterId ?? null,
    templateId: template.id, docType: template.kind,
    title: (args.title ?? template.title).trim(), addressedTo: args.addressedTo,
    body, actorId: ctx.userId, correlationId: args.correlationId,
  });
  if (!created.ok) return created;

  if (args.batchId) {
    await admin.from("practice_clinical_document").update({ batch_id: args.batchId }).eq("id", created.data.id);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_generated",
    payload: { documentId: created.data.id, templateId: template.id, unresolved: merged.unresolved.length },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { id: created.data.id, unresolved: merged.unresolved } };
}

/**
 * Generate the same document for many patients.
 *
 * THE BATCH RECORD IS WRITTEN FIRST AND UPDATED WITH WHAT ACTUALLY HAPPENED, including failures. A run
 * that produced thirty-eight of forty must say so: "forty certificates were generated" is the kind of
 * claim somebody relies on without checking.
 */
export async function generateBatch(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; patientIds: string[]; titlePattern?: string; selectionNote?: string;
  allowUnresolved?: boolean; practitionerName?: string | null; correlationId: string;
}): Promise<EngineResult<{ batchId: string; generated: number; failed: number; failures: { patientId: string; reason: string }[] }>> {
  if (args.patientIds.length === 0)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "no patients were selected" };
  if (args.patientIds.length > 200)
    return { ok: false, status: 422, code: "BATCH_TOO_LARGE", message: "generate at most 200 documents at a time" };

  const { data: template } = await admin.from("practice_note_template")
    .select("id, workspace_id, title, kind, status").eq("id", args.templateId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (template.workspace_id !== null && template.workspace_id !== ctx.workspaceId)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: batch, error } = await admin.from("practice_document_batch").insert({
    workspace_id: ctx.workspaceId, template_id: template.id, doc_type: template.kind,
    title_pattern: args.titlePattern ?? template.title, selection_note: args.selectionNote ?? null,
    requested: args.patientIds.length, created_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const failures: { patientId: string; reason: string }[] = [];
  let generated = 0;
  // Resolved once rather than per document -- two hundred identical lookups for one unchanging name.
  const author = args.practitionerName !== undefined
    ? args.practitionerName : await practitionerNameFor(admin, ctx.userId);
  for (const patientId of args.patientIds) {
    const one = await generateFromTemplate(admin, ctx, {
      templateId: template.id, patientId, title: args.titlePattern,
      allowUnresolved: args.allowUnresolved, practitionerName: author,
      batchId: batch.id, correlationId: args.correlationId,
    });
    if (one.ok) generated++;
    else failures.push({ patientId, reason: one.code });
  }

  await admin.from("practice_document_batch")
    .update({ generated, failed: failures.length }).eq("id", batch.id);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_batch_generated",
    payload: { batchId: batch.id, requested: args.patientIds.length, generated, failed: failures.length },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { batchId: batch.id as string, generated, failed: failures.length, failures } };
}

export async function listBatches(admin: any, workspaceId: string, limit = 20) {
  const { data } = await admin.from("practice_document_batch")
    .select("id, template_id, doc_type, title_pattern, selection_note, requested, generated, failed, created_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as any[];
}

// ── SCHEDULED REPORTS ────────────────────────────────────────────────────────────────────────────────
//
// THE DEFINITION IS REAL; THE FIRING IS NOT. A schedule needs a scheduler, and a tenant-triggered job is
// an infrastructure decision this module has not been given. `next_run_at` is advisory and `last_run_at`
// moves only when somebody presses Run now. Every surface says so -- a schedule that looks automatic and
// is not would be worse than no schedule at all, because nobody would check.

export async function createSchedule(admin: any, ctx: WorkspaceContext, args: {
  name: string; reportKind: string; cadence: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.name.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a schedule needs a name" };
  if (!["daily", "weekly", "monthly"].includes(args.cadence))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "cadence must be daily, weekly or monthly" };
  if (!["activity", "diagnosis", "backlog", "patient_list"].includes(args.reportKind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "unknown report kind" };

  const { data, error } = await admin.from("practice_scheduled_report").insert({
    workspace_id: ctx.workspaceId, name: args.name.trim(), report_kind: args.reportKind,
    cadence: args.cadence, created_by: ctx.userId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.report_schedule_created",
    payload: { scheduleId: data.id, reportKind: args.reportKind, cadence: args.cadence },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function listSchedules(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_scheduled_report")
    .select("id, name, report_kind, cadence, active, next_run_at, last_run_at, created_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  return ((data ?? []) as any[]).map(s => ({
    ...s,
    // Stated per row rather than once in a footnote: this is the field somebody will otherwise assume.
    fires: false,
    note: "Defined, not automated. Nothing runs this on its own yet.",
  }));
}

// ── THE DASHBOARD ────────────────────────────────────────────────────────────────────────────────────
//
// Composed to the CPR-330 comp's layout: a six-tile KPI strip, report categories, recently generated,
// quick create, template library, scheduled reports, most-used templates.
//
// TWO TILES CANNOT BE FILLED and render as empty states in their designed position rather than being
// dropped -- the layout was never the thing in dispute (CPR-AUDIT-001 s2).
//
// NO PERCENTAGES. The comp's "+23% vs last 7 days" becomes "48 this period, 39 in the 7 days before" --
// a count against a count. The previous period IS recorded, so the comparison is real; it is the
// PERCENTAGE that was refused, because a percentage is where a small number goes to hide.

export type Kpi = {
  key: string; label: string; value: number | null; sub: string | null;
  available: boolean; reason?: string;
};

/** Copies recorded as having left the practice in a period. */
async function releasedInPeriod(admin: any, workspaceId: string, fromIso: string, toIso: string): Promise<number | null> {
  const { count, error } = await admin.from("practice_clinical_document_release")
    .select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId)
    .gte("released_at", fromIso).lt("released_at", toIso);
  // A failed count is reported as unknown, never as zero. "0 copies released" and "we could not tell"
  // are different sentences and only one of them is safe to act on.
  return error ? null : (count ?? 0);
}

export async function reportsDashboard(admin: any, ctx: WorkspaceContext, opts: {
  fromDay?: string; toDay?: string; days?: number;
} = {}) {
  const ws = ctx.workspaceId;
  const { resolvePeriod } = await import("@/lib/practice/reports");
  const period = await resolvePeriod(admin, ws, opts);

  // The equal-length window immediately before, for the comparison the comp puts under each tile.
  const spanMs = Date.parse(period.toIso) - Date.parse(period.fromIso);
  const priorFromIso = new Date(Date.parse(period.fromIso) - spanMs).toISOString();
  const priorToIso = period.fromIso;

  const count = async (extra: (q: any) => any, fromIso: string, toIso: string, column = "created_at") => {
    const { count: n } = await extra(admin.from("practice_clinical_document")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", ws).gte(column, fromIso).lt(column, toIso));
    return n ?? 0;
  };

  const [
    generated, generatedPrior, letters, certificates,
    released, schedules, templates, recentRows, batches,
  ] = await Promise.all([
    count(q => q, period.fromIso, period.toIso),
    count(q => q, priorFromIso, priorToIso),
    count(q => q.eq("doc_type", "referral_letter"), period.fromIso, period.toIso),
    count(q => q.eq("doc_type", "sick_note").not("signed_at", "is", null), period.fromIso, period.toIso, "signed_at"),
    releasedInPeriod(admin, ws, period.fromIso, period.toIso),
    listSchedules(admin, ws),
    admin.from("practice_note_template")
      .select("id, title, kind, status, workspace_id, body_template")
      .or(`workspace_id.eq.${ws},workspace_id.is.null`).eq("status", "published"),
    admin.from("practice_clinical_document")
      .select("id, title, doc_type, status, patient_id, template_id, created_at")
      .eq("workspace_id", ws).order("created_at", { ascending: false }).limit(8),
    listBatches(admin, ws, 5),
  ]);

  const kpis: Kpi[] = [
    {
      key: "generated", label: "Documents generated", value: generated, available: true,
      sub: `${generatedPrior} in the ${period.fromDay === period.toDay ? "day" : "period"} before`,
    },
    { key: "letters", label: "Letters and referrals", value: letters, available: true, sub: "of the documents above" },
    { key: "certificates", label: "Certificates issued", value: certificates, available: true, sub: "signed, not merely drafted" },
    {
      key: "scheduled", label: "Scheduled reports", value: schedules.length, available: true,
      // The comp says "5 due this week". Nothing is due, because nothing runs.
      sub: schedules.length ? "defined; none run on their own yet" : "none defined",
    },
    released === null
      ? {
        key: "released", label: "Copies released", value: null, available: false, sub: null,
        reason: "The release register could not be counted.",
      }
      : {
        key: "released", label: "Copies released", value: released, available: true,
        sub: "recorded by hand when a copy left",
      },
    {
      key: "ai_time", label: "Time saved by AI", value: null, available: false, sub: null,
      // The comp's "12.4 hrs". Two problems, either fatal: there is no AI drafting, and there is no
      // measurement of how long the same document would have taken to type.
      reason: "AI drafting is specified as CPR-210 and is not built.",
    },
  ];

  // Categories and the template library are the same templates counted two ways, as the comp shows them.
  const tpl = ((templates as any).data ?? []) as any[];
  const byKind = new Map<string, number>();
  const mergeable = new Map<string, number>();
  for (const t of tpl) {
    byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
    if (t.body_template && t.body_template.trim()) mergeable.set(t.kind, (mergeable.get(t.kind) ?? 0) + 1);
  }

  const recent = ((recentRows as any).data ?? []) as any[];
  const identified = hasCapability(ctx, "patient.view");
  const nameOf = new Map<string, string>();
  if (identified && recent.length) {
    const ids = [...new Set(recent.map(r => r.patient_id).filter(Boolean))];
    const { data: patients } = await admin.from("practice_patient").select("id, display_name").eq("workspace_id", ws).in("id", ids);
    for (const p of ((patients ?? []) as any[])) nameOf.set(p.id, p.display_name);
  }

  // Most used: which templates the practice actually reaches for. A bar is a count drawn to scale, which
  // is not a rate -- the number stays next to it.
  const { data: usageRows } = await admin.from("practice_clinical_document")
    .select("template_id").eq("workspace_id", ws).not("template_id", "is", null)
    .gte("created_at", period.fromIso).lt("created_at", period.toIso).limit(1000);
  const usage = new Map<string, number>();
  for (const r of ((usageRows ?? []) as any[])) usage.set(r.template_id, (usage.get(r.template_id) ?? 0) + 1);
  const titleOf = new Map(tpl.map(t => [t.id, t.title]));
  const mostUsed = [...usage.entries()]
    .map(([id, n]) => ({ id, title: titleOf.get(id) ?? "A template no longer published", total: n }))
    .sort((a, b) => b.total - a.total).slice(0, 6);

  return {
    period, kpis, identified,
    categories: tpl.length === 0 ? [] : [...byKind.entries()].map(([kind, n]) => ({
      kind, templates: n, mergeable: mergeable.get(kind) ?? 0,
    })).sort((a, b) => b.templates - a.templates),
    recent: recent.map(r => ({
      id: r.id, title: r.title, docType: r.doc_type, status: r.status, createdAt: r.created_at,
      patient: identified ? (nameOf.get(r.patient_id) ?? null) : null,
    })),
    templates: tpl.map(t => ({ id: t.id, title: t.title, kind: t.kind, mergeable: !!(t.body_template && t.body_template.trim()) })),
    schedules, batches, mostUsed,
  };
}

export async function markScheduleRun(admin: any, ctx: WorkspaceContext, scheduleId: string): Promise<EngineResult<{ ranAt: string }>> {
  const { data: schedule } = await admin.from("practice_scheduled_report")
    .select("id").eq("id", scheduleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!schedule) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const ranAt = new Date().toISOString();
  await admin.from("practice_scheduled_report")
    .update({ last_run_at: ranAt, last_run_by: ctx.userId }).eq("workspace_id", ctx.workspaceId).eq("id", schedule.id);
  return { ok: true, data: { ranAt } };
}
