import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { logAccess } from "@/lib/practice/privacy";

// CPR-220 CASE MEMORY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SIMILARITY IS A LIST OF SHARED FACTS, NEVER A SCORE.
//
// The comp puts "95% relevance" and "92% similarity" beside each retrieved case, with a progress bar. In
// a product that computes no percentages that would be refused anyway -- but this one is worse than a
// rate. A clinician reading "92% similar" next to a treatment and an outcome may reasonably let it
// inform what they do next, and there is no formula that could earn that number. A wrong one would look
// exactly like a right one.
//
// So retrieval matches on facts that were actually recorded, and returns WHICH ONES MATCHED. "Matches
// on: diagnosis (Lumbar disc herniation), procedure (Microdiscectomy), age within five years" is
// something a clinician can weigh. "92%" is not. Ordering is by the NUMBER of matched facts, then
// recency -- a count, not a score.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// A SIMILAR-CASE LIST IS A LIST OF OTHER PEOPLE'S PATIENTS, so it is DE-IDENTIFIED BY DEFAULT. Learning
// from a case does not require knowing whose it was: the age band, the sex, the condition, what was done
// and how it turned out are the whole clinical content. A caller holding patient.view sees names as
// well, and that read is logged like any other.
//
// NO CASE TABLE. A case is an encounter that already exists. Copying diagnoses and outcomes into a
// case-memory table would be a second record of the same consultation, disagreeing with the first the
// day somebody amended one.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const LEARNING_KINDS = [
  ["what_worked", "What worked"],
  ["what_to_avoid", "What to avoid"],
  ["complication", "A complication and what followed"],
  ["technique", "Technique"],
  ["diagnosis_pitfall", "A diagnostic pitfall"],
  ["observation", "An observation"],
] as const;

/** Age bands, so a retrieved case can carry an age without carrying an identifier. */
function ageBand(birthDate: string | null, estimate: number | null): string | null {
  const years = birthDate
    ? Math.floor((Date.now() - Date.parse(birthDate)) / (365.25 * 86400000))
    : estimate;
  if (years == null || !Number.isFinite(years)) return null;
  if (years < 1) return "under 1";
  if (years < 16) return `${Math.floor(years / 5) * 5}-${Math.floor(years / 5) * 5 + 4}`;
  return `${Math.floor(years / 10) * 10}s`;
}

function ageYears(birthDate: string | null, estimate: number | null): number | null {
  const years = birthDate
    ? Math.floor((Date.now() - Date.parse(birthDate)) / (365.25 * 86400000))
    : estimate;
  return years != null && Number.isFinite(years) ? years : null;
}

export type MatchedOn = { field: string; label: string; value: string };

/**
 * Find previous cases sharing recorded facts with this one.
 *
 * WHAT MAKES A MATCH IS EXPLICIT AND CHECKABLE. Four kinds of fact, each one something a clinician
 * actually wrote down:
 *   diagnosis   the same label, as typed -- CPR-270's rule that nothing forces a terminology means two
 *               spellings are two conditions, and pretending otherwise here would invent a coding
 *   procedure   the same procedure label
 *   age         within five years, reported as a band rather than a number
 *   sex         the same, where both are recorded
 *
 * A case matching on NOTHING is not returned. There is no floor on a score because there is no score;
 * the floor is "at least one stated fact in common", which is a sentence rather than a threshold.
 */
export async function findSimilarCases(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; limit?: number;
}) {
  const { data: source } = await admin.from("practice_encounter")
    .select("id, patient_id, started_at").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!source) return null;

  const [{ data: sourcePatient }, { data: sourceDx }, { data: sourceProc }] = await Promise.all([
    admin.from("practice_patient").select("id, sex, birth_date, age_estimate_years").eq("id", source.patient_id).maybeSingle(),
    admin.from("practice_diagnosis").select("label").eq("encounter_id", source.id),
    admin.from("practice_procedure").select("label").eq("encounter_id", source.id),
  ]);

  const dxLabels = [...new Set(((sourceDx ?? []) as any[]).map(d => String(d.label).trim().toLowerCase()))];
  const procLabels = [...new Set(((sourceProc ?? []) as any[]).map(p => String(p.label).trim().toLowerCase()))];
  const sourceAge = ageYears(sourcePatient?.birth_date ?? null, sourcePatient?.age_estimate_years ?? null);
  const sourceSex = sourcePatient?.sex ?? null;

  // NOTHING RECORDED MEANS NOTHING TO MATCH ON, and that is said rather than returning an arbitrary
  // list of recent consultations dressed up as similar.
  if (dxLabels.length === 0 && procLabels.length === 0) {
    return {
      source: { id: source.id, ageBand: ageBand(sourcePatient?.birth_date ?? null, sourcePatient?.age_estimate_years ?? null), sex: sourceSex },
      cases: [],
      identified: hasCapability(ctx, "patient.view"),
      matchedNothing: true,
      reason: "This consultation has no diagnosis or procedure recorded yet, so there is nothing to match on.",
    };
  }

  // Candidates: every OTHER encounter in this practice carrying one of those labels. Two queries rather
  // than a join, because the labels are free text and the match is done in TypeScript where the
  // normalisation is visible.
  const [{ data: dxRows }, { data: procRows }] = await Promise.all([
    dxLabels.length
      ? admin.from("practice_diagnosis").select("encounter_id, label").eq("workspace_id", ctx.workspaceId).limit(2000)
      : Promise.resolve({ data: [] }),
    procLabels.length
      ? admin.from("practice_procedure").select("encounter_id, label").eq("workspace_id", ctx.workspaceId).limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  const matches = new Map<string, MatchedOn[]>();
  const add = (encounterId: string, m: MatchedOn) => {
    if (encounterId === source.id) return;
    const list = matches.get(encounterId) ?? [];
    if (!list.some(x => x.field === m.field && x.value === m.value)) list.push(m);
    matches.set(encounterId, list);
  };

  for (const d of ((dxRows ?? []) as any[])) {
    if (dxLabels.includes(String(d.label).trim().toLowerCase())) {
      add(d.encounter_id, { field: "diagnosis", label: "Same diagnosis", value: d.label });
    }
  }
  for (const p of ((procRows ?? []) as any[])) {
    if (procLabels.includes(String(p.label).trim().toLowerCase())) {
      add(p.encounter_id, { field: "procedure", label: "Same procedure", value: p.label });
    }
  }
  if (matches.size === 0) {
    return {
      source: { id: source.id, ageBand: ageBand(sourcePatient?.birth_date ?? null, sourcePatient?.age_estimate_years ?? null), sex: sourceSex },
      cases: [], identified: hasCapability(ctx, "patient.view"), matchedNothing: true,
      reason: "No other consultation in this practice shares a diagnosis or procedure with this one.",
    };
  }

  const ids = [...matches.keys()];
  const { data: encounters } = await admin.from("practice_encounter")
    .select("id, patient_id, started_at, status, reason_for_visit")
    .eq("workspace_id", ctx.workspaceId).in("id", ids);
  const rows = (encounters ?? []) as any[];

  const patientIds = [...new Set(rows.map(r => r.patient_id))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient")
      .select("id, display_name, sex, birth_date, age_estimate_years, status").in("id", patientIds)
    : { data: [] };
  const patientById = new Map(((patients ?? []) as any[]).map(p => [p.id, p]));

  // Age and sex are matched here rather than in the query, because they are only meaningful ALONGSIDE a
  // clinical match -- "another 40-year-old man" is not a similar case, it is a coincidence.
  for (const r of rows) {
    const p = patientById.get(r.patient_id);
    if (!p) continue;
    const theirAge = ageYears(p.birth_date, p.age_estimate_years);
    if (sourceAge != null && theirAge != null && Math.abs(sourceAge - theirAge) <= 5) {
      add(r.id, { field: "age", label: "Age within five years", value: ageBand(p.birth_date, p.age_estimate_years) ?? "" });
    }
    if (sourceSex && p.sex && sourceSex === p.sex) {
      add(r.id, { field: "sex", label: "Same sex recorded", value: p.sex });
    }
  }

  // Outcomes, so a retrieved case says how it turned out -- which is the whole reason to look at it.
  const { data: outcomes } = await admin.from("practice_procedure_outcome")
    .select("procedure_id, outcome_type, severity, detail").eq("workspace_id", ctx.workspaceId).limit(2000);
  const { data: procsForOutcome } = await admin.from("practice_procedure")
    .select("id, encounter_id").eq("workspace_id", ctx.workspaceId).in("encounter_id", ids);
  const encounterOfProcedure = new Map(((procsForOutcome ?? []) as any[]).map(p => [p.id, p.encounter_id]));
  const outcomeByEncounter = new Map<string, any[]>();
  for (const o of ((outcomes ?? []) as any[])) {
    const enc = encounterOfProcedure.get(o.procedure_id);
    if (!enc) continue;
    outcomeByEncounter.set(enc, [...(outcomeByEncounter.get(enc) ?? []), o]);
  }

  const identified = hasCapability(ctx, "patient.view");
  const cases = rows.map(r => {
    const p = patientById.get(r.patient_id);
    const matched = matches.get(r.id) ?? [];
    return {
      encounterId: r.id,
      // THE NAME IS PRESENT ONLY FOR A CALLER WHO MAY SEE IT. Everybody else gets the clinical content,
      // which is all that learning from the case requires.
      patientName: identified ? (p?.display_name ?? null) : null,
      ageBand: ageBand(p?.birth_date ?? null, p?.age_estimate_years ?? null),
      sex: p?.sex ?? null,
      when: r.started_at,
      reason: r.reason_for_visit,
      status: r.status,
      matchedOn: matched,
      // A COUNT OF SHARED FACTS. Not a score, not normalised, not a percentage.
      matchCount: matched.length,
      outcomes: (outcomeByEncounter.get(r.id) ?? []).map(o => ({
        // THE DETAIL GOES WITH THE NAMES. It is free text about a complication and routinely names the
        // patient, the ward and the colleague who saw them.
        type: o.outcome_type, severity: o.severity, detail: identified ? o.detail : null,
      })),
      href: `/practice/encounters/${r.id}`,
    };
  })
    .filter(c => c.matchCount > 0)
    // Most shared facts first, then most recent. Both halves are facts about the record.
    .sort((a, b) => b.matchCount - a.matchCount || String(b.when).localeCompare(String(a.when)))
    .slice(0, args.limit ?? 10);

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search",
    patientId: source.patient_id, action: "search",
    detail: `Case memory: similar to encounter ${source.id}`, route: "/practice/case-memory",
  });

  return {
    source: {
      id: source.id,
      ageBand: ageBand(sourcePatient?.birth_date ?? null, sourcePatient?.age_estimate_years ?? null),
      sex: sourceSex,
      diagnoses: ((sourceDx ?? []) as any[]).map(d => d.label),
      procedures: ((sourceProc ?? []) as any[]).map(p => p.label),
    },
    cases,
    identified,
    matchedNothing: false,
    // The doctrine, in the payload, so a client cannot render a score it was never given.
    similarityScored: false,
  };
}

// ── LEARNING POINTS ──────────────────────────────────────────────────────────────────────────────────

export async function captureLearning(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; kind: string; body: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!LEARNING_KINDS.some(([k]) => k === args.kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `kind must be one of: ${LEARNING_KINDS.map(([k]) => k).join(", ")}` };

  const body = args.body.trim();
  // TWENTY CHARACTERS, ENFORCED IN THE DATABASE TOO. "Good case" is not a learning point, and a lifelong
  // memory filled with one-word notes is one nobody reads twice.
  if (body.length < 20)
    return {
      ok: false, status: 400, code: "TOO_SHORT",
      message: "write what you actually learned -- this is meant to be worth reading in two years",
    };

  const { data: enc } = await admin.from("practice_encounter")
    .select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data, error } = await admin.from("practice_case_learning").insert({
    workspace_id: ctx.workspaceId, encounter_id: enc.id, patient_id: enc.patient_id,
    author_id: ctx.userId, kind: args.kind, body,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.learning_captured",
    // The KIND, never the body: a learning point can name a patient, and the workspace trail is
    // readable by anybody holding access.review.
    payload: { learningId: data.id, encounterId: enc.id, kind: args.kind },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Learning points, newest first.
 *
 * A LEARNING POINT IS ITS AUTHOR'S. Two clinicians can take different lessons from one consultation and
 * both are real. `mine` filters to the caller's own; without it the practice's are shown, because a
 * lesson somebody wrote down is worth more shared than hoarded -- but it is always attributed.
 */
export async function listLearning(admin: any, ctx: WorkspaceContext, opts: {
  mine?: boolean; encounterId?: string; kind?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_case_learning")
    .select("id, encounter_id, patient_id, author_id, kind, body, created_at")
    .eq("workspace_id", ctx.workspaceId);
  if (opts.mine) q = q.eq("author_id", ctx.userId);
  if (opts.encounterId) q = q.eq("encounter_id", opts.encounterId);
  if (opts.kind) q = q.eq("kind", opts.kind);

  const { data } = await q.order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: profiles } = await admin.from("profiles")
    .select("id, full_name").in("id", [...new Set(rows.map(r => r.author_id))]);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
  const labelOf = Object.fromEntries(LEARNING_KINDS.map(([k, l]) => [k, l])) as Record<string, string>;

  return rows.map(r => ({
    ...r,
    authorName: nameOf.get(r.author_id) ?? null,
    kindLabel: labelOf[r.kind] ?? r.kind,
    mine: r.author_id === ctx.userId,
    href: `/practice/encounters/${r.encounter_id}`,
  }));
}

export async function deleteLearning(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  const { data: l } = await admin.from("practice_case_learning")
    .select("id, author_id").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!l) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // Somebody else's lesson is not yours to remove, even shared.
  if (l.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's learning point" };

  await admin.from("practice_case_learning").delete().eq("id", l.id);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.learning_deleted",
    payload: { learningId: l.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

// ── COLLECTIONS ──────────────────────────────────────────────────────────────────────────────────────

export async function listCollections(admin: any, ctx: WorkspaceContext) {
  const { data } = await admin.from("practice_case_collection")
    .select("id, owner_id, name, description, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .or(`owner_id.is.null,owner_id.eq.${ctx.userId}`)
    .order("name");
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: members } = await admin.from("practice_case_collection_member")
    .select("collection_id").in("collection_id", rows.map(r => r.id));
  const counts = new Map<string, number>();
  for (const m of ((members ?? []) as any[])) counts.set(m.collection_id, (counts.get(m.collection_id) ?? 0) + 1);

  return rows.map(r => ({
    ...r,
    cases: counts.get(r.id) ?? 0,
    scope: r.owner_id === null ? "practice" : "personal",
    mine: r.owner_id === ctx.userId,
  }));
}

export async function createCollection(admin: any, ctx: WorkspaceContext, args: {
  name: string; description?: string; shared?: boolean; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const name = args.name.trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a collection needs a name" };

  const { data, error } = await admin.from("practice_case_collection").insert({
    workspace_id: ctx.workspaceId, owner_id: args.shared ? null : ctx.userId,
    name, description: args.description?.trim() || null, created_by: ctx.userId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "NAME_IN_USE", message: `there is already a collection called "${name}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { ok: true, data: { id: data.id as string } };
}

export async function addToCollection(admin: any, ctx: WorkspaceContext, args: {
  collectionId: string; encounterId: string; note?: string;
}): Promise<EngineResult<{ added: boolean }>> {
  const { data: c } = await admin.from("practice_case_collection")
    .select("id, owner_id").eq("id", args.collectionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!c) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // A personal shelf is one person's. A shared one is the practice's and anybody may file into it.
  if (c.owner_id !== null && c.owner_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's collection" };

  const { data: enc } = await admin.from("practice_encounter")
    .select("id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { error } = await admin.from("practice_case_collection_member").insert({
    workspace_id: ctx.workspaceId, collection_id: c.id, encounter_id: enc.id,
    note: args.note?.trim() || null, added_by: ctx.userId,
  });
  // ADDING A CASE TWICE IS A CLICK, NOT AN INTENTION. The unique index refuses it; that is reported as
  // "already there" rather than as a failure, because the caller's intent is satisfied either way.
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { ok: true, data: { added: false } };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { ok: true, data: { added: true } };
}

/** One collection's cases, de-identified on the same rule as retrieval. */
export async function collectionCases(admin: any, ctx: WorkspaceContext, collectionId: string) {
  const { data: c } = await admin.from("practice_case_collection")
    .select("id, owner_id, name, description").eq("id", collectionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!c) return null;
  if (c.owner_id !== null && c.owner_id !== ctx.userId) return null;

  const { data: members } = await admin.from("practice_case_collection_member")
    .select("encounter_id, note, added_at").eq("collection_id", c.id).order("added_at", { ascending: false });
  const rows = (members ?? []) as any[];
  if (rows.length === 0) return { collection: c, cases: [] };

  const { data: encounters } = await admin.from("practice_encounter")
    .select("id, patient_id, started_at, reason_for_visit, status")
    .eq("workspace_id", ctx.workspaceId).in("id", rows.map(r => r.encounter_id));
  const encById = new Map(((encounters ?? []) as any[]).map(e => [e.id, e]));

  const identified = hasCapability(ctx, "patient.view");
  const { data: patients } = identified
    ? await admin.from("practice_patient").select("id, display_name")
      .in("id", [...new Set(((encounters ?? []) as any[]).map(e => e.patient_id))])
    : { data: [] };
  const nameOf = new Map(((patients ?? []) as any[]).map(p => [p.id, p.display_name]));

  return {
    collection: c,
    identified,
    cases: rows.map(r => {
      const e = encById.get(r.encounter_id);
      return {
        encounterId: r.encounter_id, note: r.note, addedAt: r.added_at,
        when: e?.started_at ?? null, reason: e?.reason_for_visit ?? null, status: e?.status ?? null,
        patientName: identified ? (nameOf.get(e?.patient_id) ?? null) : null,
        href: `/practice/encounters/${r.encounter_id}`,
      };
    }),
  };
}

/**
 * The Case Memory dashboard.
 *
 * COUNTS, AND THE COMP'S FOUR PERCENTAGES ARE ABSENT. It prints "Best outcome rate 92%", "Most frequent
 * complication 3.2%", "Avg. follow-up compliance 84%" and a "Most common condition 28%". Every one is a
 * rate; the conditions and complications underneath them are real and are what render.
 */
export async function caseMemoryDashboard(admin: any, ctx: WorkspaceContext) {
  const [{ count: encounters }, { count: learnings }, collections, { data: diagnoses }] = await Promise.all([
    admin.from("practice_encounter").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    admin.from("practice_case_learning").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    listCollections(admin, ctx),
    admin.from("practice_diagnosis").select("label").eq("workspace_id", ctx.workspaceId).limit(2000),
  ]);

  const byLabel = new Map<string, number>();
  for (const d of ((diagnoses ?? []) as any[])) {
    const k = String(d.label).trim();
    byLabel.set(k, (byLabel.get(k) ?? 0) + 1);
  }

  return {
    cases: encounters ?? 0,
    learnings: learnings ?? 0,
    collections: collections.length,
    casesInCollections: collections.reduce((n, c) => n + c.cases, 0),
    topConditions: [...byLabel.entries()]
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total).slice(0, 8),
    distinctConditions: byLabel.size,
    similarityScored: false,
  };
}
