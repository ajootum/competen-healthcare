/* eslint-disable @typescript-eslint/no-explicit-any */
import { currentTraceId } from "@/lib/trace";
import { isHoldingsGoverned, transitionFramework, versionLabel, type VersionLabel } from "./framework-lifecycle";
import { loadClinicalReviews } from "./clinical-review";
import { isId } from "./authoring";
import { applyPendingLayout, contentUnchangedSinceLastVersion, pendingLayout } from "./framework-layout";

// ── HOLDINGS FRAMEWORK PUBLICATION ── migration 467, owner COMPETENCY FRAMEWORKS: CENTRAL GOVERNANCE (26 Oct 2026) ──
//
// Competency frameworks are centrally governed, versioned platform resources. A shared framework with a CFCA layer (a
// CFCA framework that owns competencies, or a 394 controlled catalogue that names them) is published only here:
//
//   put forward   the Competency Author (hq.quality.competency.author) or, for a catalogue, its curator
//                 (hq.individual.config.manage). A draft goes into review. A PUBLISHED framework stays published while
//                 its revision is reviewed, so Scholar and Professional keep the version they consume.
//   decide        an independent publisher (hq.quality.competency.publish, the Quality Council Member): publish or
//                 return. Never somebody who put it forward, or who authored or curated any of its content.
//   publish       transitionFramework({ holdings: true }): the 466 guard still refuses unless every owned competency is
//                 clinically approved (395) at its current content. A republication names a major, minor or revision
//                 change and advances the governed version label consumers bind to (510, 520, 530).
//
// ⚠ INDEPENDENCE IS READ FROM THE AUDIT TRAIL. Authoring (465) and catalogue curation (394 route) record the actor
// before every write, on the framework, its domains or its competencies. Any such actor is a contributor. Governance
// acts (review, approval, publication) are not contribution.
//
// ⚠ THIS PUBLISHES NOTHING TO A PERSON. Offering a published framework to Scholar or Professional is the Individual
// policy allowlist, and verifying anybody against it is the Verification Studio (510). Neither changes here.

export const CHANGE_KINDS = ["major", "minor", "revision"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  major: "Major: competencies added, removed or materially changed",
  minor: "Minor: content refined, nothing removed",
  revision: "Revision: corrections and wording only",
};

/** Pure: the version label a publication carries. The first publication keeps the label the framework was drafted at. */
export function nextVersion(cur: Partial<VersionLabel>, kind: ChangeKind | null, firstPublication: boolean): VersionLabel | null {
  if (firstPublication) return null;
  const v = { major: cur.major ?? 1, minor: cur.minor ?? 0, revision: cur.revision ?? 0 };
  if (kind === "major") return { major: v.major + 1, minor: 0, revision: 0 };
  if (kind === "minor") return { major: v.major, minor: v.minor + 1, revision: 0 };
  if (kind === "revision") return { ...v, revision: v.revision + 1 };
  return null;
}

/**
 * Pure (FRAMEWORK-DESIGN-STUDIO-01, ruling 3): the kind of change a publication is. A publication whose only change is
 * a pending layout is a REVISION whatever was chosen. With content changes too, the publisher's choice applies.
 */
export function publicationKind(first: boolean, chosen: ChangeKind | null, layout: { pending: boolean; only: boolean }):
  { ok: true; kind: ChangeKind | null; forced: boolean } | { ok: false; error: string } {
  if (first) return { ok: true, kind: null, forced: false };
  if (layout.pending && layout.only) return { ok: true, kind: "revision", forced: chosen !== "revision" };
  if (!chosen) return { ok: false, error: "Say what kind of change this publication is: major, minor or revision." };
  return { ok: true, kind: chosen, forced: false };
}

/**
 * Audit actions that govern content rather than make it. Curating a catalogue's entries IS making it.
 * ⚠ reorder_layout (750/751, F4) is deliberately NOT here: whoever reordered a framework contributed to it and may not
 * publish it. It is excluded from AUTHORSHIP for clinical review instead (clinical-review.ts NOT_AUTHORSHIP).
 */
const GOVERNANCE = new Set(["submit_review", "approve_content", "reject_content", "publish", "archive", "revert",
  "catalogue_entry_review", "clinical_review_submitted", "clinical_review_decided", "clinical_scope_added", "clinical_scope_ended", "framework_specialty_set"]);

/** Pure: everybody who authored, edited or curated the content, from its audit trail. */
export function contributorsOf(audit: readonly { actor_id: string | null; action: string }[]): string[] {
  return [...new Set(audit.filter(a => a.actor_id && !GOVERNANCE.has(a.action)).map(a => a.actor_id as string))];
}

/** Pure: why this person may not decide this publication, or null. */
export function publisherConflict(publisherId: string, submitterId: string | null, contributors: readonly string[]): string | null {
  if (submitterId === publisherId) return "You put this framework forward, so a different publisher must decide it.";
  if (contributors.includes(publisherId)) return "You authored or curated content in this framework, so a different publisher must decide it.";
  return null;
}

const NOTE_MAX = 1000;
const note = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) : "") || null;

export type Actor = { userId: string; name: string | null };
type Fail = { ok: false; status: number; error: string };
type Result<T extends object = object> = ({ ok: true } & T) | Fail;

type Fw = { id: string; name: string; pub_status: string | null; version_num: number | null; hospital_id: string | null; competency_layer: string | null; version_major: number | null; version_minor: number | null; version_revision: number | null };

async function governed(admin: any, frameworkId: unknown): Promise<Result<{ fw: Fw }>> {
  if (!isId(frameworkId)) return { ok: false, status: 400, error: "Choose a framework." };
  const { data: fw, error } = await admin.from("frameworks")
    .select("id, name, pub_status, version_num, hospital_id, competency_layer, version_major, version_minor, version_revision").eq("id", frameworkId).maybeSingle();
  if (error) return { ok: false, status: 503, error: "The framework could not be read just now. Nothing has changed." };
  if (!fw || !isHoldingsGoverned(fw)) return { ok: false, status: 404, error: "That is not a centrally governed competency framework." };
  return { ok: true, fw };
}

async function pendingRequest(admin: any, frameworkId: string): Promise<{ id: string; submitted_by: string | null; submitted_at?: string | null } | null | undefined> {
  const { data, error } = await admin.from("content_approvals").select("id, submitted_by, submitted_at").eq("framework_id", frameworkId).eq("status", "pending")
    .order("submitted_at", { ascending: false }).limit(1);
  if (error) return undefined;
  return data?.[0] ?? null;
}

/** Every entity id whose audit rows are this framework's content: the framework, its domains, its competencies. */
async function contentEntityIds(admin: any, frameworkId: string): Promise<string[] | null> {
  const { data, error } = await admin.from("framework_domains").select("id, framework_competencies(id)").eq("framework_id", frameworkId);
  if (error) return null;
  return [frameworkId, ...(data ?? []).flatMap((d: any) => [d.id, ...(d.framework_competencies ?? []).map((c: any) => c.id)])];
}

async function audit(admin: any, actor: Actor, fw: Fw, action: string, detail: Record<string, unknown>) {
  await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: actor.userId, actor_name: actor.name, action,
    entity_type: "framework", entity_id: fw.id, entity_name: fw.name.slice(0, 200), new_value: detail,
  });
}

/** Put a framework forward for publication. A draft enters review, a published framework stays published. */
export async function submitForPublication(admin: any, actor: Actor, b: any): Promise<Result<{ status: string }>> {
  const g = await governed(admin, b?.frameworkId);
  if (!g.ok) return g;
  const fw = g.fw, status = fw.pub_status ?? "draft";
  if (status === "draft") {
    const r = await transitionFramework(admin, fw.id, "submit_review", { id: actor.userId, name: actor.name }, { holdings: true });
    if (!r.ok) return { ok: false, status: r.code ?? 500, error: r.error ?? "That could not be put forward. Nothing has changed." };
    return { ok: true, status: "in_review" };
  }
  if (status === "archived") return { ok: false, status: 409, error: "This framework is archived." };
  if (status !== "published") {
    // In review or approved by the legacy queue: put forward again only when no request is open.
    const open = await pendingRequest(admin, fw.id);
    if (open === undefined) return { ok: false, status: 503, error: "The publication request could not be read just now. Nothing has changed." };
    if (open) return { ok: false, status: 409, error: "This framework is already awaiting a publication decision." };
  }
  // A revision of live content (or a request reopened): the framework keeps its state while it is decided.
  const { error: supErr } = await admin.from("content_approvals").update({ status: "superseded" }).eq("framework_id", fw.id).eq("status", "pending");
  if (supErr) return { ok: false, status: 503, error: "The publication request could not be recorded just now. Nothing has changed." };
  const { error } = await admin.from("content_approvals").insert({ framework_id: fw.id, framework_name: fw.name, submitted_by: actor.userId, submitted_by_name: actor.name, status: "pending", comment: note(b?.note) });
  if (error) return { ok: false, status: 503, error: "The publication request could not be recorded just now. Nothing has changed." };
  await audit(admin, actor, fw, "submit_review", {
    ...(status === "published" ? { revision_of: versionLabel({ major: fw.version_major ?? 1, minor: fw.version_minor ?? 0, revision: fw.version_revision ?? 0 }) } : { reopened: status }),
    note: note(b?.note),
  });
  return { ok: true, status };
}

/** The independent publication decision: publish (466 still applies) or return with a reason. */
export async function decidePublication(admin: any, actor: Actor, b: any): Promise<Result<{ status: string; version?: string; warning?: string; layoutApplied?: boolean; changeKindForced?: boolean }>> {
  const g = await governed(admin, b?.frameworkId);
  if (!g.ok) return g;
  const fw = g.fw, status = fw.pub_status ?? "draft";
  if (b?.decision !== "publish" && b?.decision !== "return") return { ok: false, status: 400, error: "Choose publish or return." };
  const req = await pendingRequest(admin, fw.id);
  if (req === undefined) return { ok: false, status: 503, error: "The publication request could not be read just now. Nothing has changed." };
  if (!req || !["in_review", "approved", "published"].includes(status)) return { ok: false, status: 409, error: "Nothing is awaiting a publication decision on this framework." };

  const ids = await contentEntityIds(admin, fw.id);
  if (!ids) return { ok: false, status: 503, error: "The authorship trail could not be read, so nothing was decided." };
  const { data: trail, error: tErr } = await admin.from("audit_log").select("actor_id, action").in("entity_id", ids).limit(5000);
  if (tErr) return { ok: false, status: 503, error: "The authorship trail could not be read, so nothing was decided." };
  const conflict = publisherConflict(actor.userId, req.submitted_by, contributorsOf(trail ?? []));
  if (conflict) return { ok: false, status: 403, error: conflict };

  const reason = note(b?.note);
  const decided = { reviewed_by: actor.userId, reviewed_by_name: actor.name, reviewed_at: new Date().toISOString(), comment: reason };
  if (b.decision === "return") {
    if (!reason) return { ok: false, status: 400, error: "Say why it is returned, so the author knows what to change." };
    if (status !== "published") {
      const r = await transitionFramework(admin, fw.id, "revert", { id: actor.userId, name: actor.name }, { holdings: true });
      if (!r.ok) return { ok: false, status: r.code ?? 500, error: r.error ?? "That could not be returned. Nothing has changed." };
    }
    await admin.from("content_approvals").update({ ...decided, status: "rejected" }).eq("id", req.id);
    await audit(admin, actor, fw, "reject_content", { note: reason });
    return { ok: true, status: status === "published" ? "published" : "draft" };
  }

  const first = (fw.version_num ?? 0) === 0;
  const chosen = (CHANGE_KINDS as readonly string[]).includes(b?.changeKind) ? (b.changeKind as ChangeKind) : null;
  // FRAMEWORK-DESIGN-STUDIO-01 (750): a pending layout is what was put forward only if it did not change after the
  // request. It is applied to the live order BEFORE the snapshot, and undone if the publication is refused.
  const lay = await pendingLayout(admin, fw.id);
  if (lay && "ok" in lay) return { ok: false, status: lay.status, error: "The layout could not be read just now, so nothing was decided." };
  if (lay && lay.at && req.submitted_at && Date.parse(lay.at) > Date.parse(req.submitted_at))
    return { ok: false, status: 409, error: "The layout was changed after this framework was put forward. It must be put forward again, so the decision is on what will be published." };
  const k = publicationKind(first, chosen, { pending: !!lay, only: !!lay && !first && (await contentUnchangedSinceLastVersion(admin, fw.id)) });
  if (!k.ok) return { ok: false, status: 400, error: k.error };
  const kind = k.kind;
  const next = nextVersion({ major: fw.version_major ?? 1, minor: fw.version_minor ?? 0, revision: fw.version_revision ?? 0 }, kind, first);
  const applied = lay ? await applyPendingLayout(admin, fw.id, lay.layout) : null;
  if (applied && "ok" in applied) return { ok: false, status: applied.status, error: applied.error };
  const r = await transitionFramework(admin, fw.id, "publish", { id: actor.userId, name: actor.name }, { holdings: true, nextVersion: next, note: reason });
  if (!r.ok) {
    if (applied) await applied.undo();
    return { ok: false, status: r.code ?? 500, error: r.error ?? "That could not be published. Nothing has changed." };
  }
  let warning = r.warning;
  if (applied) {
    const { error: clrErr } = await admin.from("frameworks").update({ layout_draft: null }).eq("id", fw.id);
    if (clrErr) warning = [warning, "Published with the new layout, but the layout draft could not be cleared. Discard it in the Studio."].filter(Boolean).join(" ");
  }
  await admin.from("content_approvals").update({ ...decided, status: "approved" }).eq("id", req.id);
  const label = versionLabel(next ?? { major: fw.version_major ?? 1, minor: fw.version_minor ?? 0, revision: fw.version_revision ?? 0 });
  await audit(admin, actor, fw, "approve_content", { version: label, change: kind, note: reason, ...(applied ? { layout_applied: true, change_forced: k.forced } : {}) });
  return { ok: true, status: "published", version: label, warning, ...(applied ? { layoutApplied: true, changeKindForced: k.forced } : {}) };
}

/** Withdraw a published framework from use. Its versions stay on record. */
export async function archivePublication(admin: any, actor: Actor, b: any): Promise<Result<{ status: string }>> {
  const g = await governed(admin, b?.frameworkId);
  if (!g.ok) return g;
  if ((g.fw.pub_status ?? "draft") !== "published") return { ok: false, status: 409, error: "Only a published framework is archived." };
  const reason = note(b?.note);
  if (!reason) return { ok: false, status: 400, error: "Say why it is archived. Scholar and Professional stop offering it." };
  // The reason rides on the transition's own "archive" audit row, a governance action (never authorship).
  const r = await transitionFramework(admin, g.fw.id, "archive", { id: actor.userId, name: actor.name }, { holdings: true, note: reason });
  if (!r.ok) return { ok: false, status: r.code ?? 500, error: r.error ?? "That could not be archived. Nothing has changed." };
  await admin.from("content_approvals").update({ status: "superseded" }).eq("framework_id", g.fw.id).eq("status", "pending");
  return { ok: true, status: "archived" };
}

// ── The read side ──

export type PublicationRow = {
  id: string; code: string | null; name: string; layer: string; status: string; version: string; publishedCount: number;
  kind: "framework" | "catalogue"; competencies: number; clinicallyApproved: number | null; catalogueEntries: number;
  pending: { submittedByName: string | null; submittedAt: string; note: string | null; revision: boolean } | null;
  versions: { num: number; label: string | null; publishedAt: string; by: string | null; notes: string | null }[];
  methods: { name: string; version: number }[] | null;
};

export async function loadPublicationView(admin: any): Promise<{ rows: PublicationRow[]; methodsReadable: boolean } | null> {
  try {
    const { data: fws, error } = await admin.from("frameworks")
      .select("id, code, name, competency_layer, pub_status, version_num, version_major, version_minor, version_revision, framework_domains(framework_competencies(id))")
      .is("hospital_id", null).not("competency_layer", "is", null).order("name").limit(200);
    if (error) return null;
    const fwIds = (fws ?? []).map((f: any) => f.id);
    const compIds: string[] = (fws ?? []).flatMap((f: any) => (f.framework_domains ?? []).flatMap((d: any) => (d.framework_competencies ?? []).map((c: any) => c.id)));
    const [reviews, entries, pend, vers, methods] = await Promise.all([
      compIds.length ? loadClinicalReviews(admin, compIds) : Promise.resolve(new Map()),
      fwIds.length ? admin.from("competency_catalogue_entry").select("catalogue_id").in("catalogue_id", fwIds) : Promise.resolve({ data: [] }),
      fwIds.length ? admin.from("content_approvals").select("framework_id, submitted_by_name, submitted_at, comment").in("framework_id", fwIds).eq("status", "pending") : Promise.resolve({ data: [] }),
      fwIds.length ? admin.from("framework_versions").select("framework_id, version_num, published_at, published_by_name, notes, snapshot->>version_label").in("framework_id", fwIds).order("version_num", { ascending: false }) : Promise.resolve({ data: [] }),
      admin.from("competency_verification_method_version").select("version_no, content, competency_verification_method(name)").eq("state", "published"),
    ]);
    if (pend.error || vers.error) return null;
    const methodsReadable = !methods.error;
    const rows: PublicationRow[] = (fws ?? []).map((f: any) => {
      const own: string[] = (f.framework_domains ?? []).flatMap((d: any) => (d.framework_competencies ?? []).map((c: any) => c.id));
      const p = (pend.data ?? []).find((x: any) => x.framework_id === f.id);
      const status = f.pub_status ?? "draft";
      const applies = (m: any) => {
        const a = m?.content?.applicability ?? {};
        return (a.frameworkIds ?? []).includes(f.id) || (a.competencyIds ?? []).some((id: string) => own.includes(id));
      };
      return {
        id: f.id, code: f.code ?? null, name: f.name, layer: f.competency_layer, status, publishedCount: f.version_num ?? 0,
        version: versionLabel({ major: f.version_major ?? 1, minor: f.version_minor ?? 0, revision: f.version_revision ?? 0 }),
        kind: own.length ? "framework" : "catalogue", competencies: own.length,
        clinicallyApproved: reviews ? own.filter(id => reviews.get(id)?.state === "approved").length : null,
        catalogueEntries: (entries.data ?? []).filter((e: any) => e.catalogue_id === f.id).length,
        pending: p ? { submittedByName: p.submitted_by_name ?? null, submittedAt: p.submitted_at, note: p.comment ?? null, revision: status === "published" } : null,
        versions: (vers.data ?? []).filter((v: any) => v.framework_id === f.id).map((v: any) => ({ num: v.version_num, label: v.version_label ?? null, publishedAt: v.published_at, by: v.published_by_name ?? null, notes: v.notes ?? null })),
        methods: methodsReadable ? (methods.data ?? []).filter(applies).map((m: any) => ({ name: m.competency_verification_method?.name ?? "Method", version: m.version_no })) : null,
      };
    });
    return { rows, methodsReadable };
  } catch { return null; }
}
