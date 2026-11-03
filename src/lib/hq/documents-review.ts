/* eslint-disable @typescript-eslint/no-explicit-any */
// UNIFIED-GOVERNANCE-V1 follow-up -- the two-person review of the Document Template Studio configuration (migration 942, section 3).
// The documents configuration (individual.professional_documents) is published only as the exact draft that a DIFFERENT holder of the
// Competen Individual policy right (hq.individual.config.manage) approved. The submitter may publish the approved draft: that is the
// two-person rule (one prepares and submits, another approves, either publishes). The database enforces all of it
// (hq_config_review_guard, hq_config_publish_guard); this file reads the record, arranges the pathway in words and writes the two
// acts, passing the database's own sentence back when it refuses. Nothing here is a rule the database does not already hold.
import type { createAdminClient } from "@/lib/supabase/server";
import { POLICY_SCOPE } from "@/lib/individual/policy";
import { DOCUMENTS_PATH } from "@/lib/individual/documents-config";

type Admin = ReturnType<typeof createAdminClient>;

export const DOCUMENTS_REVIEW_HREF = "/super-admin/individual/documents";
export const DOCUMENTS_REVIEW_CAP = "hq.individual.config.manage";

export interface DocumentsReviewRow {
  id: string;
  draftHash: string;
  submittedBy: string;
  submittedAt: string;
  note: string | null;
  decidedBy: string | null;
  decision: "approved" | "changes_requested" | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface DocumentsReviewState {
  /** md5 of the stored draft, null when there is no stored draft. */
  draftHash: string | null;
  /** The draft differs from what is published. */
  pending: boolean;
  /** The row that governs the CURRENT draft: an approval, an undecided submission, or the latest request for changes. null = never submitted. */
  review: DocumentsReviewRow | null;
  /** The last 20 rows for this scope and path, newest first. */
  reviews: DocumentsReviewRow[];
  /** Names of everyone in `reviews`. */
  names: Record<string, string>;
}

export interface DocumentsViewer { userId: string; canManage: boolean }

export type DocumentsNextKind = "submit" | "review" | "publish" | "none";
export interface DocumentsStage { key: "prepare" | "review" | "publish"; label: string; status: "done" | "current" | "waiting" | "blocked" | "not_started"; role: string; note: string | null }
export interface DocumentsPathway {
  stages: DocumentsStage[];
  next: { headline: string; detail: string; action: DocumentsNextKind; viewer: { canAct: boolean; reason: string | null } };
}

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Pure: the database's sentence without its function prefix. */
export function plainReviewError(message: string | null | undefined): string {
  const m = String(message ?? "").replace(/^\s*(hq_config_review|hq_config_publish):\s*/i, "").trim();
  return m || "The change could not be recorded.";
}

/**
 * Pure: which row governs a draft, from the rows that name its exact hash (any order). Mirrors the publish guard: an approval stands
 * unless a later request for changes was recorded on the same content. Otherwise an undecided submission is awaiting a decision,
 * otherwise the latest request for changes is the answer.
 */
export function effectiveReview(rowsForHash: readonly DocumentsReviewRow[]): DocumentsReviewRow | null {
  if (!rowsForHash.length) return null;
  const at = (r: DocumentsReviewRow) => r.decidedAt ?? r.submittedAt;
  const newest = (a: DocumentsReviewRow, b: DocumentsReviewRow) => at(b).localeCompare(at(a));
  const approved = rowsForHash.filter((r) => r.decision === "approved").sort(newest)[0];
  const changes = rowsForHash.filter((r) => r.decision === "changes_requested").sort(newest)[0];
  if (approved && !(changes && (changes.decidedAt ?? "") > (approved.decidedAt ?? ""))) return approved;
  const undecided = rowsForHash.filter((r) => r.decision === null).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (undecided) return undecided;
  return changes ?? null;
}

function toRow(r: any): DocumentsReviewRow {
  return {
    id: r.id, draftHash: r.draft_hash, submittedBy: r.submitted_by, submittedAt: r.submitted_at, note: r.note ?? null,
    decidedBy: r.decided_by ?? null, decision: r.decision === "approved" || r.decision === "changes_requested" ? r.decision : null,
    decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null,
  };
}

const COLUMNS = "id, draft_hash, submitted_by, submitted_at, note, decided_by, decision, decided_at, decision_note";

async function currentDraftHash(admin: Admin): Promise<string | null> {
  const { data, error } = await (admin as any).rpc("hq_config_draft_hash", { p_scope_type: POLICY_SCOPE.scopeType, p_scope_ref: POLICY_SCOPE.scopeRef, p_path: DOCUMENTS_PATH });
  if (error) throw new Error(plainReviewError(error.message));
  return typeof data === "string" && data ? data : null;
}

async function namesOf(admin: Admin, ids: (string | null)[]): Promise<Record<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  if (!u.length) return {};
  const { data } = await (admin as any).from("profiles").select("id, full_name").in("id", u);
  return Object.fromEntries(((data ?? []) as any[]).map((p) => [p.id, p.full_name ?? "Unnamed person"]));
}

/** The review state of the documents configuration. Throws with the database's words when it cannot be read. */
export async function loadDocumentsReviewState(admin: Admin): Promise<DocumentsReviewState> {
  const a = admin as any;
  const { data: row, error } = await a.from("workspace_config_overrides").select("draft, published")
    .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", DOCUMENTS_PATH).maybeSingle();
  if (error) throw new Error(plainReviewError(error.message));
  const pending = !!row && JSON.stringify(row.draft ?? null) !== JSON.stringify(row.published ?? null);
  const draftHash = row?.draft != null ? await currentDraftHash(admin) : null;
  const base = () => a.from("hq_config_review").select(COLUMNS).eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", DOCUMENTS_PATH);
  const [recent, forHash] = await Promise.all([
    base().order("created_at", { ascending: false }).limit(20),
    draftHash ? base().eq("draft_hash", draftHash).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
  ]);
  if (recent.error) throw new Error(plainReviewError(recent.error.message));
  if (forHash.error) throw new Error(plainReviewError(forHash.error.message));
  const reviews = ((recent.data ?? []) as any[]).map(toRow);
  const review = effectiveReview(((forHash.data ?? []) as any[]).map(toRow));
  return { draftHash, pending, review, reviews, names: await namesOf(admin, [...reviews, ...(review ? [review] : [])].flatMap((r) => [r.submittedBy, r.decidedBy])) };
}

/** Pure: the three-stage pathway and the one next action, by the two-person rule. */
export function documentsPathway(state: Pick<DocumentsReviewState, "pending" | "draftHash" | "review" | "names">, viewer: DocumentsViewer): DocumentsPathway {
  const who = (id: string | null) => (id ? (id === viewer.userId ? "you" : state.names[id] ?? "a colleague") : "a colleague");
  const r = state.review;
  const needRight = "Needs the Competen Individual policy right (hq.individual.config.manage), held through an appointment.";
  const stage = (key: DocumentsStage["key"], label: string, role: string, status: DocumentsStage["status"], note: string | null): DocumentsStage => ({ key, label, status, role, note });
  const none = (headline: string, detail: string, reason: string | null = null): DocumentsPathway["next"] => ({ headline, detail, action: "none", viewer: { canAct: false, reason } });

  if (!state.pending) {
    return {
      stages: [
        stage("prepare", "Prepare", "Editor", "not_started", "There are no unpublished changes."),
        stage("review", "Review & Approve", "Another holder", "not_started", null),
        stage("publish", "Publish", "Any holder", "not_started", null),
      ],
      next: none("No unpublished changes", "The draft is what is published. Change a template and save the draft to start a review."),
    };
  }

  if (!state.draftHash) {
    return {
      stages: [
        stage("prepare", "Prepare", "Editor", "current", "There is no saved draft to review."),
        stage("review", "Review & Approve", "Another holder", "not_started", null),
        stage("publish", "Publish", "Any holder", "not_started", null),
      ],
      next: none("Save a draft", "Only a saved draft can be submitted for review.", viewer.canManage ? null : needRight),
    };
  }

  if (!r || r.decision === "changes_requested") {
    const returned = r?.decision === "changes_requested";
    const by = returned ? who(r.decidedBy) : "";
    const stages = [
      stage("prepare", "Prepare", "Editor", "current", returned ? "Changes were requested. Revise the draft, save it, then submit it again." : "Edit and save the draft, then submit it for review."),
      stage("review", "Review & Approve", "Another holder", returned ? "blocked" : "not_started",
        returned ? `${by === "you" ? "You" : by} asked for changes${r.decidedAt ? ` on ${day(r.decidedAt)}` : ""}${r.decisionNote ? `: "${r.decisionNote}"` : ""}.` : null),
      stage("publish", "Publish", "Any holder", "not_started", null),
    ];
    if (!viewer.canManage) return { stages, next: none(returned ? "Revise the draft and submit it again" : "Submit this draft for review", "A holder of the Competen Individual policy right prepares and submits it.", needRight) };
    return {
      stages,
      next: {
        headline: "Submit this draft for review",
        detail: returned ? "A reviewer asked for changes to this draft. Once it is revised and saved, submit it so another holder can approve it." : "Another holder of the Competen Individual policy right must approve this exact draft before it can be published.",
        action: "submit", viewer: { canAct: true, reason: null },
      },
    };
  }

  if (r.decision === null) {
    const mine = r.submittedBy === viewer.userId;
    const stages = [
      stage("prepare", "Prepare", "Editor", "done", `Submitted by ${who(r.submittedBy)} on ${day(r.submittedAt)}${r.note ? `: "${r.note}"` : ""}.`),
      stage("review", "Review & Approve", "Another holder", "current", mine ? "Waiting for another holder to approve." : "Needs a decision from a holder who did not submit it."),
      stage("publish", "Publish", "Any holder", "not_started", null),
    ];
    if (!viewer.canManage) return { stages, next: none("Review & approve", "Another holder of the Competen Individual policy right decides this draft.", needRight) };
    if (mine) {
      return { stages, next: none("Waiting for another holder to approve", "Your submission is with the other holders of the Competen Individual policy right.", "You submitted this draft, so another holder of the Competen Individual policy right must approve it.") };
    }
    return { stages, next: { headline: "Review & approve", detail: `${who(r.submittedBy)} submitted this draft on ${day(r.submittedAt)}. Approve it, or ask for changes with a note.`, action: "review", viewer: { canAct: true, reason: null } } };
  }

  // approved on exactly this content
  const mine = r.submittedBy === viewer.userId;
  const stages = [
    stage("prepare", "Prepare", "Editor", "done", `Submitted by ${who(r.submittedBy)} on ${day(r.submittedAt)}.`),
    stage("review", "Review & Approve", "Another holder", "done", `Approved by ${who(r.decidedBy)}${r.decidedAt ? ` on ${day(r.decidedAt)}` : ""}${r.decisionNote ? `: "${r.decisionNote}"` : ""}.`),
    stage("publish", "Publish", "Any holder", "current", mine ? "You submitted it and may publish it: the approval was independent." : "Any holder of the Competen Individual policy right may publish the approved draft."),
  ];
  if (!viewer.canManage) return { stages, next: none("Publish", "A holder of the Competen Individual policy right publishes the approved draft.", needRight) };
  return {
    stages,
    next: {
      headline: "Publish the approved draft",
      detail: mine ? "Another holder approved this exact draft. You submitted it, and the two-person rule lets you publish it." : "An independent holder approved this exact draft. Publishing makes it effective with the Individual policy. Any change to the draft after this needs a new review.",
      action: "publish", viewer: { canAct: true, reason: null },
    },
  };
}

export type ReviewWrite = { ok: true; reviewId?: string } | { ok: false; error: string; status: number };

/** Submit the current draft for review. The database refuses a non-holder, a draft equal to what is published, or a stale hash. */
export async function submitDocumentsReview(admin: Admin, actorId: string, note: string | null): Promise<ReviewWrite> {
  let hash: string | null;
  try { hash = await currentDraftHash(admin); } catch (e: any) { return { ok: false, error: plainReviewError(e?.message), status: 500 }; }
  if (!hash) return { ok: false, error: "There is no saved draft to submit. Save the draft first.", status: 409 };
  const clean = (note ?? "").trim().slice(0, 1000) || null;
  const { data, error } = await (admin as any).from("hq_config_review").insert({
    scope_type: POLICY_SCOPE.scopeType, scope_ref: POLICY_SCOPE.scopeRef, config_path: DOCUMENTS_PATH, draft_hash: hash, submitted_by: actorId, note: clean,
  }).select("id").maybeSingle();
  if (error) return { ok: false, error: plainReviewError(error.message), status: 409 };
  return { ok: true, reviewId: data?.id };
}

/** Decide a submission. The database refuses the submitter, a non-holder, a decided row and a request for changes without a note. */
export async function decideDocumentsReview(admin: Admin, actorId: string, reviewId: string, decision: "approved" | "changes_requested", note: string | null): Promise<ReviewWrite> {
  const a = admin as any;
  const { data: row, error: rErr } = await a.from("hq_config_review").select(COLUMNS).eq("id", reviewId).maybeSingle();
  if (rErr) return { ok: false, error: plainReviewError(rErr.message), status: 500 };
  if (!row) return { ok: false, error: "That submission was not found.", status: 404 };
  if (row.decision) return { ok: false, error: "That submission has already been decided.", status: 409 };
  let hash: string | null;
  try { hash = await currentDraftHash(admin); } catch (e: any) { return { ok: false, error: plainReviewError(e?.message), status: 500 }; }
  if (hash !== row.draft_hash) return { ok: false, error: "The draft has changed since it was submitted. Ask for it to be submitted again.", status: 409 };
  const { data, error } = await a.from("hq_config_review").update({ decided_by: actorId, decision, decision_note: (note ?? "").trim().slice(0, 1000) || null })
    .eq("id", reviewId).is("decision", null).select("id");
  if (error) return { ok: false, error: plainReviewError(error.message), status: 409 };
  if (!data?.length) return { ok: false, error: "That submission has already been decided.", status: 409 };
  return { ok: true, reviewId };
}

/** Every review row of the documents configuration, newest first, for the Governance History page. null = unreadable. */
export async function loadDocumentsReviews(admin: Admin, limit = 200): Promise<{ rows: DocumentsReviewRow[]; names: Record<string, string> } | null> {
  try {
    const { data, error } = await (admin as any).from("hq_config_review").select(COLUMNS)
      .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", DOCUMENTS_PATH)
      .order("submitted_at", { ascending: false }).limit(limit);
    if (error) return null;
    const rows = ((data ?? []) as any[]).map(toRow);
    return { rows, names: await namesOf(admin, rows.flatMap((r) => [r.submittedBy, r.decidedBy])) };
  } catch { return null; }
}
