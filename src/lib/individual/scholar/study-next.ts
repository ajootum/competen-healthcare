// ── STUDY NEXT AND LEARNING PROGRESS BY TOPIC: THE SCREEN-FACING SURFACE ── SCHOLAR-COMPANION-01 P1 ────────────
//
// What Progress imports. The logic is src/lib/individual/scholar/mastery.ts (pure) and mastery-data.ts (the read).
// Owner review P0.3 (scholar-learning-harness R3) keeps the word the engine uses for this out of every Scholar
// SCREEN: practice accuracy is learning progress, never "mastery". The screens therefore see only these names.

export { loadMastery as loadTopicProgress } from "./mastery-data";
export { mergeStudyNext, MARKING_LABEL, MASTERY_STATUS_LABEL as STATUS_LABEL } from "./mastery";
export type {
  MasteryEntry as TopicEntry, MasteryMarking as Marking, MasteryResult as TopicProgress, MasteryStatus as TopicStatus, StudyNext,
} from "./mastery";

/** The option of scholar_progress_sections (policy.ts) that shows Study next and progress by topic. */
export const TOPIC_PROGRESS_SECTION = "mastery";
export const topicProgressEnabled = (policy: { scholarProgressSections: readonly string[] }) => policy.scholarProgressSections.includes(TOPIC_PROGRESS_SECTION);
