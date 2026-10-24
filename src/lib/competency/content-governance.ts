// ── COMPETEN HOLDINGS: WHICH CONTENT NEEDS CLINICAL APPROVAL ── owner decision "AI-generated educational
// content", 2026-10-24. One rule, read by Scholar and Professional alike. Pure, imports nothing.
//
//   private_formative   material generated for ONE person's own study or development (AI explanations,
//                       practice questions, revision prompts, reflection drafts). No manual clinical
//                       approval for every revision activity: it is always labelled as AI-generated and not
//                       clinically reviewed, and it is never presented as authoritative or shared.
//   shared_clinical     content offered to many people as clinical content (catalogue competencies, shared
//                       learning resources). It is shown as clinically approved ONLY when migration 395 says
//                       its exact content version is approved. Until then it is labelled with its real state.
//   formal_assessment   content that decides an outcome (an assessment, an exam, a competency decision). It
//                       needs clinical approval of the exact version before it may be used to decide anything.

export type ContentClass = "private_formative" | "shared_clinical" | "formal_assessment";

export type ContentRule = {
  /** Does showing or using it require a 395 clinical approval of its exact version? */
  requiresClinicalApproval: boolean;
  /** May it be used to decide an outcome for a person before it is approved? */
  usableForDecisionsUnapproved: boolean;
  /** The label every surface shows for it while it is not clinically approved. */
  unapprovedLabel: string;
};

export const CONTENT_RULES: Record<ContentClass, ContentRule> = {
  private_formative: { requiresClinicalApproval: false, usableForDecisionsUnapproved: false, unapprovedLabel: "AI-generated for your own study. Not clinically reviewed." },
  shared_clinical: { requiresClinicalApproval: true, usableForDecisionsUnapproved: false, unapprovedLabel: "Not clinically reviewed" },
  formal_assessment: { requiresClinicalApproval: true, usableForDecisionsUnapproved: false, unapprovedLabel: "Not clinically approved: not available for assessment" },
};

/** Pure: may this content be presented as clinically approved? Only shared or assessment content, only when approved. */
export const presentableAsApproved = (cls: ContentClass, clinicallyApproved: boolean): boolean =>
  CONTENT_RULES[cls].requiresClinicalApproval && clinicallyApproved;

/** Pure: may this content be used to decide an outcome for a person? */
export const usableForDecision = (cls: ContentClass, clinicallyApproved: boolean): boolean =>
  cls !== "private_formative" && (clinicallyApproved || CONTENT_RULES[cls].usableForDecisionsUnapproved);
