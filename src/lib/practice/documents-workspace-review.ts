import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { createTask } from "@/lib/practice/tasks";
import { LIVE_TASK_STATUSES } from "@/lib/practice/task-constants";
import { classifyIncoming, documentRegister, applyFilter, type DocumentRow, type Reading } from "@/lib/practice/documents-workspace";
import {
  DOC_BULK_LIMIT, DOC_EXPORT_COLUMNS, DOC_ORIGIN, DOC_PERMISSION_ROWS, DOC_REVIEW_CATEGORY,
  DOC_SAVED_VIEWS, DOC_STATUS, DOC_TYPE_LABEL, csvRow,
  type DocFilter,
} from "@/lib/practice/documents-workspace-constants";

// CPR-DOC-002 DOCUMENTS WORKSPACE, PHASE 3 (s20): REVIEW QUEUES, DOCUMENT TASKS, SAVED VIEWS, BULK
// OPERATIONS and the PERMISSION PICTURE. AI drafting is the other half of Phase 3 and lives in
// documents-workspace-ai.ts, because it has an entirely different failure mode.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ AS IN BOTH EARLIER PHASES, MOST OF WHAT s20 ASKS FOR ALREADY EXISTED UNDER ANOTHER NAME. Nothing
// here rebuilds any of it and NOTHING HERE WRITES A MIGRATION:
//
//   the task object          practice_task            migration 198, and it CARRIES document_id
//   the task trail           practice_task_event      198, immutable, with reassignment visible
//   the task engine          createTask / transitionTask / reassignTask        tasks.ts
//   the task board           /practice/tasks          CPR-340 built it, and this workspace LINKS to it
//   the arrival review state RECEIVED/REVIEWED/ACTIONED + reviewed_by/at       migration 200
//   the arrival review write reviewIncoming / actionIncoming                   communication.ts
//   the filters              applyFilter + parseDocFilter                      Phase 1
//
// s15's DocumentReview asks for (document_id, reviewer_id, status, comments, assigned_at, completed_at).
// A practice_task row carries document_id, assigned_to, status, detail, created_at and closed_at. That
// is the same entity with better columns and a trail, so building a second one would be building a
// second half of the truth about who owes what.
//
// ⚠ THE ONE THING PHASE 3 CANNOT DO, AND IT IS NAMED RATHER THAN WORKED AROUND.
//
// practice_task has patient_id, encounter_id, document_id, follow_up_id and reflection_id. IT HAS NO
// incoming_document_id. So the single queue in this product that most obviously needs an owner -- "a
// result arrived and nobody has looked at it", which migration 200's own header calls the missed-result
// harm -- is the one queue that cannot be assigned to a person.
//
// TWO WRONG WAYS TO CLOSE THAT WITHOUT A MIGRATION WERE AVAILABLE AND BOTH ARE REFUSED HERE:
//
//   POINT THE TASK AT THE PATIENT INSTEAD. Then a task saying "review the lab result" points at a
//   person rather than at the result, two results for the same patient produce two identical tasks, and
//   an arrival with NO patient link -- which is precisely the arrival most in need of somebody --
//   produces a task pointing at nothing at all.
//
//   PUT THE ARRIVAL'S ID IN THE TITLE OR THE DETAIL TEXT. A foreign key written as prose. It cannot be
//   joined, it cannot be indexed, and it does not become null when the arrival is deleted -- so the
//   register would keep showing work about a document that no longer exists.
//
// WHAT WOULD CLOSE IT, PRECISELY, FOR WHOEVER WRITES MIGRATION 256:
//
//   alter table practice_task
//     add column if not exists incoming_document_id uuid
//     references practice_incoming_document(id) on delete set null;
//   create index if not exists idx_practice_task_incoming
//     on practice_task(incoming_document_id) where incoming_document_id is not null;
//
//   -- on delete set null, matching the other four references on this table, for migration 198's stated
//   -- reason: "a task outliving its subject is a loose end somebody should close, and silently deleting
//   -- it would hide that."
//
// createTask() would then need `incoming_document_id` adding to its subject-resolution loop (the one
// that already refuses a subject belonging to another workspace) and to its insert. Until that exists,
// the arrivals queue below is rendered as THE PRACTICE'S, it says so in those words, and no assign
// control is drawn over it. An unassignable queue drawn with a disabled assign button would be worse
// than one drawn honestly without.
//
// ⚠ AND THE SECOND STORE PHASE 3 DOES NOT HAVE: A USER-AUTHORED SAVED VIEW. s10 says "saved views" and
// this file ships FIVE NAMED STANDARD ONES, declared in constants, each a filter the register already
// applies. A view a user creates and names is a different thing and needs a table -- workspace_id,
// user_id, name, the filter as jsonb, a shared flag, created_at -- plus a rule about what happens to
// somebody else's shared view when they leave. That is a specification and a migration, not a column,
// and it is not invented here.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const TASK_LIMIT = 200;

/* ── THE QUEUES ──────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ EVERY LIST ON THIS PAGE IS A `Reading`, AND THE THREE STATES REACH THE SCREEN SEPARATELY.
 *
 * A review queue that cannot read its source MUST NOT RENDER AS AN EMPTY QUEUE. "There is nothing to
 * review" tells a practitioner to stop looking; "we could not look" tells them to look somewhere else.
 * They are different sentences and this engine never collapses them, which is why not one function below
 * ends in `?? []`.
 */

export type ReviewTaskRow = {
  id: string;
  title: string;
  detail: string | null;
  documentId: string;
  /** Null when the document behind the task could not be read -- NOT the string "Unknown". */
  documentTitle: string | null;
  documentStored: string | null;
  assignedTo: string;
  assigneeName: string | null;
  /** ⚠ Work sitting with somebody who can no longer open the app is work nobody is doing. */
  assigneeActive: boolean;
  status: string;
  priority: string;
  dueOn: string | null;
  overdue: boolean;
  createdAt: string;
  href: string;
};

export type SavedViewCount = {
  key: string;
  label: string;
  blurb: string;
  href: string;
  tone: "sky" | "amber" | "rose" | "violet";
  count: Reading<number>;
};

export type PermissionRow = {
  capability: string;
  label: string;
  blurb: string;
  /** The members of THIS practice who hold it right now. A list of names, and its own length. */
  holders: string[];
  /** ⚠ True when nobody in this practice holds it. Said out loud rather than drawn as an empty cell. */
  nobody: boolean;
};

export type DocumentsReview = {
  views: SavedViewCount[];
  /** s10's "Awaiting my review", and the only queue in this workspace that anybody owns. */
  assignedToMe: Reading<ReviewTaskRow[]>;
  /** The same work, with somebody else's name on it. Named, not hidden. */
  assignedToOthers: Reading<ReviewTaskRow[]>;
  /** s14's "incoming patient document awaiting review". THE PRACTICE'S, because it cannot be assigned. */
  arrivals: Reading<DocumentRow[]>;
  /** s4's unlinked pile, which is where the bulk classify acts. */
  unlinked: Reading<DocumentRow[]>;
  /** s14's "draft awaiting signature". */
  unsigned: Reading<DocumentRow[]>;
  /** Active members, for the assign control. Empty is impossible; a failure is not an empty list. */
  members: Reading<{ userId: string; name: string }[]>;
  permissions: Reading<PermissionRow[]>;
  /** A source that returned exactly its limit, so the page can say so rather than imply completeness. */
  truncated: string[];
  today: string;
  timezone: string;
};

/**
 * Active members of this practice, with names.
 *
 * ⚠ NOT tasks.ts's listMembers(), AND THE DIFFERENCE IS THE POINT. That one ends `return (data ?? [])`,
 * which is correct for a board that degrades to "no assignee names" and wrong for the control that
 * decides WHO A REVIEW IS GIVEN TO. A select rendered from a failed read shows an empty list of
 * colleagues, and the reader concludes they work alone.
 */
export async function reviewMembers(
  admin: any, workspaceId: string,
): Promise<Reading<{ userId: string; name: string }[]>> {
  const { data, error } = await admin.from("practice_membership")
    .select("user_id, role_code").eq("workspace_id", workspaceId).eq("status", "active");
  if (error) return { state: "unreadable", detail: String(error.message) };

  const ids = [...new Set(((data ?? []) as any[]).map(m => m.user_id as string))];
  if (ids.length === 0) return { state: "ok", value: [] };

  const { data: people, error: peopleError } = await admin.from("profiles")
    .select("id, full_name").in("id", ids);
  // A name that could not be read is not a member who does not exist. The person is still there and
  // still assignable, so the list keeps them and says the name is missing rather than dropping the row.
  if (peopleError) return { state: "ok", value: ids.map(id => ({ userId: id, name: "(name could not be read)" })) };

  const nameOf = new Map(((people ?? []) as any[]).filter(p => !!p.full_name).map(p => [p.id as string, p.full_name as string]));
  return { state: "ok", value: ids.map(id => ({ userId: id, name: nameOf.get(id) ?? "(no name recorded)" })) };
}

/**
 * s15's DocumentTask, read.
 *
 * ⚠ document_id NOT NULL IS THE WHOLE FILTER. practice_task holds every piece of work in this practice --
 * chase the lab, order dressings, fill in the insurance form. This workspace shows the ones that are
 * ABOUT A DOCUMENT and links to /practice/tasks for the rest, rather than growing a second task board
 * that would show a different subset of the same table.
 */
export async function documentTasks(
  admin: any, workspaceId: string, today: string,
): Promise<Reading<ReviewTaskRow[]>> {
  const { data, error } = await admin.from("practice_task")
    .select("id, title, detail, document_id, assigned_to, status, priority, due_on, created_at")
    .eq("workspace_id", workspaceId).not("document_id", "is", null)
    .in("status", LIVE_TASK_STATUSES)
    .order("due_on", { nullsFirst: false }).order("created_at", { ascending: false })
    .limit(TASK_LIMIT);
  if (error) return { state: "unreadable", detail: String(error.message) };

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return { state: "ok", value: [] };

  const documentIds = [...new Set(rows.map(r => r.document_id as string))];
  const { data: docs, error: docError } = await admin.from("practice_clinical_document")
    .select("id, title, status").eq("workspace_id", workspaceId).in("id", documentIds);
  // ⚠ A TASK WHOSE DOCUMENT COULD NOT BE READ IS STILL A TASK SOMEBODY OWES. It keeps its place with a
  // null title, rather than the whole queue failing or the row quietly vanishing.
  const docById = docError
    ? new Map<string, any>()
    : new Map(((docs ?? []) as any[]).map(d => [d.id as string, d]));

  const members = await reviewMembers(admin, workspaceId);
  const active = members.state === "ok" ? new Set(members.value.map(m => m.userId)) : null;
  const nameOf = members.state === "ok" ? new Map(members.value.map(m => [m.userId, m.name])) : new Map<string, string>();

  return {
    state: "ok",
    value: rows.map(r => {
      const doc = docById.get(r.document_id as string);
      return {
        id: r.id as string,
        title: r.title as string,
        detail: (r.detail ?? null) as string | null,
        documentId: r.document_id as string,
        documentTitle: (doc?.title ?? null) as string | null,
        documentStored: (doc?.status ?? null) as string | null,
        assignedTo: r.assigned_to as string,
        assigneeName: nameOf.get(r.assigned_to as string) ?? null,
        // ⚠ WHEN MEMBERSHIP COULD NOT BE READ, NOBODY IS MARKED INACTIVE. Drawing "this person can no
        // longer open the app" off a failed read is an accusation, and the quiet version of it -- a row
        // silently flagged orphaned -- would send somebody reassigning work that was never stranded.
        assigneeActive: active === null ? true : active.has(r.assigned_to as string),
        status: r.status as string,
        priority: r.priority as string,
        dueOn: (r.due_on ?? null) as string | null,
        overdue: !!r.due_on && (r.due_on as string) < today,
        createdAt: String(r.created_at),
        href: `/practice/documents/${r.document_id}`,
      };
    }),
  };
}

/**
 * The whole Phase 3 page, in one read.
 *
 * ⚠ THE SAVED VIEW COUNTS AND THE QUEUES BELOW THEM ARE THE SAME ROWS THROUGH THE SAME PREDICATE. A card
 * counting one thing while the list under it shows another has shipped twice in this product; the only
 * arrangement in which they cannot differ is the one where there is a single filter.
 */
export async function documentsReview(admin: any, ctx: WorkspaceContext): Promise<DocumentsReview> {
  const register = await documentRegister(admin, ctx.workspaceId);
  const { rows, today, timezone } = register;

  const failed = new Set(register.unreadable.map(u => u.source));
  const reading = (sources: string[], value: number): Reading<number> => {
    const bad = sources.filter(s => failed.has(s));
    return bad.length > 0
      ? { state: "unreadable", detail: `${bad.join(" and ")} could not be read` }
      : { state: "ok", value };
  };
  const rowsOr = (sources: string[], filter: DocFilter): Reading<DocumentRow[]> => {
    const bad = sources.filter(s => failed.has(s));
    return bad.length > 0
      ? { state: "unreadable", detail: `${bad.join(" and ")} could not be read` }
      : { state: "ok", value: applyFilter(rows, filter, today) };
  };

  const [tasks, members, permissions] = await Promise.all([
    documentTasks(admin, ctx.workspaceId, today),
    reviewMembers(admin, ctx.workspaceId),
    documentPermissions(admin, ctx.workspaceId),
  ]);

  const mine: Reading<ReviewTaskRow[]> = tasks.state === "ok"
    ? { state: "ok", value: tasks.value.filter(t => t.assignedTo === ctx.userId) } : tasks;
  const others: Reading<ReviewTaskRow[]> = tasks.state === "ok"
    ? { state: "ok", value: tasks.value.filter(t => t.assignedTo !== ctx.userId) } : tasks;

  // The one view whose rows are not in the register at all. Its source is practice_task, so its three
  // states come from THAT read rather than from the register's -- and when the task read failed the
  // count is unreadable, carrying the database's own words, exactly as every other figure here does.
  const mineCount: Reading<number> = mine.state === "ok"
    ? { state: "ok", value: mine.value.length }
    : { state: mine.state, detail: mine.detail };

  const views: SavedViewCount[] = DOC_SAVED_VIEWS.map(v => ({
    key: v.key, label: v.label, blurb: v.blurb, href: v.href, tone: v.tone,
    count: v.filter === null ? mineCount : reading(v.sources, applyFilter(rows, v.filter, today).length),
  }));

  return {
    views,
    assignedToMe: mine,
    assignedToOthers: others,
    arrivals: rowsOr(["incoming register"], { status: ["awaiting_review"] }),
    unlinked: rowsOr(["incoming register"], { link: "unlinked" }),
    unsigned: rowsOr(["authored documents"], { status: ["draft", "approved"] }),
    members, permissions,
    truncated: register.truncated,
    today, timezone,
  };
}

/* ── s13: WHO IN THIS PRACTICE MAY DO WHAT ───────────────────────────────────────────────────────────
 *
 * ⚠ READ LIVE, FROM THE GRANTS, NOT FROM THE ROLE DEFAULTS. practice_role_capabilities is a global seed
 * of what a role STARTS with. What a person HOLDS is practice_role_assignment, which CPR-310's delegation
 * writes to directly and with a time window. Rendering the seed would show a matrix that is right on the
 * day a practice is created and drifts every time anybody delegates anything.
 *
 * ⚠ THE TIME WINDOW IS EVALUATED ON THE DATABASE'S CLOCK, IN TWO QUERIES, exactly as access.ts does it
 * and for the two reasons access.ts records: a grant made moments ago reads as "starts in the future"
 * when compared against this process's clock, and PostgREST's or-filter with a null test is the shape
 * this codebase has twice written in a way that quietly matched every row.
 */
export async function documentPermissions(
  admin: any, workspaceId: string,
): Promise<Reading<PermissionRow[]>> {
  const { data: memberships, error } = await admin.from("practice_membership")
    .select("id, user_id").eq("workspace_id", workspaceId).eq("status", "active");
  if (error) return { state: "unreadable", detail: String(error.message) };

  const rows = (memberships ?? []) as any[];
  if (rows.length === 0) return { state: "ok", value: DOC_PERMISSION_ROWS.map(r => ({ ...r, holders: [], nobody: true })) };

  const membershipIds = rows.map(m => m.id as string);
  const userOfMembership = new Map(rows.map(m => [m.id as string, m.user_id as string]));

  const [openGrants, endingGrants] = await Promise.all([
    admin.from("practice_role_assignment").select("membership_id, capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").is("effective_to", null),
    admin.from("practice_role_assignment").select("membership_id, capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").gt("effective_to", "now"),
  ]);
  // ⚠ EITHER FAILURE POISONS THE WHOLE MATRIX. Half the grants would draw a picture in which colleagues
  // appear to have lost capabilities they hold -- which is exactly the picture somebody acts on by
  // granting them again.
  if (openGrants?.error || endingGrants?.error)
    return {
      state: "unreadable",
      detail: String(openGrants?.error?.message ?? endingGrants?.error?.message),
    };

  const members = await reviewMembers(admin, workspaceId);
  const nameOf = members.state === "ok" ? new Map(members.value.map(m => [m.userId, m.name])) : new Map<string, string>();

  const holdersOf = new Map<string, Set<string>>();
  for (const g of [...((openGrants?.data ?? []) as any[]), ...((endingGrants?.data ?? []) as any[])]) {
    const userId = userOfMembership.get(g.membership_id as string);
    if (!userId) continue;
    const set = holdersOf.get(g.capability_code as string) ?? new Set<string>();
    set.add(userId);
    holdersOf.set(g.capability_code as string, set);
  }

  return {
    state: "ok",
    value: DOC_PERMISSION_ROWS.map(r => {
      const users = [...(holdersOf.get(r.capability) ?? new Set<string>())];
      const holders = users.map(u => nameOf.get(u) ?? "(name could not be read)").sort();
      return { ...r, holders, nobody: holders.length === 0 };
    }),
  };
}

/* ── s10 / s14: ASSIGNING A REVIEW ───────────────────────────────────────────────────────────────────
 *
 * s14: "Document assigned for review." s15: DocumentReview(document_id, reviewer_id, status, ...).
 *
 * ⚠ THE DOCUMENT'S STATUS DOES NOT MOVE, AND THAT IS ASSERTED RATHER THAN ASSUMED. See
 * DOC_REVIEW_STATUS_NOTE for why borrowing FINAL would have been the wrong answer even if migrations
 * were this agent's to write: FINAL is the only status a signature may be taken from, and "somebody has
 * been asked to look at this" is not "the content is accepted".
 */
export async function assignDocumentReview(admin: any, ctx: WorkspaceContext, args: {
  documentId: string; assignTo: string; note?: string | null; dueOn?: string | null;
  correlationId: string;
}): Promise<EngineResult<{ taskId: string; documentStatusUnchanged: string }>> {
  // ⚠ task.manage, PROBED LIVE AND SEEDED TO ALL THREE WORKING ROLES. NOT document.sign, and not
  // document.author either: asking a colleague to look at a letter is coordination, and requiring the
  // capability to WRITE letters in order to ask somebody to READ one would put the desk's own job behind
  // the clinician's.
  if (!hasCapability(ctx, "task.manage"))
    return {
      ok: false, status: 403, code: "FORBIDDEN",
      message: "you do not hold task.manage in this practice, so you cannot put somebody's name on a piece of work",
    };

  const { data: doc, error: readErr } = await admin.from("practice_clinical_document")
    .select("id, title, status, patient_id")
    .eq("id", args.documentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  // ⚠ A FAILED READ IS NOT A MISSING DOCUMENT. Reporting 404 on a timeout tells somebody the letter they
  // are looking at does not exist.
  if (readErr) return { ok: false, status: 500, code: "READ_FAILED", message: readErr.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // ⚠ A SIGNED DOCUMENT CANNOT BE REVIEWED INTO A DIFFERENT SHAPE. Migration 195's trigger makes a signed
  // body immutable, so a review task against one would be work that cannot produce a change: the only
  // available outcome is an amendment, which is a new document and gets its own task. Refused with the
  // reason rather than accepted and quietly useless.
  if (doc.status !== "DRAFT" && doc.status !== "FINAL")
    return {
      ok: false, status: 422, code: "NOT_REVIEWABLE",
      message: doc.status === "SIGNED" || doc.status === "AMENDED"
        ? "this document is signed, and a signed document cannot be edited -- a correction is an amendment, which becomes a new document with its own review"
        : "this document is marked entered in error, so there is nothing to review",
    };

  const created = await createTask(admin, {
    workspaceId: ctx.workspaceId,
    title: `Review: ${doc.title}`,
    // `undefined`, not null: createTask's own signature takes an optional string and writes null itself.
    detail: args.note?.trim() || undefined,
    assignedTo: args.assignTo,
    documentId: doc.id,
    // The patient is carried so the task appears on that patient's own work, which is the question
    // somebody at the desk asks. It does NOT make the task part of the clinical record -- migration
    // 198's first boundary decision is explicit that a task is not a follow-up.
    patientId: (doc.patient_id ?? null) as string | null,
    category: DOC_REVIEW_CATEGORY,
    priority: "routine",
    dueOn: args.dueOn ?? null,
    actorId: ctx.userId, correlationId: args.correlationId,
  });
  // createTask refuses an assignee who is not an ACTIVE member of this practice, refuses a malformed
  // date, and refuses a document belonging to another workspace. Its refusal is returned as it stands.
  if (!created.ok) return created;

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.document_review_assigned",
    payload: {
      documentId: doc.id, taskId: created.data.id, assignedTo: args.assignTo,
      // ⚠ RECORDED AS EVIDENCE THAT IT DID NOT MOVE. The trail should be able to answer "did asking for
      // a review change this document's state" without anybody having to read this file.
      documentStatusUnchanged: doc.status,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { taskId: created.data.id, documentStatusUnchanged: doc.status as string } };
}

/* ── s10's BULK CLASSIFY ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ PER-ROW OUTCOMES, NEVER A BOOLEAN. A bulk of forty that files thirty-eight and refuses two must
 * report which two and why. Collapsed to "partially failed" the operator reruns the whole batch; collapsed
 * to "succeeded" the two are lost, and they are the two an arriving result was about.
 *
 * ⚠ IT LOOPS classifyIncoming(). It does not write a bulk UPDATE. The single-row engine carries s17's
 * source-attribution allowlist, its refusal to unlink without a reason, its workspace scoping of both the
 * arrival and the patient, and its audit entry per row. A `.in("id", ids).update({...})` would have none
 * of those, and would be five lines shorter.
 */
export type BulkOutcome = { id: string; ok: boolean; code: string | null; message: string | null };

export async function bulkClassify(admin: any, ctx: WorkspaceContext, args: {
  ids: string[]; patientId?: string | null; docType?: string; correlationId: string;
}): Promise<EngineResult<{ outcomes: BulkOutcome[]; changed: number; refused: number }>> {
  if (!hasCapability(ctx, "inbox.record"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you do not hold inbox.record in this practice" };

  const ids = [...new Set(args.ids.filter(id => typeof id === "string" && id.trim()))];
  if (ids.length === 0)
    return { ok: false, status: 400, code: "NOTHING_SELECTED", message: "select at least one document" };

  // ⚠ REFUSED, NOT TRUNCATED. See DOC_BULK_LIMIT: a truncated bulk that reports success is
  // indistinguishable from one that worked, and the rows it silently dropped are the ones nobody checks.
  if (ids.length > DOC_BULK_LIMIT)
    return {
      ok: false, status: 422, code: "TOO_MANY",
      message: `${ids.length} documents were selected and this action will not run on more than ${DOC_BULK_LIMIT} at once -- filing that many against one patient is the most damaging single thing this screen can do`,
    };

  // ⚠ A BULK ACTION THAT CHANGES NOTHING IS REFUSED RATHER THAN REPORTED AS FIFTY SUCCESSES.
  // classifyIncoming() returns ok for a no-op patch, which is right for one row and wrong for a batch:
  // fifty green ticks over an empty form reads as fifty documents filed.
  if (!args.patientId && !args.docType)
    return {
      ok: false, status: 400, code: "NOTHING_TO_APPLY",
      message: "choose a patient, a document type, or both -- this would have changed nothing",
    };

  const outcomes: BulkOutcome[] = [];
  for (const id of ids) {
    const result = await classifyIncoming(admin, {
      workspaceId: ctx.workspaceId, incomingId: id,
      patientId: args.patientId ?? undefined,
      docType: args.docType,
      actorId: ctx.userId, correlationId: args.correlationId,
    });
    outcomes.push(result.ok
      ? { id, ok: true, code: null, message: null }
      : { id, ok: false, code: result.code, message: result.message });
  }

  const changed = outcomes.filter(o => o.ok).length;
  const refused = outcomes.length - changed;

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.incoming_bulk_classified",
    payload: {
      requested: ids.length, changed, refused,
      patientId: args.patientId ?? null, docType: args.docType ?? null,
      // The ids that were REFUSED, named. The ones that worked each wrote their own audit entry inside
      // classifyIncoming; the ones that did not wrote nothing, so this is their only trace.
      refusedIds: outcomes.filter(o => !o.ok).map(o => o.id),
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { outcomes, changed, refused } };
}

/* ── s10 / s20 PHASE 4: THE METADATA EXPORT ──────────────────────────────────────────────────────────
 *
 * s10 puts "export metadata" among the safe bulk operations; s20's Phase 4 asks for "extended
 * import/export". This is the half of Phase 4 that can honestly be built -- see the PHASE 4 block at the
 * head of documents-workspace-constants.ts for the three halves that cannot.
 *
 * ⚠ IT EXPORTS THE ROWS THE FILTER SELECTS, THROUGH THE SAME applyFilter() THE SCREEN USED. Whatever
 * list the operator was looking at is what lands in the file. A separate query here would be a second
 * predicate, and an export that quietly contains different rows from the screen that produced it is
 * unauditable by the person who made it.
 *
 * ⚠ AN UNREADABLE SOURCE REFUSES THE EXPORT ENTIRELY. This is the strictest application of the
 * first doctrine anywhere in this workspace, and it is strict on purpose: a partial CSV has no way to
 * carry "and the incoming register could not be read". It is a file that leaves this machine, gets
 * emailed, gets filed, and is read months later by somebody who has no way to know a third of the
 * practice is missing from it. A screen can show the gap; a spreadsheet cannot.
 */
export type MetadataExport = {
  filename: string;
  csv: string;
  rowCount: number;
  /** ⚠ The register's own truncation, carried so the route can refuse rather than ship a partial file. */
  truncated: string[];
};

export async function documentMetadataExport(
  admin: any, ctx: WorkspaceContext, filter: DocFilter,
): Promise<EngineResult<MetadataExport>> {
  if (!hasCapability(ctx, "data.export"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you do not hold data.export in this practice" };
  if (!hasCapability(ctx, "document.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "you do not hold document.view in this practice" };

  const register = await documentRegister(admin, ctx.workspaceId, filter);
  if (register.unreadable.length > 0)
    return {
      ok: false, status: 503, code: "SOURCE_UNREADABLE",
      message: `this export was not produced because ${register.unreadable.map(u => u.source).join(" and ")} could not be read. `
        + "A file missing a whole source cannot say so once it has left this system, so nothing was written.",
    };
  // The same reason. A file capped at the first five hundred rows of a source looks complete.
  if (register.truncated.length > 0)
    return {
      ok: false, status: 503, code: "SOURCE_TRUNCATED",
      message: `${register.truncated.join(" and ")} returned the maximum this workspace reads at once, so an export would be silently incomplete. Narrow the filter -- by date, patient or type -- and export again.`,
    };

  const header = csvRow(DOC_EXPORT_COLUMNS.map(([, label]) => label));
  const body = register.rows.map(r => csvRow([
    r.title,
    DOC_TYPE_LABEL[r.docType] ?? r.docType,
    DOC_ORIGIN[r.origin].label,
    r.source,
    DOC_STATUS[r.status].label,
    r.stored,
    r.at,
    r.patientId ? "yes" : "no",
    r.patientName ?? "",
    r.version ?? "",
    // s5.3 asks for a document reference. This schema has no reference column on any of the three
    // sources, and the row's id IS the reference this product can produce -- it is what every href in
    // this workspace is built from. Inventing a formatted reference number would be inventing a field.
    r.id,
  ]));

  return {
    ok: true,
    data: {
      filename: `documents-${register.today}.csv`,
      // A trailing newline: a CSV without one is a file whose last row some readers drop.
      csv: [header, ...body].join("\r\n") + "\r\n",
      rowCount: register.rows.length,
      truncated: register.truncated,
    },
  };
}
