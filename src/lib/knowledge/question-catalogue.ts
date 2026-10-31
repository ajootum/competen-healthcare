/* eslint-disable @typescript-eslint/no-explicit-any */
import { clinicalState, versionStatus, type VersionStatus } from "./educator";
import { libraryContentOf, type LibraryDisplay } from "./question-content";
import { findDuplicatePairs, type SimilarPair } from "./question-similarity";
import { sourceOf, type QuestionSource } from "./question-source";

// ── HQ QUESTION LIBRARY CATALOGUE ── SQIE-COMPLETE-01 (owner GO 31 Oct 2026) ──────────────────────────────────────────────
//
// A READ MODEL over the CKRI knowledge library (migration 442): revision_question resources, every version of each, the
// competencies they teach, who wrote, reviewed, approved and published them. Nothing here is a new store or engine, and
// nothing writes. Actions stay where they were (educator, knowledge-review, knowledge-publication).
// ⚠ Names are HQ staff (profiles.full_name of authors, reviewers, publishers), never learners.

export type TrailEntry = { role: "author" | "educator_review" | "submitted" | "clinical_approved" | "clinical_rejected" | "published"; name: string; at: string | null; comment?: string | null };
export type CatalogueVersion = {
  id: string; versionNo: number; state: string; status: VersionStatus; origin: string; aiProvenance: { model?: string; prompt_version?: string } | null;
  content: unknown; stem: string; options: string[]; correctIndex: number | null; rationale: string; source: QuestionSource | null;
  /** SQIE-LIBRARY-EXPANSION-01 (800): the format, the key in words, the marking rule and the rubric. */
  format: string; formatLabel: string; keyText: string; marking: string; rubric: LibraryDisplay["rubric"];
  competencyIds: string[]; approvals: number; required: number | null; educatorReviewed: boolean;
  createdAt: string; submittedAt: string | null; publishedAt: string | null; trail: TrailEntry[];
};
export type CatalogueItem = {
  resourceId: string; code: string; title: string; resourceStatus: string; createdAt: string;
  versions: CatalogueVersion[]; latest: CatalogueVersion; served: CatalogueVersion | null;
  competencyIds: string[]; topics: string[];
};
export type Catalogue = { items: CatalogueItem[]; competencyNames: Map<string, string>; pairs: SimilarPair[]; pairsTruncated: boolean };

/** Pure. The topic of a resource: its title (educators title a question by its topic). */
export const topicsOf = (title: string): string[] => [title.trim()].filter(Boolean);

// SQIE-LIBRARY-EXPANSION-01 (801): "active" = learners are given a version now (published, approved, resource active).
export const STATUS_FILTERS = ["active", "draft", "submitted", "reviewed", "approved", "published", "superseded", "retired"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type CatalogueFilters = { q?: string; status?: string; origin?: string; competency?: string; topic?: string; duplicates?: boolean };

/**
 * Pure. Which filter statuses a version answers to. draft = not submitted; submitted = in clinical review (or rejected);
 * reviewed = educator-reviewed on its current content; approved = clinically approved (approved or published); published,
 * superseded and retired are the three end states.
 */
export function versionStatuses(v: Pick<CatalogueVersion, "status" | "educatorReviewed">): StatusFilter[] {
  const out: StatusFilter[] = [];
  if (v.status === "draft") out.push("draft");
  if (v.status === "in_review" || v.status === "rejected") out.push("submitted");
  if (v.educatorReviewed) out.push("reviewed");
  if (v.status === "approved" || v.status === "published") out.push("approved");
  if (v.status === "published" || v.status === "superseded" || v.status === "retired") out.push(v.status);
  return out;
}

/** Pure. The items a search and filters leave. Status matches the LATEST version (or the served one for "published"). */
export function filterCatalogue(items: readonly CatalogueItem[], f: CatalogueFilters, dupIds: ReadonlySet<string>): CatalogueItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const topic = (f.topic ?? "").trim().toLowerCase();
  return items.filter(i => {
    if (q && !(i.code.toLowerCase().includes(q) || i.title.toLowerCase().includes(q) || i.versions.some(v => v.stem.toLowerCase().includes(q)))) return false;
    if (f.status === "active") { if (!i.served || i.resourceStatus !== "active") return false; }
    else if (f.status && !(versionStatuses(i.latest) as string[]).includes(f.status) && !(f.status === "published" && i.served)) return false;
    if (f.origin && !i.versions.some(v => v.origin === f.origin)) return false;
    if (f.competency && !i.competencyIds.includes(f.competency)) return false;
    if (topic && !i.topics.some(t => t.toLowerCase().includes(topic))) return false;
    if (f.duplicates && !i.versions.some(v => dupIds.has(v.id))) return false;
    return true;
  });
}

const nameOf = (m: Map<string, string>, id: string | null | undefined) => (id ? m.get(id) ?? "Unknown user" : "Unknown user");

/** Reads the whole revision-question library. null when 442 cannot be read. Bounded: 500 resources, 3000 versions. */
export async function loadCatalogue(admin: any): Promise<Catalogue | null> {
  const res = await admin.from("ckri_knowledge_resource").select("id, code, title, status, created_at").eq("kind", "revision_question").order("created_at", { ascending: false }).limit(500);
  if (res.error) return null;
  const rids = (res.data ?? []).map((r: any) => r.id);
  if (!rids.length) return { items: [], competencyNames: new Map(), pairs: [], pairsTruncated: false };
  const vers = await admin.from("ckri_knowledge_version").select("id, resource_id, version_no, content, content_hash, origin, ai_provenance, state, authored_by, educator_reviewed_by, educator_reviewed_hash, educator_reviewed_at, submitted_by, submitted_at, published_by, published_at, created_at")
    .in("resource_id", rids).order("version_no", { ascending: false }).limit(3000);
  if (vers.error) return null;
  const vids = (vers.data ?? []).map((v: any) => v.id);
  const [links, ccv] = await Promise.all([
    vids.length ? admin.from("ckri_knowledge_version_competency").select("version_id, competency_id").in("version_id", vids).limit(10000) : { data: [] },
    vids.length ? admin.from("clinical_content_version").select("id, knowledge_version_id, required_approvals").in("knowledge_version_id", vids).limit(5000) : { data: [] },
  ]);
  const ccvIds = (ccv.data ?? []).map((c: any) => c.id);
  const { data: decisions } = ccvIds.length ? await admin.from("clinical_review_decision").select("version_id, reviewer_id, decision, comment, created_at").in("version_id", ccvIds).limit(10000) : { data: [] };
  const compIds = [...new Set((links.data ?? []).map((l: any) => l.competency_id))] as string[];
  const people = new Set<string>();
  for (const v of vers.data ?? []) { for (const a of v.authored_by ?? []) people.add(a); for (const x of [v.educator_reviewed_by, v.submitted_by, v.published_by]) if (x) people.add(x); }
  for (const d of decisions ?? []) people.add(d.reviewer_id);
  const [comps, profiles] = await Promise.all([
    compIds.length ? admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 500)) : { data: [] },
    people.size ? admin.from("profiles").select("id, full_name").in("id", [...people].slice(0, 500)) : { data: [] },
  ]);
  const competencyNames = new Map<string, string>(((comps.data ?? []) as any[]).map(c => [c.id, String(c.name ?? c.id)]));
  const who = new Map<string, string>(((profiles.data ?? []) as any[]).map(p => [p.id, String(p.full_name ?? "Unnamed")]));

  const items: CatalogueItem[] = (res.data ?? []).map((r: any): CatalogueItem | null => {
    const versions: CatalogueVersion[] = (vers.data ?? []).filter((v: any) => v.resource_id === r.id).map((v: any): CatalogueVersion => {
      const review = (ccv.data ?? []).filter((c: any) => c.knowledge_version_id === v.id);
      const reviewIds = new Set(review.map((c: any) => c.id));
      const ds = (decisions ?? []).filter((d: any) => reviewIds.has(d.version_id));
      const required = review[0]?.required_approvals ?? null;
      const clinical = clinicalState(v.state, ds, required);
      const c = libraryContentOf(v.content);
      const trail: TrailEntry[] = [
        ...(v.authored_by ?? []).map((a: string): TrailEntry => ({ role: "author", name: nameOf(who, a), at: v.created_at })),
        ...(v.educator_reviewed_by ? [{ role: "educator_review" as const, name: nameOf(who, v.educator_reviewed_by), at: v.educator_reviewed_at ?? null }] : []),
        ...(v.submitted_by ? [{ role: "submitted" as const, name: nameOf(who, v.submitted_by), at: v.submitted_at ?? null }] : []),
        ...ds.map((d: any): TrailEntry => ({ role: d.decision === "approved" ? "clinical_approved" : "clinical_rejected", name: nameOf(who, d.reviewer_id), at: d.created_at, comment: d.comment ?? null })),
        ...(v.published_by ? [{ role: "published" as const, name: nameOf(who, v.published_by), at: v.published_at ?? null }] : []),
      ];
      return {
        id: v.id, versionNo: v.version_no, state: v.state, status: versionStatus(v.state, clinical), origin: v.origin, aiProvenance: v.ai_provenance ?? null,
        content: v.content, stem: c?.stem ?? "", options: c?.options ?? [], correctIndex: c?.correctIndex ?? null, rationale: c?.rationale ?? "", source: sourceOf(v.content),
        format: c?.format ?? "mcq", formatLabel: c?.formatLabel ?? "Single best answer", keyText: c?.keyText ?? "", marking: c?.marking ?? "Not recorded", rubric: c?.rubric ?? null,
        competencyIds: (links.data ?? []).filter((l: any) => l.version_id === v.id).map((l: any) => l.competency_id),
        approvals: ds.filter((d: any) => d.decision === "approved").length, required,
        educatorReviewed: !!v.educator_reviewed_by && v.educator_reviewed_hash === v.content_hash,
        createdAt: v.created_at, submittedAt: v.submitted_at ?? null, publishedAt: v.published_at ?? null, trail,
      };
    });
    if (!versions.length) return null;
    // A retired version (801) is never served, and a retired resource serves nothing.
    const served = r.status === "active" ? versions.find(v => v.status === "published") ?? null : null;
    return { resourceId: r.id, code: r.code, title: r.title, resourceStatus: r.status, createdAt: r.created_at, versions, latest: versions[0], served,
      competencyIds: [...new Set(versions.flatMap(v => v.competencyIds))], topics: topicsOf(r.title) };
  }).filter((x: CatalogueItem | null): x is CatalogueItem => !!x);

  // Pairwise duplicates over each resource's latest version (bounded, see question-similarity.ts).
  const dup = findDuplicatePairs(items.map(i => ({ id: i.latest.id, content: i.latest.content })));
  return { items, competencyNames, pairs: dup.pairs, pairsTruncated: dup.truncated };
}
