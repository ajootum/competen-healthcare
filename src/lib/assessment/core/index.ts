// asmt core: the universal assessment engine. Client-safe, pure TypeScript, no React, no DB, no eval.
export { ENGINE_VERSION, RulesError, evaluate, progress, itemProgress, groupMinOrdinals, evalField, criticalFailure, computeAggregate, computeCounts, explain, testHolds } from "./scoring";
export type { Evaluation, OutcomeRef, TraceStep, FieldEval, ItemStatus, ItemProgress, Progress, Counts, ScopeCounts, GateResult, AggregateTrace } from "./scoring";
export * from "./types";
export * from "./rules-ast";
export { validateResponse, computeSatisfactory, fieldSpec, allowedStates, stateLabel, numericValue, creditOf, levelOrdinal, answerCodes } from "./responses";
export type { FieldSpec, ResponseCheck, ResponseIssue } from "./responses";
export { condKind, evalCond, compare, toBoxes, dnfIntersects, dnfShadowed, DNF_CAP } from "./cond";
export type { Cond } from "./cond";
export { selectItems, orderedItems, orderedSections, sectionClosure } from "./select";
export { validateDefinition, validateRules, revalidateTemplate, validateProgression, validateLayout } from "./validate";
export { evaluateProgression, stageForOrdinal, stageOrdinal, progressionAtomizer } from "./progression";
export type { ProgressionEvidence, ProgressionResult, OutstandingItem } from "./progression";
export { resolveView, STANDARD_CHECKLIST_LAYOUT, GUIDED_ASSESSMENT_LAYOUT } from "./layout";
export type { ViewModel, ViewItem, ViewBlock, ViewField, ViewOption, ViewStep, ViewOptions, Breakpoint } from "./layout";
export { runTests, presetBlank, presetAllSatisfactory, presetOneCriticalFailed, presetAllNA, satisfactoryResponse, unsatisfactoryResponse } from "./testing";
export type { ScoringTestCase, TestResult, TestRun } from "./testing";
export { canonicalJson, sha256Hex, hashDoc } from "./hash";
