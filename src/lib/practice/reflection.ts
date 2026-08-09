import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { createTask } from "@/lib/practice/tasks";
import { captureLearning } from "@/lib/practice/case-memory";

// CPR-230 CLINICAL REFLECTION.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE NEW TABLE, NOT SIX. Three of the specification's data-model objects already exist:
//   Learning Point     -> practice_case_learning (CPR-220)
//   Improvement Action -> practice_task (CPR-340), which already has an owner, a date and a board
//   Competency / Portfolio links -> CPR-250 and CPR-240, both unbuilt and named as gaps
//
// PRIVATE BY DEFAULT. "What could I have done better" is not written honestly into a box a practice
// partner reads by default. Sharing is a deliberate act, one reflection at a time.
//
// NO STREAK, AND NO SCORE. The comp shows "Reflection Streak: 12 days -- Keep it going!" and a "Growth
// Score 82/100", plus four bars claiming reflection improved this clinician's decisions and their
// patients' outcomes by measured percentages. A streak rewards the act rather than the substance and
// produces entries written to keep a number alive; the scores measure something no text box can.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THE FOUR PROMPTS NEED NO MODEL. The comp's "AI Reflection Assistant" offers to generate them, and the
// four it shows -- what went well, what could I have done differently, what did I learn, what will I do
// next time -- are the same four questions every time. Generating a fixed string would spend a
// disclosure of patient data to produce something that could be a constant. It is a constant.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const REFLECTION_CATEGORIES = [
  ["clinical_outcome", "Clinical outcome"],
  ["decision_making", "Decision making"],
  ["patient_communication", "Patient communication"],
  ["systems_process", "Systems and process"],
  ["professional_growth", "Professional growth"],
] as const;

/**
 * The four prompts, as constants.
 *
 * Deliberately phrased in the first person and in the past tense: a prompt reading "What went well?"
 * invites an account of the consultation, and "What did I do well?" invites an account of oneself.
 * Reflection that is useful later is about the second.
 */
export const REFLECTION_PROMPTS = [
  { field: "went_well", label: "What went well", hint: "The thing you would do the same way again." },
  { field: "could_improve", label: "What could have gone better", hint: "Written for you, not for a reviewer." },
  { field: "learned", label: "What you learned", hint: "The part worth sharing, if you choose to." },
  { field: "will_do_differently", label: "What you will do differently", hint: "If it needs doing, make it an action." },
] as const;

/**
 * What this module does not claim.
 *
 * THE LEGAL ONE MATTERS MOST. The comp's footer says "Personal & Private -- Your reflections are
 * secure". Private within this product, yes. But a written reflection is a record, and records are
 * disclosable in professional and legal proceedings in most jurisdictions; a practitioner who believed
 * otherwise because a page said "secure" would have been misled by this product into writing something
 * they would not otherwise have written. Said plainly, on the page.
 */
export const REFLECTION_LIMITS = [
  {
    key: "privilege",
    label: "Private is not privileged",
    detail: "Your reflections are private inside this practice -- nobody else here can read one unless you share it. That is not the same as legally protected. A written reflection is a record, and records can be requested in professional or legal proceedings. Write honestly, and write knowing that.",
  },
  {
    key: "streak",
    label: "Nothing counts how many days in a row you reflected",
    detail: "The design shows a streak with a flame. A streak rewards writing something rather than writing something true, and it punishes a week of nights or a fortnight of leave. There is no such counter and no column for one.",
  },
  {
    key: "impact",
    label: "No score, and no measured effect on your patients",
    detail: "The design shows a Growth Score out of 100, and bars reading Better Decisions 82%, Improved Outcomes 78%. Nothing here measures whether reflecting changed a decision or an outcome, and a number implying it did would be an invention about your clinical performance.",
  },
  {
    key: "competency",
    label: "Nothing is sent to a competency or portfolio record yet",
    detail: "The specification links reflections to both. Those modules are not built, so a reflection contributes to neither -- said here rather than shown as an empty panel that looks broken.",
  },
] as const;

export type ReflectionInput = {
  encounterId?: string | null; procedureId?: string | null; category?: string;
  wentWell?: string; couldImprove?: string; learned?: string; willDoDifferently?: string; narrative?: string;
};

const FIELDS = ["wentWell", "couldImprove", "learned", "willDoDifferently", "narrative"] as const;
const COLUMN: Record<string, string> = {
  wentWell: "went_well", couldImprove: "could_improve", learned: "learned",
  willDoDifferently: "will_do_differently", narrative: "narrative",
};

function substance(input: ReflectionInput): number {
  return FIELDS.reduce((n, f) => n + (input[f] ?? "").trim().length, 0);
}

export async function writeReflection(admin: any, ctx: WorkspaceContext, args: ReflectionInput & {
  correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  // TWENTY CHARACTERS ACROSS ALL FIVE BOXES, matched by a database constraint. An empty reflection would
  // still count towards "28 this period", which is the streak's failure arriving through the back door.
  if (substance(args) < 20)
    return {
      ok: false, status: 400, code: "TOO_SHORT",
      message: "write something you would want to read back -- an empty reflection still counts on a page somewhere",
    };
  if (args.category && !REFLECTION_CATEGORIES.some(([c]) => c === args.category))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown category: ${args.category}` };

  // A reflection may name a consultation, and naming one in another practice would disclose that it
  // exists.
  for (const [table, id] of [
    ["practice_encounter", args.encounterId], ["practice_procedure", args.procedureId],
  ] as const) {
    if (!id) continue;
    const { data } = await admin.from(table).select("id").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const { data, error } = await admin.from("practice_reflection").insert({
    workspace_id: ctx.workspaceId, author_id: ctx.userId,
    encounter_id: args.encounterId ?? null, procedure_id: args.procedureId ?? null,
    category: args.category ?? "clinical_outcome",
    went_well: args.wentWell?.trim() || null,
    could_improve: args.couldImprove?.trim() || null,
    learned: args.learned?.trim() || null,
    will_do_differently: args.willDoDifferently?.trim() || null,
    narrative: args.narrative?.trim() || null,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reflection_written",
    // THE FACT, NEVER THE TEXT. The workspace audit trail is readable by anybody holding access.review,
    // and a reflection is the one record in this product written on the assumption nobody else reads it.
    payload: { reflectionId: data.id, category: args.category ?? "clinical_outcome", encounterId: args.encounterId ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Revise a reflection. Snapshots the previous text first.
 *
 * APPEND-ONLY SNAPSHOTS, the shape CPR-130 settled for notes: "what did this say before I revised it"
 * matters most for exactly the entries somebody later wishes they had worded differently.
 */
export async function reviseReflection(admin: any, ctx: WorkspaceContext, args: ReflectionInput & {
  id: string; correlationId: string;
}): Promise<EngineResult<{ version: number }>> {
  const { data: current } = await admin.from("practice_reflection")
    .select("*").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!current) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (current.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's reflection" };
  // Section 5: editable UNTIL LOCKED. After that it is a fixed account of what they thought at the time.
  if (current.locked_at)
    return { ok: false, status: 409, code: "LOCKED", message: "you locked this reflection -- it cannot be edited now" };

  const merged: ReflectionInput = {
    wentWell: args.wentWell ?? current.went_well ?? "",
    couldImprove: args.couldImprove ?? current.could_improve ?? "",
    learned: args.learned ?? current.learned ?? "",
    willDoDifferently: args.willDoDifferently ?? current.will_do_differently ?? "",
    narrative: args.narrative ?? current.narrative ?? "",
  };
  if (substance(merged) < 20)
    return { ok: false, status: 400, code: "TOO_SHORT", message: "a revision cannot empty the reflection" };

  const { count } = await admin.from("practice_reflection_version")
    .select("*", { count: "exact", head: true }).eq("reflection_id", current.id);
  const version = (count ?? 0) + 1;

  // THE SNAPSHOT IS TAKEN BEFORE THE UPDATE, and its failure is fatal to the revision. Writing the new
  // text first and the history afterwards would lose the old wording whenever the second write failed.
  const { error: snapshotError } = await admin.from("practice_reflection_version").insert({
    workspace_id: ctx.workspaceId, reflection_id: current.id, version,
    went_well: current.went_well, could_improve: current.could_improve, learned: current.learned,
    will_do_differently: current.will_do_differently, narrative: current.narrative,
    category: current.category, captured_by: ctx.userId,
  });
  if (snapshotError)
    return { ok: false, status: 500, code: "HISTORY_FAILED", message: `the previous wording could not be kept, so nothing was changed: ${snapshotError.message}` };

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  for (const f of FIELDS) if (args[f] !== undefined) patch[COLUMN[f]] = args[f]!.trim() || null;
  if (args.category) patch.category = args.category;

  const { error } = await admin.from("practice_reflection").update(patch).eq("id", current.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  return { ok: true, data: { version } };
}

/** Lock it. The practitioner's act, never the system's -- see the migration header. */
export async function lockReflection(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ lockedAt: string }>> {
  const { data: r } = await admin.from("practice_reflection")
    .select("id, author_id, locked_at").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (r.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's reflection" };
  if (r.locked_at) return { ok: true, data: { lockedAt: r.locked_at as string } };

  const lockedAt = nowIso();
  const { data: updated, error } = await admin.from("practice_reflection")
    .update({ locked_at: lockedAt, updated_at: lockedAt }).eq("id", r.id).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reflection_locked",
    payload: { reflectionId: r.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { lockedAt } };
}

/**
 * Share it with the practice, or take it back.
 *
 * TAKING IT BACK DOES NOT UNRING THE BELL, and the engine says so rather than implying it does: a
 * colleague who read it still read it. What un-sharing does is stop it being listed from now on.
 */
export async function setReflectionVisibility(admin: any, ctx: WorkspaceContext, args: {
  id: string; visibility: "private" | "practice"; correlationId: string;
}): Promise<EngineResult<{ visibility: string; alreadySeenByOthers: boolean }>> {
  const { data: r } = await admin.from("practice_reflection")
    .select("id, author_id, visibility").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (r.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's reflection" };

  const { error } = await admin.from("practice_reflection")
    .update({ visibility: args.visibility, updated_at: nowIso() }).eq("id", r.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.reflection_visibility",
    payload: { reflectionId: r.id, from: r.visibility, to: args.visibility }, correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: { visibility: args.visibility, alreadySeenByOthers: r.visibility === "practice" && args.visibility === "private" },
  };
}

/** An improvement action is a TASK. This is a thin bridge, not a second work system. */
export async function commitToAction(admin: any, ctx: WorkspaceContext, args: {
  reflectionId: string; title: string; detail?: string; dueOn?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const { data: r } = await admin.from("practice_reflection")
    .select("id, author_id").eq("id", args.reflectionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (r.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's reflection" };

  // ASSIGNED TO THEMSELVES, ALWAYS. An improvement action is a commitment about one's own practice;
  // there is no parameter for assigning your reflection's action to a colleague, because that would be
  // an ordinary task and the tasks page already creates those.
  return createTask(admin, {
    workspaceId: ctx.workspaceId, title: args.title, detail: args.detail,
    assignedTo: ctx.userId, reflectionId: r.id, category: "improvement",
    dueOn: args.dueOn ?? null, actorId: ctx.userId, correlationId: args.correlationId,
  });
}

/**
 * Promote something learned into the practice's case memory.
 *
 * THE DELIBERATE CROSSING FROM PRIVATE TO SHARED. It is not automatic and it is not a side effect of
 * writing the reflection: the two have different audiences, and a product that quietly published one as
 * the other would teach practitioners not to write honestly in either.
 */
export async function promoteLearning(admin: any, ctx: WorkspaceContext, args: {
  reflectionId: string; kind: string; body: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const { data: r } = await admin.from("practice_reflection")
    .select("id, author_id, encounter_id").eq("id", args.reflectionId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (r.author_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's reflection" };
  // CPR-220's learning points hang off a consultation, so a reflection with no encounter has nothing to
  // hang one on. Said rather than silently filed against nothing.
  if (!r.encounter_id)
    return {
      ok: false, status: 400, code: "NO_ENCOUNTER",
      message: "this reflection is not about a particular consultation, so there is no case to file the learning against",
    };

  const created = await captureLearning(admin, ctx, {
    encounterId: r.encounter_id, kind: args.kind, body: args.body, correlationId: args.correlationId,
  });
  if (!created.ok) return created;

  await admin.from("practice_case_learning").update({ reflection_id: r.id }).eq("id", created.data.id);
  return created;
}

// ── READING ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The caller's own reflections, plus any a colleague chose to share.
 *
 * PRIVACY IS ENFORCED IN THE QUERY, NOT AFTER IT. Two queries rather than an `.or()` across the author
 * and the visibility, for the reason this codebase has written down twice: a PostgREST or-filter of that
 * shape is easy to write in a way that matches every row.
 */
export async function listReflections(admin: any, ctx: WorkspaceContext, opts: {
  mineOnly?: boolean; encounterId?: string; category?: string; limit?: number;
} = {}) {
  const shape = "id, author_id, encounter_id, procedure_id, category, went_well, could_improve, learned, will_do_differently, narrative, visibility, locked_at, created_at, updated_at";
  const limit = opts.limit ?? 50;

  let own = admin.from("practice_reflection").select(shape)
    .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId);
  if (opts.encounterId) own = own.eq("encounter_id", opts.encounterId);
  if (opts.category) own = own.eq("category", opts.category);
  const { data: mine } = await own.order("created_at", { ascending: false }).limit(limit);

  let shared: any[] = [];
  if (!opts.mineOnly) {
    let q = admin.from("practice_reflection").select(shape)
      .eq("workspace_id", ctx.workspaceId).eq("visibility", "practice").neq("author_id", ctx.userId);
    if (opts.encounterId) q = q.eq("encounter_id", opts.encounterId);
    if (opts.category) q = q.eq("category", opts.category);
    const { data } = await q.order("created_at", { ascending: false }).limit(limit);
    shared = (data ?? []) as any[];
  }

  const rows = [...((mine ?? []) as any[]), ...shared]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
  if (rows.length === 0) return [];

  const { data: profiles } = await admin.from("profiles")
    .select("id, full_name").in("id", [...new Set(rows.map(r => r.author_id))]);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
  const labelOf = Object.fromEntries(REFLECTION_CATEGORIES.map(([k, l]) => [k, l])) as Record<string, string>;

  return rows.map(r => ({
    ...r,
    mine: r.author_id === ctx.userId,
    authorName: r.author_id === ctx.userId ? "You" : (nameOf.get(r.author_id) ?? "A colleague"),
    categoryLabel: labelOf[r.category] ?? r.category,
    locked: !!r.locked_at,
    href: r.encounter_id ? `/practice/encounters/${r.encounter_id}` : null,
  }));
}

export async function getReflection(admin: any, ctx: WorkspaceContext, id: string) {
  const { data: r } = await admin.from("practice_reflection")
    .select("*").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!r) return null;
  // Somebody else's private reflection is a 404, not a 403: "you may not read it" confirms it exists.
  if (r.author_id !== ctx.userId && r.visibility !== "practice") return null;

  const [{ data: versions }, { data: actions }, { data: learnings }] = await Promise.all([
    // HISTORY IS THE AUTHOR'S OWN. A shared reflection shows what it says now; what it said before they
    // revised it is not part of what they chose to share.
    r.author_id === ctx.userId
      ? admin.from("practice_reflection_version").select("version, captured_at, went_well, could_improve, learned, will_do_differently, narrative")
        .eq("reflection_id", r.id).order("version", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from("practice_task").select("id, title, status, due_on, category").eq("reflection_id", r.id),
    admin.from("practice_case_learning").select("id, kind, body, created_at").eq("reflection_id", r.id),
  ]);

  return {
    reflection: r,
    mine: r.author_id === ctx.userId,
    locked: !!r.locked_at,
    versions: (versions ?? []) as any[],
    actions: (actions ?? []) as any[],
    learnings: (learnings ?? []) as any[],
  };
}

/**
 * The journal summary.
 *
 * COUNTS, AND THE COMP'S SIX HEADLINE FIGURES ARE FIVE RATES AND A STREAK. "28 reflections, up 21% vs
 * last 30 days", "65% completion rate", "12-day streak", "Growth Score 82/100" -- what is left when
 * those go is a count of what you wrote, a count of what you committed to, and how many of those you
 * finished, which is the only one of the six that tells you anything to do.
 */
export async function reflectionJournal(admin: any, ctx: WorkspaceContext) {
  const { data: mine } = await admin.from("practice_reflection")
    .select("id, category, visibility, locked_at, created_at, encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId);
  const rows = (mine ?? []) as any[];

  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
  const labelOf = Object.fromEntries(REFLECTION_CATEGORIES.map(([k, l]) => [k, l])) as Record<string, string>;

  const [{ data: actions }, { count: learnings }] = await Promise.all([
    admin.from("practice_task").select("id, status").eq("workspace_id", ctx.workspaceId)
      .eq("assigned_to", ctx.userId).eq("category", "improvement"),
    admin.from("practice_case_learning").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId).not("reflection_id", "is", null),
  ]);
  const actionRows = (actions ?? []) as any[];

  return {
    reflections: rows.length,
    shared: rows.filter(r => r.visibility === "practice").length,
    locked: rows.filter(r => r.locked_at).length,
    aboutAConsultation: rows.filter(r => r.encounter_id).length,
    byCategory: REFLECTION_CATEGORIES.map(([key, label]) => ({ key, label, total: byCategory.get(key) ?? 0 }))
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total),
    actions: {
      committed: actionRows.length,
      // A COUNT AND ITS DENOMINATOR. The comp writes "65% completion rate".
      done: actionRows.filter(a => a.status === "DONE").length,
      open: actionRows.filter(a => a.status !== "DONE" && a.status !== "CANCELLED").length,
    },
    learningsShared: learnings ?? 0,
    // The doctrine, in the payload, so no client can render either of them.
    streakCounted: false,
    growthScored: false,
    limits: REFLECTION_LIMITS,
    categoryLabels: labelOf,
  };
}
