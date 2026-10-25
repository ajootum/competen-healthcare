/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbRefusal } from "./governance";

// ── CKRI RESEARCH WORKSPACE ── COMPETEN-KNOWLEDGE-RESEARCH-01 s6-s8 (K4), migration 443 ────────────────────────────────
//
// Thin by design, like research-governance.ts. Every rule -- who writes a document, freezes it, joins the team,
// approves a dataset, reviews, decides publication; aggregate-only access; the protocol and output integrity fields;
// the AI-marked declaration; independence of reviewers and deciders -- is the 443 trigger's and CHECK's.
//
// ⚠ A DATASET IS A SNAPSHOT, NEVER ROWS. Approving one names an existing 441 snapshot. Nothing here reads, exports or
// shares learner records, and no external account is created: a team member is an existing profile.

type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (s: string) => !UUID.test(s);
const out = (error: any, fb: string, extra: Record<string, unknown> = {}): any => error ? { ok: false, error: dbRefusal(error, fb) } : { ok: true, ...extra };

export const PROTOCOL_FIELDS = ["population", "selection_criteria", "instruments", "scoring", "missing_data", "statistical_methods", "limitations", "generalisability"] as const;
export const INTEGRITY_FIELDS = ["population", "selection", "provenance", "instrument_version", "scoring", "missing_data", "uncertainty", "methods", "limitations", "generalisability", "reproducibility"] as const;
export const DOCUMENT_KINDS = ["proposal", "protocol", "analysis_plan", "manuscript"] as const;

const pick = (o: any, keys: readonly string[], n = 4000) => Object.fromEntries(keys.map(k => [k, typeof o?.[k] === "string" ? o[k].trim().slice(0, n) : ""]));

export async function writeDocument(admin: any, me: string, d: { projectId: string; kind: string; fields: Record<string, unknown> }): Promise<R<{ id: string }>> {
  if (bad(d.projectId) || !(DOCUMENT_KINDS as readonly string[]).includes(d.kind)) return { ok: false, error: "Choose a project and a document kind." };
  const content = d.kind === "protocol" ? pick(d.fields, PROTOCOL_FIELDS) : { text: typeof d.fields.text === "string" ? d.fields.text.slice(0, 150000) : "" };
  const { data: last } = await admin.from("ckri_research_document").select("version_no").eq("project_id", d.projectId).eq("kind", d.kind).order("version_no", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await admin.from("ckri_research_document").insert({ project_id: d.projectId, kind: d.kind, version_no: (last?.version_no ?? 0) + 1, content, authored_by: me }).select("id").single();
  return out(error, "The document could not be saved.", { id: data?.id });
}

export async function freezeDocument(admin: any, me: string, id: string): Promise<R> {
  if (bad(id)) return { ok: false, error: "Unknown document." };
  const { error } = await admin.from("ckri_research_document").update({ state: "frozen", frozen_by: me }).eq("id", id);
  return out(error, "The document could not be frozen.");
}

export async function proposeMember(admin: any, m: { projectId: string; personId: string; role: string; external: boolean; agreementRef: string | null }): Promise<R<{ id: string }>> {
  if (bad(m.projectId) || bad(m.personId)) return { ok: false, error: "Choose a project and an existing person." };
  const { data, error } = await admin.from("ckri_research_member").insert({ project_id: m.projectId, person_id: m.personId, role: m.role, external: m.external || m.role === "external_collaborator", agreement_ref: m.agreementRef }).select("id").single();
  return out(error, "The appointment could not be proposed.", { id: data?.id });
}

export async function moveMember(admin: any, me: string, id: string, to: "active" | "ended"): Promise<R> {
  if (bad(id)) return { ok: false, error: "Unknown appointment." };
  const { error } = await admin.from("ckri_research_member").update(to === "active" ? { status: "active", appointed_by: me } : { status: "ended" }).eq("id", id);
  return out(error, "The appointment could not be changed.");
}

export async function approveDataset(admin: any, me: string, d: { projectId: string; snapshotId: string; label: string }): Promise<R<{ id: string }>> {
  if (bad(d.projectId) || bad(d.snapshotId)) return { ok: false, error: "Choose a project and a snapshot." };
  const { data, error } = await admin.from("ckri_research_dataset").insert({ project_id: d.projectId, snapshot_id: d.snapshotId, label: d.label, approved_by: me }).select("id").single();
  return out(error, "The dataset could not be approved.", { id: data?.id });
}

export async function writeOutput(admin: any, me: string, o: { projectId: string; datasetIds: string[]; title: string; results: string; integrity: Record<string, unknown>; usesAiMarked: boolean; freeze: boolean }): Promise<R<{ id: string }>> {
  if (bad(o.projectId) || !o.datasetIds.length || o.datasetIds.some(bad)) return { ok: false, error: "Choose the project and its approved datasets." };
  let results: unknown;
  try { results = JSON.parse(o.results); } catch { return { ok: false, error: "Results are a JSON object of aggregate figures." }; }
  const integrity = { ...pick(o.integrity, INTEGRITY_FIELDS), ...(o.usesAiMarked ? { ai_marked_statement: typeof o.integrity.ai_marked_statement === "string" ? o.integrity.ai_marked_statement.slice(0, 2000) : "" } : {}) };
  const { data, error } = await admin.from("ckri_research_output").insert({ project_id: o.projectId, dataset_ids: o.datasetIds, title: o.title, results, integrity, uses_ai_marked: o.usesAiMarked, authored_by: me, state: o.freeze ? "frozen" : "draft" }).select("id").single();
  return out(error, "The output could not be saved.", { id: data?.id });
}

export async function reviewItem(admin: any, me: string, r: { projectId: string; documentId: string | null; outputId: string | null; decision: string; comments: string }): Promise<R> {
  if (bad(r.projectId)) return { ok: false, error: "Unknown project." };
  const { error } = await admin.from("ckri_research_review").insert({ project_id: r.projectId, document_id: r.documentId, output_id: r.outputId, reviewer_id: me, decision: r.decision, comments: r.comments });
  return out(error, "The review could not be recorded.");
}

export async function requestPublication(admin: any, me: string, p: { projectId: string; manuscriptId: string; venue: string }): Promise<R<{ id: string }>> {
  if (bad(p.projectId) || bad(p.manuscriptId)) return { ok: false, error: "Choose the project and its frozen manuscript." };
  const { data, error } = await admin.from("ckri_publication").insert({ project_id: p.projectId, manuscript_id: p.manuscriptId, venue: p.venue, requested_by: me, changed_by: me }).select("id").single();
  return out(error, "The publication could not be requested.", { id: data?.id });
}

/** approve needs the integrity attestation, made by the decider in the same act (443 refuses it afterwards). */
export async function movePublication(admin: any, me: string, id: string, to: "approved" | "rejected" | "published" | "withdrawn", x: { note?: string | null; attest?: boolean }): Promise<R> {
  if (bad(id)) return { ok: false, error: "Unknown publication." };
  const patch: Record<string, unknown> = { status: to, changed_by: me };
  if (to === "approved" || to === "rejected") patch.decided_by = me;
  if (to === "approved") patch.integrity_attested = x.attest === true;
  if (x.note) patch.note = x.note;
  const { error } = await admin.from("ckri_publication").update(patch).eq("id", id);
  return out(error, "That could not be done.");
}

export async function correctPublication(admin: any, me: string, id: string, note: string): Promise<R> {
  if (bad(id)) return { ok: false, error: "Unknown publication." };
  const { error } = await admin.rpc("ckri_publication_correct", { p_publication: id, p_actor: me, p_note: note });
  return out(error, "The correction could not be recorded.");
}

export const INTEGRITY_ATTESTATION = "This manuscript does not claim improved patient outcomes from Scholar performance, does not present AI-generated or AI-marked evaluations as independently validated measurements, and states its population, provenance, instruments, missing data, uncertainty, limitations and generalisability.";

export type ProjectView = {
  id: string; code: string; title: string; purpose_code: string; sponsor: string; status: string; min_cohort: number; proposed_by: string; retain_until: string | null; mine: boolean;
  documents: { id: string; project_id: string; kind: string; version_no: number; state: string; content_hash: string; frozen_at: string | null }[];
  members: { id: string; project_id: string; person_id: string; role: string; external: boolean; agreement_ref: string | null; status: string }[];
  datasets: { id: string; project_id: string; snapshot_id: string; label: string; approved_at: string }[];
  outputs: { id: string; project_id: string; title: string; state: string; uses_ai_marked: boolean; frozen_at: string | null }[];
  reviews: { project_id: string; document_id: string | null; output_id: string | null; decision: string; created_at: string }[];
  publications: { id: string; project_id: string; manuscript_id: string; venue: string; status: string; integrity_attested: boolean; updated_at: string }[];
  snapshots: { id: string; measure: string; period_from: string; period_to: string; cohort_dimension: string; min_cohort: number }[];
};

/** The projects this person proposes or is on, or every project for a governor, with their workspace records. */
export async function workspace(admin: any, me: string, all: boolean): Promise<ProjectView[] | null> {
  const memberOf = await admin.from("ckri_research_member").select("project_id").eq("person_id", me).eq("status", "active");
  if (memberOf.error) return null;
  let q = admin.from("ckri_research_project").select("id, code, title, purpose_code, sponsor, status, min_cohort, proposed_by, retain_until").order("updated_at", { ascending: false }).limit(50);
  if (!all) { const ids = [me, ...(memberOf.data ?? []).map((m: any) => m.project_id)]; q = q.or(`proposed_by.eq.${me},id.in.(${ids.filter(i => UUID.test(i)).join(",")})`); }
  const { data: projects, error } = await q;
  if (error) return null;
  const ids = (projects ?? []).map((p: any) => p.id);
  if (!ids.length) return [];
  const [docs, members, datasets, outputs, reviews, pubs, snaps] = await Promise.all([
    admin.from("ckri_research_document").select("id, project_id, kind, version_no, state, content_hash, frozen_at").in("project_id", ids).order("version_no", { ascending: false }),
    admin.from("ckri_research_member").select("id, project_id, person_id, role, external, agreement_ref, status").in("project_id", ids),
    admin.from("ckri_research_dataset").select("id, project_id, snapshot_id, label, approved_at").in("project_id", ids),
    admin.from("ckri_research_output").select("id, project_id, title, state, uses_ai_marked, frozen_at").in("project_id", ids),
    admin.from("ckri_research_review").select("project_id, document_id, output_id, decision, created_at").in("project_id", ids),
    admin.from("ckri_publication").select("id, project_id, manuscript_id, venue, status, integrity_attested, updated_at").in("project_id", ids),
    admin.from("ckri_snapshot").select("id, measure, period_from, period_to, cohort_dimension, min_cohort").order("built_at", { ascending: false }).limit(50),
  ]);
  if ([docs, members, datasets, outputs, reviews, pubs].some(x => x.error)) return null;
  const by = (rows: any[], id: string) => (rows ?? []).filter((r: any) => r.project_id === id);
  return (projects ?? []).map((p: any) => ({
    ...p, mine: p.proposed_by === me, documents: by(docs.data, p.id), members: by(members.data, p.id), datasets: by(datasets.data, p.id),
    outputs: by(outputs.data, p.id), reviews: by(reviews.data, p.id), publications: by(pubs.data, p.id), snapshots: snaps.data ?? [],
  }));
}
