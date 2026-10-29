/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadClinicalReviews, submitForReview, type ClinicalReview } from "./clinical-review";

// ── PUTTING MANY COMPETENCIES FORWARD FOR CLINICAL REVIEW ── CFCA-STUDIO-UX-02 ──────────────────────────────
//
// A whole framework, one domain, or a chosen set of competencies can be put forward at once. This is a THIN
// COORDINATOR over the existing per-competency operation (clinical-review.ts submitForReview, migration 395): every
// competency still becomes its own clinical_content_version for its exact content hash, reviewed independently. No
// approval, publication or review decision exists here.
//
// ⚠ PREVIEW, THEN SUBMIT WHAT WAS PREVIEWED. The preview returns each competency's eligibility and its current content
// hash. The submission names those hashes, and each item is checked again AT THE MOMENT IT IS PUT FORWARD: content that
// changed since the preview is reported "changed since preview" and not put forward, so a reviewer is never sent a
// version the author did not see.
//
// ⚠ RETRY-SAFE. Eligibility is read again per item, and 395 holds one version per competency and content hash (its
// unique index), so running the same submission twice puts nothing forward twice: an item already in review is
// SKIPPED, not failed. Items are processed one at a time within a time budget; what the budget did not reach is
// returned as "not reached" for the caller to continue, never dropped.
//
// ⚠ ELIGIBILITY IS THE EXISTING RULE, NOT A NEW POLICY: unreviewed, or changed since its approval. Already in review
// and already approved are skipped. A version a reviewer asked to change cannot be put forward again unchanged (395's
// unique index): it is excluded until the content is revised. A framework under governance review is not edited or put
// forward (authoring.ts EDITABLE).

export type ReviewScope = { kind: "framework" } | { kind: "domain"; domainId: string } | { kind: "competencies"; ids: string[] };
export type Eligibility = "eligible" | "in_review" | "approved" | "changes_requested" | "framework_locked" | "unreadable";
export type PreviewItem = { competencyId: string; code: string | null; name: string; domain: string; hash: string | null; eligibility: Eligibility; reason: string };
export type Preview = { scopeLabel: string; items: PreviewItem[]; counts: { inScope: number; eligible: number; excluded: number } };
export type Outcome = "submitted" | "skipped" | "excluded" | "stale" | "failed" | "not_reached";
export type OutcomeItem = { competencyId: string; code: string | null; name: string; outcome: Outcome; reason: string; versionId?: string; required?: number };

const EDITABLE = new Set(["draft", "published"]);
export const ELIGIBILITY_REASON: Record<Eligibility, string> = {
  eligible: "Eligible: this exact content version is put forward.",
  in_review: "Already in review for this exact content version. Not put forward again.",
  approved: "This exact content version is already clinically approved.",
  changes_requested: "A reviewer asked for changes to this version. Revise the content, then put it forward.",
  framework_locked: "The framework is under governance review or archived, so its content is not put forward.",
  unreadable: "Its clinical state could not be read just now, so it is not put forward.",
};

/** Pure: the existing rule for one competency, from its clinical state and its framework's status. */
export function eligibilityOf(clinical: ClinicalReview | null | undefined, frameworkStatus: string): Eligibility {
  if (!EDITABLE.has(frameworkStatus)) return "framework_locked";
  if (!clinical) return "unreadable";
  if (clinical.state === "unreviewed" || clinical.state === "stale") return "eligible";
  return clinical.state;
}

type Fw = { id: string; name: string; code: string | null; pubStatus: string;
  domains: { id: string; name: string; competencies: { id: string; code: string | null; name: string; clinical: ClinicalReview | null }[] }[] };

/** Pure: the preview for a scope over a framework, with each competency's current hash. */
export function previewOf(fw: Fw, scope: ReviewScope, hashes: ReadonlyMap<string, string>): Preview | { error: string } {
  const doms = scope.kind === "domain" ? fw.domains.filter(d => d.id === scope.domainId) : fw.domains;
  if (scope.kind === "domain" && !doms.length) return { error: "That domain is not in this framework." };
  const want = scope.kind === "competencies" ? new Set(scope.ids) : null;
  const items: PreviewItem[] = [];
  for (const d of doms) for (const c of d.competencies) {
    if (want && !want.has(c.id)) continue;
    const e = eligibilityOf(c.clinical, fw.pubStatus);
    items.push({ competencyId: c.id, code: c.code, name: c.name, domain: d.name, hash: hashes.get(c.id) ?? null, eligibility: e, reason: ELIGIBILITY_REASON[e] });
  }
  if (want && items.length !== want.size) return { error: "Some chosen competencies are not in this framework. Nothing is previewed." };
  const eligible = items.filter(i => i.eligibility === "eligible").length;
  const scopeLabel = scope.kind === "framework" ? `Entire framework · ${fw.code ?? fw.name}` : scope.kind === "domain" ? `Domain · ${doms[0].name}` : `${items.length} selected competenc${items.length === 1 ? "y" : "ies"}`;
  return { scopeLabel, items, counts: { inScope: items.length, eligible, excluded: items.length - eligible } };
}

const OUTCOME_OF: Partial<Record<Eligibility, Outcome>> = { in_review: "skipped", approved: "skipped", changes_requested: "excluded", framework_locked: "excluded", unreadable: "failed" };

/** Current content hashes of some competencies (395). null = unreadable. */
export async function contentHashes(admin: any, ids: readonly string[]): Promise<Map<string, string> | null> {
  if (!ids.length) return new Map();
  const r = await admin.rpc("competency_content_hashes", { p_ids: [...ids] });
  if (r.error) return null;
  return new Map((r.data ?? []).map((h: any) => [h.competency_id, h.content_hash]));
}

/**
 * Put forward the previewed items, one at a time, each re-checked at its boundary. Items past the time budget are
 * returned "not reached". `submit` is the existing per-competency operation (injectable for tests).
 */
export async function runSubmission(admin: any, actorId: string, frameworkStatus: string,
  items: { competencyId: string; code: string | null; name: string; hash: string | null }[],
  opts: { budgetMs?: number; now?: () => number; submit?: typeof submitForReview } = {}): Promise<OutcomeItem[]> {
  const now = opts.now ?? Date.now, started = now(), budget = opts.budgetMs ?? 40_000, submit = opts.submit ?? submitForReview;
  const out: OutcomeItem[] = [];
  for (const it of items) {
    const base = { competencyId: it.competencyId, code: it.code, name: it.name };
    if (now() - started > budget) { out.push({ ...base, outcome: "not_reached", reason: "Not reached in this pass. Continue to put it forward." }); continue; }
    // The boundary check: the exact content the preview showed, and the existing rule, read again now.
    const [hashes, reviews] = await Promise.all([contentHashes(admin, [it.competencyId]), loadClinicalReviews(admin, [it.competencyId])]);
    if (hashes === null || reviews === null) { out.push({ ...base, outcome: "failed", reason: "Its content or clinical state could not be read just now. Try again." }); continue; }
    if (!it.hash || hashes.get(it.competencyId) !== it.hash) { out.push({ ...base, outcome: "stale", reason: "The content changed since the preview. Preview again to put the current version forward." }); continue; }
    const e = eligibilityOf(reviews.get(it.competencyId) ?? null, frameworkStatus);
    if (e !== "eligible") { out.push({ ...base, outcome: OUTCOME_OF[e] ?? "excluded", reason: ELIGIBILITY_REASON[e] }); continue; }
    const r = await submit(admin, it.competencyId, actorId);
    if (r.ok) out.push({ ...base, outcome: "submitted", reason: `Put forward. ${r.required} independent approval${r.required === 1 ? "" : "s"} needed.`, versionId: r.versionId, required: r.required });
    else if (/already in clinical review/i.test(r.error)) out.push({ ...base, outcome: "skipped", reason: ELIGIBILITY_REASON.in_review });
    else out.push({ ...base, outcome: "failed", reason: r.error });
  }
  return out;
}

/** Pure: the counts of an outcome list. */
export function outcomeCounts(items: readonly OutcomeItem[]): Record<Outcome, number> {
  const c: Record<Outcome, number> = { submitted: 0, skipped: 0, excluded: 0, stale: 0, failed: 0, not_reached: 0 };
  for (const i of items) c[i.outcome]++;
  return c;
}

/** One shared framework's domains and competencies with their clinical state and current hashes. */
export async function loadFrameworkForReview(admin: any, frameworkId: string): Promise<{ fw: Fw; hashes: Map<string, string> } | { error: string; status: number }> {
  const { data: f, error } = await admin.from("frameworks")
    .select("id, name, code, pub_status, hospital_id, framework_domains(id, name, sort_order, framework_competencies(id, code, name, sort_order))").eq("id", frameworkId).maybeSingle();
  if (error) return { error: "The framework could not be read just now.", status: 503 };
  if (!f || f.hospital_id !== null) return { error: "That is not a shared framework.", status: 404 };
  const doms = [...(f.framework_domains ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
  const ids: string[] = doms.flatMap((d: any) => (d.framework_competencies ?? []).map((c: any) => c.id));
  const [reviews, hashes] = await Promise.all([ids.length ? loadClinicalReviews(admin, ids) : Promise.resolve(new Map()), contentHashes(admin, ids)]);
  if (hashes === null) return { error: "The content versions could not be read just now.", status: 503 };
  return {
    hashes,
    fw: { id: f.id, name: f.name, code: f.code ?? null, pubStatus: f.pub_status ?? "draft",
      domains: doms.map((d: any) => ({ id: d.id, name: d.name,
        competencies: [...(d.framework_competencies ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((c: any) => ({ id: c.id, code: c.code ?? null, name: c.name, clinical: reviews ? reviews.get(c.id) ?? null : null })) })) },
  };
}
