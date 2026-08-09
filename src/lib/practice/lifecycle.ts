import { audit } from "@/lib/practice/audit";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { logAccess } from "@/lib/practice/privacy";
import {
  CAP_VIEW, CAP_ARCHIVE, CAP_SUSPEND, CAP_RESTORE, CAP_EXPORT,
  LIFECYCLE_ACTIONS, LIFECYCLE_REFUSALS, LIFECYCLE_STATUSES, PROVISIONING_STATUSES,
  STATUS_MEANING, CLOSURE_NO_STORE, DOCUMENT_TABLES, BYTES_COVER, BYTES_EXCLUDE,
  REASON_MIN, REASON_MAX, actionSpec,
  type ClosureVerdict, type LifecycleAction,
} from "@/lib/practice/lifecycle-constants";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-LIFE-001 -- THE SAFE SUBSET, ON MIGRATION 247.
//
// s1's objectives are "prevent accidental loss", "controlled lifecycle states instead of immediate
// deletion", "compliance, auditability and business continuity" and "secure export". This file delivers
// all four and contains NO DESTRUCTIVE VERB.
//
//   practiceLifecycle()   the state, who changed it and when, the transition history, the figures, and
//                         s4's closure checklist as a READ-ONLY report
//   applyTransition()     archive / suspend / restore -- three reversible state changes, each with a
//                         mandatory reason, each recorded in practice_lifecycle_transition
//   exportPractice()      s5's whole-practice export, as its own capability, audited like the
//                         single-patient export it is modelled on
//
// ---- FOUR THINGS THAT ARE STRUCTURAL HERE AND ARE NOT NEGOTIABLE ----------------------------------
//
//  1. A FAILED READ IS NEVER A ZERO. Every list is a Panel with three states and every figure is
//     `number | null`. "Nought future appointments" and "we could not count your future appointments"
//     are different answers on a screen somebody is reading before they archive a practice.
//
//  2. AN UNCHECKED THING SAYS SO. Two of s4's six closure checks have no store in this product at all.
//     They carry verdict `no_store` with the reason, and are NEVER drawn as an unticked box -- an
//     unticked box says "you have not done this", and the truth is "we cannot tell".
//
//  3. THE RECORD IS WRITTEN BEFORE THE STATE CHANGES. s3 requires that every transition creates an
//     immutable audit log and s7 that the actor, the time, both states and the reason are recorded.
//     The runner cannot host a transaction, so the order is chosen so the WORST case is a recorded
//     attempt that did not take effect -- never an unrecorded change. See applyTransition.
//
//  4. NOTHING IS EVER DELETED. Archive, suspend and restore each write ONE column and one row. No
//     removal, no anonymisation, no retention sweep. LIFECYCLE_REFUSALS says so in the payload.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE THREE-STATE PANEL, the shape parameters.ts and longitudinal.ts established ───────────────────

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };

const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

export type LifecycleResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): LifecycleResult<never> =>
  ({ ok: false, status, code, message });

const trim = (v: unknown): string => String(v ?? "").trim();

/** A count that says whether it is a count. `null` means the query failed; a number means it answered. */
const countOf = (q: { count: number | null; error: unknown }): number | null => (q.error ? null : (q.count ?? 0));

/**
 * Every row, in pages.
 *
 * ⚠ PostgREST RETURNS AT MOST 1000 ROWS AND SAYS NOTHING WHEN IT TRUNCATES. A whole-practice export that
 * silently stopped at a thousand appointments would be the single worst artefact this file could
 * produce: it looks complete, it is not, and the practitioner finds out only when they need it. So every
 * export section is read in pages until a short page arrives, and the page count travels with it.
 */
async function readAll(admin: any, table: string, workspaceId: string): Promise<{ rows: any[]; error: string | null }> {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select("*")
      .eq("workspace_id", workspaceId).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, error: null };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE VIEW
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type TransitionRow = {
  id: string;
  fromStatus: string;
  toStatus: string;
  outcome: "applied" | "refused";
  refusalCode: string | null;
  reason: string;
  actorUserId: string | null;
  actorName: string | null;
  actorKind: string;
  occurredAt: string;
};

export type ClosureCheck = {
  key: string;
  label: string;
  /** s4's own wording, so the report can be read against the specification. */
  specLine: string;
  verdict: ClosureVerdict;
  /** The figure behind the verdict, or null when there is none to have. */
  count: number | null;
  detail: string;
  href: string | null;
};

export type LifecycleFigure = {
  key: string;
  label: string;
  /** `null` is a failed read, and the console renders it as such rather than as a nought. */
  value: number | null;
  /** Which table it came from, named. Doctrine 7: a figure is the length of a list you can open. */
  store: string;
  detail: string;
  href: string | null;
};

export type PracticeLifecycle = {
  permitted: boolean;
  practiceName: string | null;
  /** The live status, read from practice_workspace. `null` means the workspace could not be read. */
  status: string | null;
  statusReadable: boolean;
  /** Is this a lifecycle state at all, or is the practice still being provisioned? */
  statusKind: "lifecycle" | "provisioning" | "unknown";
  statusMeaning: string | null;
  createdAt: string | null;
  /**
   * WHEN THE STATUS LAST CHANGED AND WHO CHANGED IT -- derived from the transition log, not stored.
   * ⚠ `null` here means "nothing has ever moved this practice through this engine", which is TRUE of
   * every practice created before migration 247 and is said in those words rather than left blank.
   */
  changedAt: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedReason: string | null;
  /** True when the newest applied transition disagrees with the live status -- see applyTransition. */
  logDisagreesWithStatus: boolean;
  history: Panel<TransitionRow>;
  figures: Panel<LifecycleFigure>;
  closure: Panel<ClosureCheck>;
  /** Bytes across the two tables that have a byte_size, named. There is NO quota; see refusals. */
  bytes: { total: number | null; covers: string[]; excludes: string; quotaBytes: null };
  /** Which verbs this caller may use right now, and why not when they may not. */
  actions: {
    action: LifecycleAction;
    label: string;
    to: string;
    effect: string;
    capability: string;
    permitted: boolean;
    availableFromHere: boolean;
    blockedReason: string | null;
  }[];
  canExport: boolean;
  /** ⚠ Every figure this build refuses to draw, with the reason, in the payload. */
  refusals: Record<string, string>;
};

export async function practiceLifecycle(admin: any, ctx: WorkspaceContext): Promise<PracticeLifecycle> {
  const blank = (permitted: boolean): PracticeLifecycle => ({
    permitted,
    practiceName: null, status: null, statusReadable: false, statusKind: "unknown", statusMeaning: null,
    createdAt: null, changedAt: null, changedBy: null, changedByName: null, changedReason: null,
    logDisagreesWithStatus: false,
    history: permitted ? failed("not read") : denied(),
    figures: permitted ? failed("not read") : denied(),
    closure: permitted ? failed("not read") : denied(),
    bytes: { total: null, covers: BYTES_COVER, excludes: BYTES_EXCLUDE, quotaBytes: null },
    actions: [],
    canExport: false,
    refusals: LIFECYCLE_REFUSALS,
  });
  if (!hasCapability(ctx, CAP_VIEW)) return blank(false);

  const nowIso = new Date().toISOString();

  const [
    wsQ, trQ, patientsQ, patientsActiveQ, apptFutureQ, apptAllQ, teamQ,
    followUpQ, channelQ, attachQ, libraryQ, clinicalDocQ,
  ] = await Promise.all([
    admin.from("practice_workspace").select("name, status, created_at").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("practice_lifecycle_transition")
      .select("id, from_status, to_status, outcome, refusal_code, reason, actor_user_id, actor_kind, occurred_at")
      .eq("workspace_id", ctx.workspaceId).order("occurred_at", { ascending: false }).limit(200),
    admin.from("practice_patient").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    admin.from("practice_patient").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    // ⚠ FUTURE AND NOT CANCELLED. s4's closure check is about appointments somebody is still expecting to
    // attend; a LIFETIME total on a decommissioning screen is a vanity figure that answers no question
    // being asked here.
    admin.from("practice_appointment").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).gt("scheduled_at", nowIso)
      .in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"]),
    admin.from("practice_appointment").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
    // ⚠ LOWER CASE 'active'. practice_membership.status is written in lower case by every writer in this
    // codebase and by migration 247's own backfill -- verified live before this line was written.
    admin.from("practice_membership").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_follow_up").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]),
    admin.from("practice_message_channel").select("kind, enabled").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_attachment").select("byte_size").eq("workspace_id", ctx.workspaceId).is("removed_at", null),
    admin.from("practice_library_document").select("byte_size").eq("workspace_id", ctx.workspaceId).is("purged_at", null),
    admin.from("practice_clinical_document").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId),
  ]);

  const ws = wsQ.data as { name: string; status: string; created_at: string } | null;
  const status = wsQ.error || !ws ? null : (ws.status as string);
  const statusKind: "lifecycle" | "provisioning" | "unknown" =
    status === null ? "unknown"
      : (LIFECYCLE_STATUSES as readonly string[]).includes(status) ? "lifecycle"
        : (PROVISIONING_STATUSES as readonly string[]).includes(status) ? "provisioning" : "unknown";

  // ── THE HISTORY, and the names behind the actor ids ───────────────────────────────────────────────
  const rawTransitions = trQ.error ? null : ((trQ.data ?? []) as any[]);
  let nameOf = new Map<string, string>();
  if (rawTransitions && rawTransitions.length > 0) {
    const ids = [...new Set(rawTransitions.map(r => r.actor_user_id).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
      nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id as string, p.full_name as string]));
    }
  }
  const transitions: TransitionRow[] = (rawTransitions ?? []).map(r => ({
    id: r.id as string,
    fromStatus: r.from_status as string,
    toStatus: r.to_status as string,
    outcome: (r.outcome as "applied" | "refused") ?? "applied",
    refusalCode: (r.refusal_code as string | null) ?? null,
    reason: r.reason as string,
    actorUserId: (r.actor_user_id as string | null) ?? null,
    actorName: r.actor_user_id ? (nameOf.get(r.actor_user_id as string) ?? null) : null,
    actorKind: (r.actor_kind as string) ?? "member",
    occurredAt: r.occurred_at as string,
  }));

  const lastApplied = transitions.find(t => t.outcome === "applied") ?? null;

  // ── THE FIGURES. Each names its own store, and each is a number or a null. ────────────────────────
  const patients = countOf(patientsQ);
  const patientsActive = countOf(patientsActiveQ);
  const apptFuture = countOf(apptFutureQ);
  const apptAll = countOf(apptAllQ);
  const team = countOf(teamQ);
  const openFollowUps = countOf(followUpQ);
  const clinicalDocs = countOf(clinicalDocQ);

  const attachRows = attachQ.error ? null : ((attachQ.data ?? []) as { byte_size: number }[]);
  const libraryRows = libraryQ.error ? null : ((libraryQ.data ?? []) as { byte_size: number }[]);
  const bytesTotal = attachRows === null || libraryRows === null
    ? null
    : [...attachRows, ...libraryRows].reduce((n, r) => n + (r.byte_size ?? 0), 0);

  const figures: LifecycleFigure[] = [
    {
      key: "patients", label: "Patients", value: patients, store: "practice_patient",
      detail: patients === null ? "the patient register could not be read"
        : patientsActive === null ? `${patients} in the register`
          : `${patients} in the register, ${patientsActive} active`,
      href: "/practice/patients",
    },
    {
      key: "appointments_future", label: "Future appointments", value: apptFuture,
      store: "practice_appointment",
      detail: apptFuture === null ? "your diary could not be read"
        : apptAll === null ? "still to happen, not cancelled"
          : `still to happen and not cancelled, out of ${apptAll} ever booked`,
      href: "/practice/calendar",
    },
    {
      key: "team", label: "Team members", value: team, store: "practice_membership",
      detail: team === null ? "your team could not be read" : "with active access to this practice",
      href: "/practice/people",
    },
    // ⚠ THREE TABLES, THREE FIGURES, EACH NAMED. One number labelled "Documents" that silently meant one
    // of the three would be the comp's figure with the ambiguity left in.
    {
      key: "documents_clinical", label: DOCUMENT_TABLES[0].label, value: clinicalDocs,
      store: DOCUMENT_TABLES[0].table, detail: DOCUMENT_TABLES[0].detail, href: "/practice/documents",
    },
    {
      key: "documents_library", label: DOCUMENT_TABLES[1].label,
      value: libraryRows === null ? null : libraryRows.length,
      store: DOCUMENT_TABLES[1].table, detail: DOCUMENT_TABLES[1].detail, href: "/practice/documents",
    },
    {
      key: "documents_attachments", label: DOCUMENT_TABLES[2].label,
      value: attachRows === null ? null : attachRows.length,
      store: DOCUMENT_TABLES[2].table, detail: DOCUMENT_TABLES[2].detail, href: null,
    },
  ];

  // ── s4's CLOSURE CHECKLIST, AS A READ-ONLY REPORT ────────────────────────────────────────────────
  //
  // ⚠ NOTHING HERE IS A CONTROL AND NOTHING HERE CLOSES A PRACTICE. This build has no close verb: the
  // report exists so a practitioner can see what would be outstanding, and two of its six lines can only
  // ever be answered by a person.
  const channels = channelQ.error ? null : ((channelQ.data ?? []) as { enabled: boolean }[]);
  const channelsOn = channels === null ? null : channels.filter(c => c.enabled).length;

  const closure: ClosureCheck[] = [
    {
      key: "invoices", label: "Outstanding invoices reviewed",
      specLine: "Outstanding invoices reviewed.",
      verdict: "no_store", count: null, detail: CLOSURE_NO_STORE.invoices, href: null,
    },
    {
      key: "appointments", label: "Future appointments handled",
      specLine: "Future appointments handled.",
      verdict: apptFuture === null ? "unreadable" : apptFuture === 0 ? "met" : "unmet",
      count: apptFuture,
      detail: apptFuture === null
        ? "your diary could not be read, so nothing here is a count of your appointments"
        : apptFuture === 0
          ? "Nothing is booked in the future that has not been cancelled."
          : `${apptFuture} appointment${apptFuture === 1 ? " is" : "s are"} still booked in the future. Each of those is somebody expecting to be seen.`,
      href: "/practice/calendar",
    },
    {
      key: "follow_ups", label: "Pending follow-ups resolved or reassigned",
      specLine: "Pending follow-ups resolved or reassigned.",
      verdict: openFollowUps === null ? "unreadable" : openFollowUps === 0 ? "met" : "unmet",
      count: openFollowUps,
      detail: openFollowUps === null
        ? "your follow-up board could not be read"
        : openFollowUps === 0
          ? "No follow-up is open or scheduled."
          : `${openFollowUps} follow-up${openFollowUps === 1 ? " is" : "s are"} still open or booked.`,
      href: "/practice/follow-ups",
    },
    {
      key: "team_access", label: "Team access reviewed",
      specLine: "Team access reviewed.",
      // ⚠ THIS ONE IS A COUNT, NOT A JUDGEMENT. Nothing records that a review HAPPENED, so the verdict
      // reports how many people still have access rather than claiming the review is done. A practice
      // with one member is the only case where there is nothing to review.
      verdict: team === null ? "unreadable" : team <= 1 ? "met" : "unmet",
      count: team,
      detail: team === null
        ? "your team could not be read"
        : team <= 1
          ? "You are the only person with access to this practice."
          : `${team} people have active access. Nothing records whether that list has been reviewed, so this is the list rather than a verdict on it.`,
      href: "/practice/people",
    },
    {
      key: "integrations", label: "Integrations disconnected safely",
      specLine: "Integrations disconnected safely.",
      verdict: "no_store", count: null, detail: CLOSURE_NO_STORE.integrations, href: null,
    },
    {
      key: "notifications", label: "Patient notifications prepared where applicable",
      specLine: "Patient notifications prepared where applicable.",
      // ⚠ WHAT IS CHECKED IS WHETHER A CHANNEL IS ON, WHICH IS NOT WHETHER A NOTICE WAS PREPARED. Said in
      // those words rather than dressed up as the check s4 asked for.
      verdict: channelsOn === null ? "unreadable" : "unmet",
      count: channelsOn,
      detail: channelsOn === null
        ? "your message channels could not be read"
        : channelsOn === 0
          ? "No message channel is switched on in this practice, so nothing can be sent to a patient from here. Whatever notice your patients need has to be given some other way."
          : `${channelsOn} message channel${channelsOn === 1 ? " is" : "s are"} switched on. Nothing in this product schedules or sends a closure notice by itself, and nothing records that one was prepared, so this line reports the channel and not the notice.`,
      href: null,
    },
  ];

  // ── THE VERBS AVAILABLE FROM HERE ────────────────────────────────────────────────────────────────
  const actions = LIFECYCLE_ACTIONS.map(s => {
    const permitted = hasCapability(ctx, s.capability);
    const availableFromHere = status !== null && s.from.includes(status);
    return {
      action: s.action, label: s.label, to: s.to as string, effect: s.effect, capability: s.capability,
      permitted, availableFromHere,
      blockedReason: !permitted
        ? `This needs ${s.capability}, which you do not hold.`
        : status === null
          ? "The practice's current state could not be read, so nothing here can be changed until it can."
          : !availableFromHere
            ? `A practice that is ${status} cannot be ${s.action === "restore" ? "restored" : `${s.action}d`}. This is offered from ${s.from.join(" or ")}.`
            : null,
    };
  });

  return {
    permitted: true,
    practiceName: ws?.name ?? null,
    status,
    statusReadable: !wsQ.error && !!ws,
    statusKind,
    statusMeaning: status === null ? null : (STATUS_MEANING[status] ?? null),
    createdAt: ws?.created_at ?? null,
    changedAt: lastApplied?.occurredAt ?? null,
    changedBy: lastApplied?.actorUserId ?? null,
    changedByName: lastApplied?.actorName ?? null,
    changedReason: lastApplied?.reason ?? null,
    // The log and the column are two facts and they can disagree -- see applyTransition's ordering note.
    // Saying so is better than picking one and hoping.
    logDisagreesWithStatus: !!lastApplied && status !== null && lastApplied.toStatus !== status,
    history: trQ.error ? failed(`the lifecycle history could not be read: ${trQ.error.message}`) : loaded(transitions),
    figures: loaded(figures),
    closure: loaded(closure),
    bytes: { total: bytesTotal, covers: BYTES_COVER, excludes: BYTES_EXCLUDE, quotaBytes: null },
    actions,
    canExport: hasCapability(ctx, CAP_EXPORT),
    refusals: LIFECYCLE_REFUSALS,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE VERBS
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The minimum an actor needs to move a practice through a state. WorkspaceContext satisfies it, and so
 * does the reduced actor the access-status screen resolves for a practice that is no longer ACTIVE.
 */
export type LifecycleActor = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  capabilities: string[];
  /** null for a platform operator, who has no membership in the practice they are acting on. */
  membershipId: string | null;
  actorKind: "member" | "operator" | "system";
};

const CAP_FOR: Record<LifecycleAction, string> = {
  archive: CAP_ARCHIVE, suspend: CAP_SUSPEND, restore: CAP_RESTORE,
};

/**
 * Write ONE transition row. Never updates, never deletes -- the table refuses both at the database.
 *
 * The error is returned rather than swallowed. A lifecycle change whose record could not be written must
 * not happen; that is the whole of s3's "every transition creates an immutable audit log".
 */
async function writeTransition(admin: any, args: {
  workspaceId: string; from: string; to: string; outcome: "applied" | "refused";
  refusalCode: string | null; reason: string; actor: LifecycleActor;
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin.from("practice_lifecycle_transition").insert({
    workspace_id: args.workspaceId,
    from_status: args.from, to_status: args.to,
    outcome: args.outcome, refusal_code: args.refusalCode,
    reason: args.reason,
    actor_user_id: args.actor.userId,
    actor_membership_id: args.actor.membershipId,
    actor_kind: args.actor.actorKind,
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: data.id as string };
}

/**
 * ARCHIVE, SUSPEND OR RESTORE. Three reversible state changes, and nothing else.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ORDER OF THE TWO WRITES IS THE DESIGN, AND IT IS CHOSEN FOR ITS WORST CASE.
 *
 * The migration runner cannot host a transaction, so a state change and its record are two statements
 * and either can fail. There are two orders and they fail differently:
 *
 *   status first  -> a failure of the second statement leaves a practice that has been archived with
 *                    NOTHING SAYING WHO DID IT. s3 and s7 exist precisely to make that impossible.
 *   record first  -> a failure of the second statement leaves a record of an attempt that did not take
 *                    effect. That is a readable, correctable fact.
 *
 * So the record goes first, and if the status update then fails a SECOND row is written saying so, with
 * refusal_code STATUS_NOT_APPLIED. practiceLifecycle reads the LIVE COLUMN for the current state -- never
 * the log -- so the screen is never wrong, and it flags the disagreement when there is one.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ A REFUSAL IS RECORDED TOO. Migration 247 s2: "an attempt to archive a practice is itself a fact
 * somebody may need to see." A caller without the capability, or asking for a move the state does not
 * allow, leaves a `refused` row -- except when the reason is missing, because the column is NOT NULL and
 * there is nothing to write. That case returns 422 and writes nothing, and it says so here rather than
 * leaving the gap for somebody to find.
 */
export async function applyTransition(admin: any, actor: LifecycleActor, input: {
  action: string;
  reason: string;
  correlationId: string;
}): Promise<LifecycleResult<{ from: string; to: string; transitionId: string }>> {
  const spec = actionSpec(input.action);
  if (!spec)
    return fail(400, "VALIDATION_ERROR",
      `${input.action || "that"} is not a lifecycle action. This build offers archive, suspend and restore, and no delete.`);

  // s7 asks for why, and migration 247 made reason NOT NULL so an engine that forgets it fails on every
  // write. Validated FIRST so that a refusal can be recorded at all.
  const reason = trim(input.reason);
  if (reason.length < REASON_MIN)
    return fail(422, "REASON_REQUIRED",
      `a lifecycle change has to say why, in at least ${REASON_MIN} characters. Nothing was changed and nothing was recorded, because the record has nowhere to put an empty reason.`);
  if (reason.length > REASON_MAX)
    return fail(422, "REASON_TOO_LONG", `a reason is at most ${REASON_MAX} characters.`);

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("id, name, status").eq("id", actor.workspaceId).maybeSingle();
  if (wsErr) return fail(503, "UNAVAILABLE", `this practice's current state could not be read: ${wsErr.message}`);
  if (!ws) return fail(404, "NOT_FOUND", "no such practice");
  const from = ws.status as string;

  // ── The capability. Refused, and the attempt recorded. ───────────────────────────────────────────
  if (!actor.capabilities.includes(CAP_FOR[spec.action])) {
    await writeTransition(admin, {
      workspaceId: actor.workspaceId, from, to: spec.to, outcome: "refused",
      refusalCode: "FORBIDDEN", reason, actor,
    });
    return fail(403, "FORBIDDEN", `${spec.action === "restore" ? "restoring" : `${spec.action.replace(/e$/, "")}ing`} a practice needs ${CAP_FOR[spec.action]}`);
  }

  // ── The move. s3: administrators may restore Archived or Suspended practices; the rest of the ladder
  //    is stated in LIFECYCLE_ACTIONS.from and enforced here rather than described in a comment. ─────
  if (!spec.from.includes(from)) {
    await writeTransition(admin, {
      workspaceId: actor.workspaceId, from, to: spec.to, outcome: "refused",
      refusalCode: "ILLEGAL_TRANSITION", reason, actor,
    });
    return fail(409, "ILLEGAL_TRANSITION",
      `this practice is ${from}, and ${spec.action} is offered from ${spec.from.join(" or ")}. Nothing was changed.`);
  }
  if (from === spec.to)
    return fail(409, "ALREADY_THERE", `this practice is already ${from}.`);

  // ── 1. THE RECORD. If this fails nothing else happens. ───────────────────────────────────────────
  const record = await writeTransition(admin, {
    workspaceId: actor.workspaceId, from, to: spec.to, outcome: "applied", refusalCode: null, reason, actor,
  });
  if ("error" in record)
    return fail(500, "NOT_RECORDED",
      `this practice was NOT ${spec.to.toLowerCase()} because the change could not be recorded: ${record.error}. A lifecycle change with no record of who made it is the one thing this engine will not do.`);

  // ── 2. THE STATE. Conditional on the status we just recorded as `from`, so a race cannot apply a
  //       transition from a state the practice had already left. ───────────────────────────────────
  const { data: updated, error: upErr } = await admin.from("practice_workspace")
    .update({ status: spec.to, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq("id", actor.workspaceId).eq("status", from).select("id, status");

  const applied = !upErr && Array.isArray(updated) && updated.length === 1;
  if (!applied) {
    await writeTransition(admin, {
      workspaceId: actor.workspaceId, from, to: spec.to, outcome: "refused",
      refusalCode: "STATUS_NOT_APPLIED",
      reason: `${reason} [the transition above was recorded but did not take effect: ${upErr ? upErr.message : "the practice had already moved out of " + from}]`,
      actor,
    });
    return fail(upErr ? 500 : 409, "STATUS_NOT_APPLIED",
      upErr
        ? `the record was written but the practice's state could not be changed: ${upErr.message}. The history now carries both facts.`
        : `somebody else changed this practice's state while this was in flight, so nothing was applied. Reload and try again.`);
  }

  await audit(admin, {
    workspaceId: actor.workspaceId, actorId: actor.userId,
    eventType: `practice.lifecycle_${spec.action}d`,
    payload: { from, to: spec.to, reason, transitionId: record.id, actorKind: actor.actorKind },
    correlationId: input.correlationId,
  });

  return { ok: true, data: { from, to: spec.to as string, transitionId: record.id } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// s5 -- THE WHOLE-PRACTICE EXPORT
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ WHAT IS IN IT, DECLARED. Modelled on privacy.ts's exportPatientRecord -- same audit, same access-log
 * entry, same "this is a data export, not a clinical document" header -- but over the whole practice.
 *
 * s5 names patients, appointments, follow-ups, documents, billing, settings and configuration. SIX OF
 * THE SEVEN HAVE A STORE. Billing does not exist in this product at all, so it is declared unavailable
 * in the file rather than emitted as an empty array: an export that silently omits a named category is
 * worse than one that says the category does not exist.
 *
 * ⚠ AND ONLY JSON. s5 asks for PDF, CSV, JSON and ZIP. A format offered and not produced is worse than
 * one that is absent, so `formats` in the file says which is which.
 */
export const EXPORT_SECTIONS: { key: string; table: string; label: string }[] = [
  { key: "patients", table: "practice_patient", label: "Patient register" },
  { key: "patientIdentifiers", table: "practice_patient_identifier", label: "Patient identifiers" },
  { key: "appointments", table: "practice_appointment", label: "Appointments" },
  { key: "encounters", table: "practice_encounter", label: "Consultations" },
  { key: "problems", table: "practice_problem", label: "Problems" },
  { key: "diagnoses", table: "practice_diagnosis", label: "Diagnoses" },
  { key: "treatments", table: "practice_treatment", label: "Treatments" },
  { key: "procedures", table: "practice_procedure", label: "Procedures" },
  { key: "followUps", table: "practice_follow_up", label: "Follow-ups" },
  { key: "clinicalDocuments", table: "practice_clinical_document", label: "Clinical documents" },
  { key: "libraryDocuments", table: "practice_library_document", label: "Library files (metadata only)" },
  { key: "attachments", table: "practice_attachment", label: "Encounter attachments (metadata only)" },
  { key: "locations", table: "practice_location", label: "Locations" },
  { key: "configuration", table: "practice_configuration", label: "Practice configuration" },
  { key: "availability", table: "practice_availability_template", label: "Regular week" },
  { key: "bookingRules", table: "practice_booking_rule", label: "Booking rules" },
  { key: "memberships", table: "practice_membership", label: "Team" },
  { key: "lifecycleTransitions", table: "practice_lifecycle_transition", label: "Lifecycle history" },
  // ⚠ THE PORTFOLIO ENTRIES TYPED HERE, AND THE REASON THIS SECTION READS THE WAY IT DOES.
  //
  // CPR-IDENT-SURVEY-001 s1.2 found that this list omitted both portfolio tables, so a whole-practice
  // export did not carry the practitioner's own professional record. Migration 270 answers the larger
  // half of that by making the record PERSON-SCOPED: `practice_portfolio_entry.workspace_id` is now
  // provenance -- where an entry was typed -- rather than the scope it is read by.
  //
  // So this section carries the entries whose provenance is THIS PRACTICE, which is the question a
  // whole-practice export is entitled to ask, and is what an erasure or subject-access enquiry against
  // this practice needs to be able to find. It is deliberately NOT the practitioner's whole record.
  { key: "portfolioEntries", table: "practice_portfolio_entry", label: "Professional portfolio entries typed here" },
];

/**
 * ⚠ WHAT IS DELIBERATELY NOT IN THE LIST ABOVE, AND WHERE IT IS EXPORTED INSTEAD.
 *
 * `practice_practitioner_identity` -- the practitioner's number, handle, declared professional facts and
 * licence state -- is NOT in a practice export, and adding it would be wrong twice over. It is one row
 * per PERSON, not per practice, so a practice cannot be its controller; and it would be reachable only
 * with `data.export` inside a practice that opens, which is precisely the condition the person-scoped
 * record has to survive.
 *
 * It is exported from `/api/v1/practice/portfolio/record?view=export`, which takes no workspace at all
 * and answers for an authenticated caller with no practice, an archived one, or a closed one. That route
 * is the answer to "somewhere the practitioner can reach without an active practice"; this section is
 * the answer to "what did this practice hold".
 */
export const PERSON_SCOPED_EXPORT_PATH = "/api/v1/practice/portfolio/record?view=export";

export type PracticeExport = Record<string, unknown>;

export async function exportPractice(admin: any, ctx: WorkspaceContext, opts: {
  correlationId?: string;
} = {}): Promise<LifecycleResult<PracticeExport>> {
  if (!hasCapability(ctx, CAP_EXPORT))
    return fail(403, "FORBIDDEN", "exporting this practice needs data.export");

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("*").eq("id", ctx.workspaceId).maybeSingle();
  if (wsErr) return fail(503, "UNAVAILABLE", `this practice could not be read: ${wsErr.message}`);
  if (!ws) return fail(404, "NOT_FOUND", "no such practice");

  const sections: Record<string, unknown> = {};
  // ⚠ EVERY SECTION REPORTS ITS OWN OUTCOME. A section that could not be read is named as unreadable
  // rather than emitted as an empty array -- an export whose failures look like emptiness is the reason
  // somebody discovers a gap months later.
  const manifest: { key: string; table: string; label: string; rows: number | null; error: string | null }[] = [];

  for (const s of EXPORT_SECTIONS) {
    const { rows, error } = await readAll(admin, s.table, ctx.workspaceId);
    sections[s.key] = error ? null : rows;
    manifest.push({ key: s.key, table: s.table, label: s.label, rows: error ? null : rows.length, error });
  }

  // The notes hang off encounters rather than the workspace, so they need the encounter ids.
  const encounterIds = Array.isArray(sections.encounters)
    ? (sections.encounters as any[]).map(e => e.id as string) : [];
  if (encounterIds.length > 0) {
    const [notes, versions] = await Promise.all([
      admin.from("practice_encounter_note").select("*").in("encounter_id", encounterIds),
      admin.from("practice_encounter_note_version").select("*").in("encounter_id", encounterIds),
    ]);
    sections.encounterNotes = notes.error ? null : (notes.data ?? []);
    sections.encounterNoteVersions = versions.error ? null : (versions.data ?? []);
    manifest.push(
      { key: "encounterNotes", table: "practice_encounter_note", label: "Consultation notes", rows: notes.error ? null : ((notes.data ?? []) as any[]).length, error: notes.error?.message ?? null },
      { key: "encounterNoteVersions", table: "practice_encounter_note_version", label: "Consultation note versions", rows: versions.error ? null : ((versions.data ?? []) as any[]).length, error: versions.error?.message ?? null },
    );
  } else {
    sections.encounterNotes = [];
    sections.encounterNoteVersions = [];
  }

  const unreadable = manifest.filter(m => m.error !== null);
  const totalRows = manifest.reduce((n, m) => n + (m.rows ?? 0), 0);

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "export",
    subjectId: ctx.workspaceId, action: "export", route: "/api/v1/practice/lifecycle",
    detail: `whole practice, ${totalRows} rows across ${manifest.length} sections${unreadable.length ? `, ${unreadable.length} unreadable` : ""}`,
    correlationId: opts.correlationId,
  });
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.practice_exported",
    payload: { sections: manifest.length, rows: totalRows, unreadable: unreadable.map(u => u.key) },
    correlationId: opts.correlationId ?? "practice-export",
  });

  return {
    ok: true,
    data: {
      export: {
        format: "competen-practice-whole-practice",
        version: 1,
        generatedAt: new Date().toISOString(),
        workspaceId: ctx.workspaceId,
        generatedBy: ctx.userId,
        note: "A data export, not a clinical document. It carries no signature and is a snapshot of the moment above.",
        // ⚠ THE LIMITS ARE FIELDS IN THE FILE, NOT SENTENCES ON A PAGE SOMEBODY SAW ONCE.
        formats: { produced: ["json"], notBuilt: ["pdf", "csv", "zip"], why: LIFECYCLE_REFUSALS.export_formats },
        billing: { available: false, why: LIFECYCLE_REFUSALS.export_billing },
        files: {
          included: false,
          why: "Uploaded files and library documents are exported as METADATA ONLY -- title, name, type, size and path. The bytes themselves live in object storage and are not in this file.",
        },
        sections: manifest,
        unreadableSections: unreadable.map(u => ({ key: u.key, table: u.table, error: u.error })),
        complete: unreadable.length === 0,
      },
      practice: ws,
      ...sections,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// REACHING RESTORE ONCE THE PRACTICE IS NO LONGER ACTIVE
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ WHY THIS EXISTS, AND WHY IT IS NOT A PERMISSION CHANGE.
 *
 * resolveWorkspaceContext refuses any workspace whose status is not ACTIVE, ONBOARDING or PROVISIONING,
 * and every Practice page and every /api/v1/practice route runs through it. So the moment a practice is
 * archived, the lifecycle page that offers Restore is itself unreachable -- and archive, which s2 calls
 * "fully recoverable", would be a one-way door for the person who pressed it.
 *
 * This resolves the SAME membership and the SAME time-bounded capability grants that access.ts resolves,
 * minus the status gate, and it is used for ONE THING: the restore verb on the access-status screen a
 * member is redirected to. It grants nothing: a caller without practice.restore gets a null capability
 * list and applyTransition refuses them exactly as it would anywhere else.
 *
 * ⚠ THE CLOCK. Both comparisons are the string 'now', evaluated by Postgres, for the reason access.ts
 * sets out at length: effective_from defaults to the DATABASE's now(), and comparing it against this
 * process's clock made a grant made a moment ago read as "starts in the future".
 */
export async function resolveLifecycleActor(
  admin: any, userId: string, workspaceId: string,
): Promise<LifecycleActor | null> {
  const { data: memberships, error } = await admin.from("practice_membership")
    .select("id, role_code, workspace_id, practice_workspace!workspace_id(id, name, status)")
    .eq("user_id", userId).eq("workspace_id", workspaceId).eq("status", "active");
  if (error) return null;
  const mine = (memberships ?? []) as any[];
  if (mine.length === 0) return null;

  const membershipIds = mine.map(m => m.id as string);
  // Two unambiguous queries rather than one or-filter across a null test, which this codebase has twice
  // written in a way that quietly matched every row.
  const [{ data: open }, { data: ending }] = await Promise.all([
    admin.from("practice_role_assignment").select("capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").is("effective_to", null),
    admin.from("practice_role_assignment").select("capability_code")
      .in("membership_id", membershipIds).lte("effective_from", "now").gt("effective_to", "now"),
  ]);

  return {
    userId,
    workspaceId,
    workspaceName: (mine[0].practice_workspace?.name as string) ?? "",
    capabilities: [...new Set([...((open ?? []) as any[]), ...((ending ?? []) as any[])].map(c => c.capability_code as string))],
    membershipId: membershipIds[0],
    actorKind: "member",
  };
}
