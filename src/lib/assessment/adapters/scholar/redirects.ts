import { experienceHref } from "@/lib/individual/experiences";

// ── THE OLD MY COMPETENCIES LEAVES ── Checklist Studio S3 ────────────────────────────────────────────────────────────
//
// Pure. My Competencies is three leaves now: Overview, Assessments, My Evidence. The five older pages stay as gated redirect
// stubs (each still calls experienceModulePage and the module gate FIRST, so a person who may not see the module gets the same
// not-found as before), and an old bookmark lands on the section that took over its job.

export const OLD_LEAVES = ["profile", "frameworks", "gaps", "practice", "verification"] as const;
export type OldLeaf = (typeof OLD_LEAVES)[number];

export const OLD_LEAF_TARGET: Record<OldLeaf, string> = {
  profile: "my-competencies",
  frameworks: "my-competencies#frameworks",
  gaps: "my-competencies#gaps",
  practice: "my-competencies/assessments#practice",
  verification: "my-competencies/evidence#verification",
};

/** Where an old leaf now lives, carrying ?study= (before any #fragment) when a study session is open. */
export function redirectFor(leaf: OldLeaf, study?: string | null): string {
  const target = OLD_LEAF_TARGET[leaf];
  const hashAt = target.indexOf("#");
  const path = hashAt >= 0 ? target.slice(0, hashAt) : target;
  const hash = hashAt >= 0 ? target.slice(hashAt) : "";
  const q = study && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(study) ? `?study=${study}` : "";
  return `${experienceHref("scholar", path)}${q}${hash}`;
}
