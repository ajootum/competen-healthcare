/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRevision, loadRevisionDiff, revisionReviews, revisionsReady } from "./framework-revision";
import { loadFrameworkDiff, type DiffResponse, type FrameworkDiff } from "./framework-diff";
import type { RevisionView } from "./revision-ui";

// FRAMEWORK-DESIGN-STUDIO-02 S6: the server reads the Studio pages need for a revised framework. Read only. The same shape
// the revision_view action answers (route.ts), read directly because the page runs on the server. The writes are the S5 API.

export type RevisionState =
  | { ready: false }                                  // 770 is not on this environment: a published framework is not changed here
  | { ready: true; revision: RevisionView | null }
  | { ready: true; error: string };                   // unreadable: nothing is shown rather than a partial view

/** Whether 770 is on, and the open revision of a published framework with the review state at its PROPOSED content. */
export async function loadRevisionState(admin: any, frameworkId: string): Promise<RevisionState> {
  const ready = await revisionsReady(admin);
  if (ready === false) return { ready: false };
  if (ready === null) return { ready: true, error: "The revision draft could not be read just now. Nothing is shown rather than a partial view." };
  const r = await loadRevision(admin, frameworkId);
  if (r && "ok" in r) return { ready: true, error: r.error };
  if (!r) return { ready: true, revision: null };
  const proposed = new Map([...r.hashes].map(([id, h]) => [id, h.proposed]));
  const reviews = await revisionReviews(admin, r.comps.map(c => c.competency_id), proposed);
  return { ready: true, revision: {
    id: r.head.id, createdBy: r.head.created_by, createdAt: r.head.created_at, updatedAt: r.head.updated_at,
    competencies: r.comps.map(c => {
      const h = r.hashes.get(c.competency_id);
      return {
        id: c.competency_id, isNew: !c.origin_competency_id, domainId: c.domain_id, sortOrder: c.sort_order, code: c.code, name: c.name, description: c.description,
        learningOutcomes: c.learning_outcomes ?? [], expectedLevelId: c.expected_level_id, riskCategory: c.risk_category, practiceId: c.practice_id, cpuId: c.cpu_id,
        proposedHash: h?.proposed ?? null, liveHash: h?.live ?? null, changed: (h?.proposed ?? null) !== (h?.live ?? null), clinical: reviews?.get(c.competency_id) ?? null,
        criteria: r.crits.filter(k => k.competency_id === c.competency_id).sort((a, b) => a.sort_order - b.sort_order)
          .map(k => ({ id: k.skill_id, isNew: !k.origin_skill_id, text: k.name, component: k.component_code, sourceRef: k.source_ref, sortOrder: k.sort_order, active: k.is_active })),
      };
    }),
  } };
}

export type RevisionDiffResponse =
  | { status: "no_revision"; framework: { id: string; name: string; pubStatus: string } }
  | { status: "compared"; revision: { id: string; updatedAt: string }; framework: { id: string; name: string; pubStatus: string }; version: { num: number; label: string; publishedAt: string | null; publishedBy: string | null }; diff: FrameworkDiff };

/** The published version against the open revision (compare_revision), with the published version it is compared with. */
export async function loadRevisionComparison(admin: any, frameworkId: string): Promise<RevisionDiffResponse | { status: number; error: string }> {
  const [rd, base] = await Promise.all([loadRevisionDiff(admin, frameworkId), loadFrameworkDiff(admin, frameworkId)]);
  if ("ok" in rd) return { status: rd.status, error: rd.error };
  if ("error" in base) return base;
  if (rd.status === "no_revision") return { status: "no_revision", framework: base.framework };
  if (base.status !== "compared") return { status: 409, error: "This framework has no published version to compare the revision with." };
  return { status: "compared", revision: rd.revision, framework: base.framework, version: base.version, diff: rd.diff };
}

export type { DiffResponse };
