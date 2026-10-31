/* eslint-disable @typescript-eslint/no-explicit-any */
// SQIE HQ: the aggregate reads behind src/lib/knowledge/question-performance.ts. They sit here, on the HQ plane, because
// neither the CKRI library (CKRI harness K1-7: names no raw Scholar table) nor the learner's own store (Scholar harness
// A1: every statement keyed on the caller's user_id) is the place for a read across learners. Only ids, version,
// correct and time are selected -- never a learner id or any content (plane-boundary.ts entries for both tables).
export async function libraryCopyRows(admin: any, versionIds: readonly string[]) {
  return admin.from("individual_scholar_question").select("id, library_version_id").in("library_version_id", versionIds).limit(20000);
}
export async function libraryCopyAttemptRows(admin: any, questionIds: readonly string[]) {
  return admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").in("question_id", questionIds).limit(50000);
}
