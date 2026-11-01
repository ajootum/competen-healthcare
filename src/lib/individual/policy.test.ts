/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { DEFAULT_CAREER_CATEGORIES, DEFAULT_MILESTONE_CATEGORIES } from "./professional/progress-policy";
import { DEFAULT_POLICY, POLICIES, POLICY_SCOPE, clampInt, individualAiQuota, individualQuotaRefusal, isStudyPlanOn, isStudySessionsOn, loadIndividualPolicy, meetsMinStatus, policyDef, policyPath, resolvePolicy, validateDraft, type IntPolicy } from "./policy";
import { publishScope, rollbackVersion, setOverride } from "@/lib/config/workspace-config-write";
import { REMINDER_HORIZON_DAYS } from "./professional/vocabulary";
import { SHARE_DAYS_MAX, parseShare } from "./professional/share";
import { LEARN_ACTIONS, MAX_MATERIALS_PER_PERSON, QUESTIONS_PER_REQUEST, INSIGHT_MIN_ANSWERS, INSIGHT_WINDOW_DAYS } from "./scholar/config";
import { STUDY_ACHIEVEMENT_KINDS } from "./scholar/passport-items";
import { INDIVIDUAL_APP_FLAG } from "./gate";
import { COUNTRIES } from "../countries";
import { DEFAULT_NEED_CATEGORIES, DEFAULT_NEED_MOTIVATIONS, DEFAULT_NEED_PRIORITIES, DEFAULT_REFLECTION_TEMPLATES, NEED_FIELDS, NEED_STAGES, PICKABLE_SOURCES } from "./professional/needs-vocabulary";
import {
  ACTIVITY_STATUSES, DEFAULT_ACTIVITY_TYPES, DEFAULT_EVIDENCE_KINDS, DEFAULT_GOAL_PRIORITIES, DEFAULT_GOAL_TEMPLATES, DEFAULT_GOAL_TYPES, DEFAULT_MILESTONE_TYPES,
  GOAL_FIELDS, GOAL_STATUSES, REVIEW_FIELDS,
} from "./professional/plan-vocabulary";
import { DEFAULT_PURPOSES, PASSPORT_CATEGORIES } from "./passport-vocabulary";
import { DEFAULT_COMPETENCY_CATEGORIES, DEFAULT_CONFIDENCE, DEFAULT_EVIDENCE_TYPES, DEFAULT_RELATIONS, SHARE_PARTS } from "./professional/competency-vocabulary";
import { DEFAULT_PRACTICE_SETTINGS, DEFAULT_QUALIFICATION_TYPES, DEFAULT_STATUSES, DOCUMENT_KINDS, OPTIONAL_FIELDS, PROFILE_SECTIONS } from "./professional/profile-vocabulary";

// An in-memory stand-in for the three WCE tables, enough for the shared write lifecycle and the reader.
function memoryAdmin() {
  const tables: Record<string, any[]> = { workspace_config_overrides: [], workspace_config_versions: [], workspace_config_audit: [] };
  let seq = 0;
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let op: "select" | "update" | "delete" = "select"; let patch: any = null;
    const rows = () => tables[table].filter(r => filters.every(f => f(r)));
    const run = () => {
      if (op === "update") { for (const r of rows()) Object.assign(r, patch); return { data: null, error: null }; }
      if (op === "delete") { const keep = tables[table].filter(r => !filters.every(f => f(r))); tables[table] = keep; return { data: null, error: null }; }
      return { data: rows().map(r => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      eq: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === (v ?? null)); return b; },
      like: (k: string, p: string) => { const pre = p.replace(/%$/, ""); filters.push(r => String(r[k]).startsWith(pre)); return b; },
      update: (p: any) => { op = "update"; patch = p; return b; },
      delete: () => { op = "delete"; return b; },
      insert: (row: any) => { const r = { id: `id-${++seq}-0000000000`, created_at: new Date(Date.UTC(2026, 9, 23, 0, seq)).toISOString(), ...row }; tables[table].push(r); return { select: () => ({ maybeSingle: async () => ({ data: { id: r.id }, error: null }) }), then: (res: any) => res({ data: null, error: null }) }; },
      upsert: async (row: any) => {
        const hit = tables[table].find(r => r.scope_type === row.scope_type && (r.scope_ref ?? null) === (row.scope_ref ?? null) && r.config_path === row.config_path);
        if (hit) Object.assign(hit, row); else tables[table].push({ published: null, ...row });
        return { error: null };
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { tables, from };
}

const actor = { userId: "u-admin", name: "Admin" };
const IND = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const WS = { scopeType: "platform", scopeRef: "platform" };

describe("Individual policy catalogue (COMPETEN-CONFIG-002)", () => {
  it("falls back to today's constants, so an empty store changes nothing", () => {
    expect(DEFAULT_POLICY).toEqual({
      reminderHorizonDays: REMINDER_HORIZON_DAYS, shareLinkMaxDays: SHARE_DAYS_MAX, aiHourlyLimit: 30,
      // Owner (double-counted CPD hours): a CPD entry and a Competen Learning completion within 7 days can be one activity.
      professionalLearningMatchDays: 7,
      // COMPETEN-PROFESSIONAL-EVALUATION-01: every scope, factor and rule offered; private unless ticked; no AI on reflections.
      professionalEvaluation: {
        scopes: ["development", "goal", "competency", "outcome", "topic", "cpd", "learning", "area"],
        confidenceFactors: ["document_supported", "formative", "independent", "recency", "sufficiency"],
        rules: ["record_cpd", "plan_activity", "find_learning", "formative_assessment", "reflect_application", "self_assess", "link_evidence",
          "request_verification", "refresh_evidence", "create_goal", "create_need", "review_goal"],
        templates: [
          { code: "looking-back", label: "Looking back: What stands out to me? | What surprised me? | What will I do next?" },
          { code: "evidence-check", label: "Evidence check: Which evidence do I trust most? | What is missing? | Who could give me feedback?" },
        ],
        sufficiency: 2, recencyDays: 1095, periodDays: 0, historyShown: 50, sharing: "offer", ai: "on", aiReflections: "off", corrections: "linked",
      },
      // COMPETEN-PROFESSIONAL-PROGRESS-01: every view, period and rule offered; years by default; document AI on request.
      professionalProgress: {
        views: ["overview", "time", "competencies", "learning", "career", "evaluation", "documents"],
        periods: ["week", "month", "quarter", "year", "phase"], defaultPeriod: "year",
        rules: ["first_steps", "review_goal_after_learning", "reflect_on_training", "organise_evidence", "consider_practical_assessment", "credential_expiry", "explore_aspiration_learning", "review_stale_goal"],
        recentDays: 180, milestoneCategories: DEFAULT_MILESTONE_CATEGORIES, careerCategories: DEFAULT_CAREER_CATEGORIES,
      },
      professionalDocuments: { ai: "on" },
      scholarQuestionsPerRequest: QUESTIONS_PER_REQUEST, scholarMaterialsPerPerson: MAX_MATERIALS_PER_PERSON,
      // Stage 2: PDF and Word only until HQ turns plain text on (it needs migration 405); 10 MB; 300 pages.
      scholarUploadFormats: ["pdf", "docx"], scholarUploadMaxMb: 10, scholarPdfMaxPages: 300, scholarPptxMaxSlides: 150,
      // LEARN-01 L5: every action offered, Teach me first, background labelled, standard depth, 8 steps, checks
      // offered, outcomes shown, 6 turns, structured history recorded.
      scholarLearningActions: [...LEARN_ACTIONS], scholarDefaultAction: "teach",
      scholarBeyondNotes: "labelled", scholarExplanationDepth: "standard", scholarSessionMaxSteps: 8, scholarCheckBehaviour: "offer",
      scholarLearningObjectives: "outcomes", scholarTutorTurns: 6, scholarLearningHistory: "record",
      // Upload limits (owner GO 2026-10-24): the per-file value stays 10 MB (ceiling 25); a session is 10 files, 100 MB.
      scholarUploadSessionFiles: 10, scholarUploadSessionMb: 100,
      scholarInsightMinAnswers: INSIGHT_MIN_ANSWERS, scholarInsightWindowDays: INSIGHT_WINDOW_DAYS,
      passportAchievementKinds: [...STUDY_ACHIEVEMENT_KINDS],
      // S1: no catalogue reaches a person until HQ chooses one.
      scholarCatalogues: [], professionalCatalogues: [], scholarReferenceCollections: [],
      scholarRevisionFormats: ["mcq", "mrq", "short", "flashcard", "match", "sequence", "structured", "cloze", "true_false"], scholarVerifyFormats: ["mcq", "case", "mrq", "short"], scholarRevisionModes: ["today", "quick", "spaced", "weak", "mock", "flashcards", "custom"],
      scholarRevisionQuantity: 10, scholarRevisionDifficulty: "any", scholarRevisionFeedback: "immediate", scholarRevisionGeneration: "generate", scholarShortAnswerMarking: "self",
      scholarRevisionRecommendations: "on",
      // SCHOLAR-PRACTICE-EXAMS-01: adaptive exams on, 15 questions, at most 30, every adaptive format (no flashcards).
      scholarAdaptiveExams: "on", scholarAdaptiveLength: 15, scholarAdaptiveMaxLength: 30, scholarAdaptiveFormats: ["mcq", "mrq", "short", "match", "sequence", "structured"],
      // SCHOLAR-FLASHCARDS-01: offered, ten new cards at a time, 200 a deck, both source modes, any difficulty, every download.
      scholarFlashcards: "on", scholarMistakeNotebook: "on", scholarLearningLibrary: "on", scholarFlashcardsPerGeneration: 10, scholarFlashcardDeckMax: 200, scholarFlashcardSourceModes: ["notes", "notes_and_references"],
      scholarFlashcardDifficulty: "any", scholarFlashcardExports: ["deck", "print", "guide"], scholarFlashcardLevelMix: "programme",
      // SCHOLAR-SESSION-AI-02: connected study sessions OFF until HQ switches them on (and 740 is applied).
      scholarStudySessions: false,
      // SCHOLAR-INTELLIGENCE-COMPLETE-01: case contribution follows the case library switch until HQ sets it off.
      scholarCaseContribution: "on",
      // SQIE-LIBRARY-EXPANSION-01: offering questions to the library OFF until HQ switches it on (and 802 is applied).
      scholarQuestionOffering: "off",
      scholarQuestionOfferDays: 60,
      // SCHOLAR-COMPANION-01: the study plan OFF until HQ switches it on (and 780 is applied).
      scholarStudyPlan: false,
      // SCHOLAR-GUIDED-LEARNING-01: no lesson is prepared ahead until HQ switches it on.
      scholarLearnPrepareNext: false,
      scholarSrsMasteryReps: 5, scholarSrsMasteryDays: 60, scholarSrsMaxIntervalDays: 3650, scholarSrsHarderIntervalPercent: 100,
      scholarCaseContexts: ["general", "medical", "surgical", "paediatric", "maternal", "emergency", "critical_care"], scholarCaseEntries: ["notes", "competency", "library", "surprise"],
      scholarCaseDimensions: ["recognition", "interpretation", "prioritisation", "decision", "reassessment", "escalation"], scholarCaseGeneration: "generate", scholarCaseMode: "guided",
      scholarCaseReasoningFeedback: "self",
      // EVALUATION-01 (Stage 6): every method and evidence source, five pieces of evidence, two sections, 90 days,
      // strong from 80 and developing from 50 -- descriptions, never a pass mark -- ten fresh questions, suggestions on.
      scholarEvaluationMethods: ["existing", "fresh", "combined"],
      scholarEvaluationEvidence: ["teach_checks", "revision", "spaced_review", "clinical_reasoning"],
      scholarEvaluationMinEvidence: 5,
      scholarEvaluationMinSources: 2,
      scholarEvaluationRecencyDays: 90,
      scholarEvaluationBandStrong: 80,
      scholarEvaluationBandDeveloping: 50,
      scholarEvaluationFreshQuantity: 10,
      scholarEvaluationRecommendations: "on",
      // PROGRESS-01 (Stage 8): every section, by week over 8 periods, every next-step rule, 5 steps, evaluations offered to the Passport.
      scholarProgressSections: ["coverage", "understanding", "retention", "application", "engagement", "confidence", "history", "competencies", "mastery"],
      scholarProgressPeriod: "week",
      scholarProgressPeriods: 8,
      scholarProgressNextRules: ["teach", "spaced", "case", "evaluate", "classify", "advance"],
      scholarProgressNextMax: 5,
      scholarPassportEvaluations: "offer",
      // JOIN-01: every active programme is offered, no level or institution is asked, both fields may be.
      scholarOnboardingProgrammes: null, scholarProgrammeLevels: {}, scholarInstitutions: [], scholarOnboardingFields: ["level", "institution"],
      // COMPETEN-SCHOLAR-EXAM-PAPERS-01: papers offered with notes and the library as evidence; web research and AI transcription OFF.
      scholarExams: {
        enabled: true, sources: ["notes", "library"], webProvider: "none", depth: "standard",
        domains: ["who.int", "health.go.ug", "nice.org.uk", "nhs.uk", "cdc.gov", "nih.gov", "cochranelibrary.com", "resus.org.uk", "sign.ac.uk"],
        webDailyMax: 10, cacheDays: 30, scannedPages: "off",
      },
      // SCHOLAR-UPLOAD-FIX: picture-only slides are not sent to AI unless the owner turns it on.
      scholarMaterialImageSlides: "off",
      // SCHOLAR-PRACTICE-EXAMS-01 (720): OSCE practice offered (it degrades safely without 720), 8 minutes, 8 to 12 items.
      scholarOsce: { enabled: true, durationMinutes: 8, checklistMin: 8, checklistMax: 12 },
      // COMPETEN-RESEARCH-01: notes only. Research also needs the engine operational (HQ Research Sources).
      scholarResearch: { modes: ["notes"], dailyMax: 5, dailyCostCents: 25, relevance: "standard" },
      // SCHOLAR-SQIE-02: evidence recovery defaults to notes + library, external off, no source enabled.
      // SCHOLAR-SOURCE-QUALITY-01: only PubMed-indexed reviews, guidelines and trials whose title names the topic may explain.
      scholarRecovery: {
        defaultMode: "notes_and_library", external: "off", providers: [], maxResults: 5, timeoutMs: 6000, evidenceIndexed: "pubmed_only",
        evidenceTypes: ["review", "systematic_review", "meta_analysis", "practice_guideline", "guideline", "randomized_controlled_trial", "clinical_trial"], evidenceOnTopic: "title", sufficiency: 0.6,
      },
      // P0: label, do not hide -- everything of a chosen catalogue is offered, labelled, by default.
      scholarCatalogueMinStatus: "unreviewed",
      // COMPETEN-PROFESSIONAL-PROFILE-01: free text where nothing is configured, every country, the default statuses,
      // settings and qualification types, every optional question asked and none required, all six sections, AI on.
      professionalProfile: {
        professions: [], titles: [], jurisdictions: DEFAULT_POLICY.professionalProfile.jurisdictions, statuses: [...DEFAULT_STATUSES],
        qualificationTypes: [...DEFAULT_QUALIFICATION_TYPES], registrationBodies: [], practiceSettings: [...DEFAULT_PRACTICE_SETTINGS],
        specialties: [], careerInterests: [], registrationFields: [...OPTIONAL_FIELDS], registrationRequired: [],
        sections: [...PROFILE_SECTIONS], documentKinds: [...DOCUMENT_KINDS], ai: "on",
        // Part B: each verifiable kind on request, every reminder kind, one reminder at 60 days for active and
        // provisional registrations, and every section shareable (each record still chosen by the person).
        verificationKinds: ["qualification", "registration", "employment"],
        reminderKinds: ["primary_registration", "credentials", "registration_items", "qualification_items"],
        reminderOffsets: [60], reminderStandings: ["active", "provisional"], shareSections: [...PROFILE_SECTIONS],
      },
      // COMPETEN-PROFESSIONAL-NEEDS-01: neutral defaults, every optional field and stage offered, reopening allowed,
      // competency links from the offered catalogues, suggestions, learning and reflection AI on, review after 90 days.
      professionalNeeds: {
        categories: [...DEFAULT_NEED_CATEGORIES], motivations: [...DEFAULT_NEED_MOTIVATIONS], priorities: [...DEFAULT_NEED_PRIORITIES], templates: [...DEFAULT_REFLECTION_TEMPLATES],
        sources: [...PICKABLE_SOURCES], fields: [...NEED_FIELDS], stages: [...NEED_STAGES], reopen: "on", competencyLinks: "offered",
        ruleSuggestions: "on", aiSuggestions: "on", learning: "on", reflectionAi: "on", reviewDays: 90,
      },
      professionalPlan: {
        goalTypes: [...DEFAULT_GOAL_TYPES], priorities: [...DEFAULT_GOAL_PRIORITIES], templates: [...DEFAULT_GOAL_TEMPLATES], activityTypes: [...DEFAULT_ACTIVITY_TYPES],
        milestoneTypes: [...DEFAULT_MILESTONE_TYPES], evidenceKinds: [...DEFAULT_EVIDENCE_KINDS], fields: [...GOAL_FIELDS], goalStatuses: [...GOAL_STATUSES],
        activityStatuses: [...ACTIVITY_STATUSES], reviewFields: [...REVIEW_FIELDS], reopen: "on", competencyLinks: "offered", learning: "competency", ai: "on",
        aiReflections: "off", reviewDays: 90, reminderDays: 14,
      },
      professionalCompetency: {
        categories: [...DEFAULT_COMPETENCY_CATEGORIES], confidence: [...DEFAULT_CONFIDENCE], evidenceTypes: [...DEFAULT_EVIDENCE_TYPES], relations: [...DEFAULT_RELATIONS],
        personal: "on", fields: ["outcome", "confidence", "reflection", "interest"], shareParts: [...SHARE_PARTS], ai: "on", reassessDays: 180,
      },
      professionalPassport: {
        sections: [...PASSPORT_CATEGORIES], shareable: [...PASSPORT_CATEGORIES], purposes: [...DEFAULT_PURPOSES], recipient: "optional",
        presentation: "detailed", validity: "show", exportOn: "on", ai: "on",
      },
      // SCHOLAR-MONTHLY-REVIEW-01: offered, 10 to 30 questions, two a section, core 60 / application 25 / gaps 15, five days before month end.
      scholarMonthlyReview: "on", scholarMonthlyReviewMinQuestions: 10, scholarMonthlyReviewMaxQuestions: 30, scholarMonthlyReviewPerSection: 2,
      scholarMonthlyReviewMix: "60_25_15", scholarMonthlyReviewRecommendDays: 5, scholarMonthlyReviewReminders: "on", scholarMonthlyReviewOptout: "allowed",
      scholarStudyCalendar: "on",
    });
    expect(DEFAULT_POLICY.professionalProfile.jurisdictions.length).toBe(COUNTRIES.length);
  });

  it("SCHOLAR-MONTHLY-REVIEW-01: the fewest questions never exceeds the most, and a mix outside the list falls back", () => {
    const r = resolvePolicy([
      { config_path: policyPath("scholar_monthly_review_min_questions"), published: { value: 40 } },
      { config_path: policyPath("scholar_monthly_review_max_questions"), published: { value: 20 } },
      { config_path: policyPath("scholar_monthly_review_mix"), published: { value: "99_1_0" } },
    ]);
    expect([r.scholarMonthlyReviewMinQuestions, r.scholarMonthlyReviewMaxQuestions, r.scholarMonthlyReviewMix]).toEqual([20, 20, "60_25_15"]);
    expect(validateDraft("scholar_monthly_review_mix", "50_30_20")).toMatchObject({ ok: true });
    expect(validateDraft("scholar_monthly_review_per_section", 9).ok).toBe(false);
  });

it("SCHOLAR-GUIDED-LEARNING-01: prepare-next defaults off and resolves on only from a published on", () => {    const path = policyPath("scholar_learn_prepare_next");    expect(DEFAULT_POLICY.scholarLearnPrepareNext).toBe(false);    expect(resolvePolicy([{ config_path: path, published: { value: "on" } }]).scholarLearnPrepareNext).toBe(true);    expect(resolvePolicy([{ config_path: path, published: { value: true } }]).scholarLearnPrepareNext).toBe(false);    expect(validateDraft("scholar_learn_prepare_next", "on")).toMatchObject({ ok: true, settings: { value: "on" } });    expect(validateDraft("scholar_learn_prepare_next", "ahead").ok).toBe(false);  });
  it("SCHOLAR-SESSION-AI-02: study sessions default off, resolve on only from a published on, and need 740 too", () => {
    const path = policyPath("scholar_study_sessions");
    expect(DEFAULT_POLICY.scholarStudySessions).toBe(false);
    expect(resolvePolicy([{ config_path: path, published: { value: "on" } }]).scholarStudySessions).toBe(true);
    expect(resolvePolicy([{ config_path: path, published: { value: "yes" } }]).scholarStudySessions).toBe(false);
    expect(resolvePolicy([{ config_path: path, published: { value: true } }]).scholarStudySessions).toBe(false);
    expect(validateDraft("scholar_study_sessions", "on")).toMatchObject({ ok: true, settings: { value: "on" } });
    expect(validateDraft("scholar_study_sessions", "maybe").ok).toBe(false);
    const on = resolvePolicy([{ config_path: path, published: { value: "on" } }]);
    expect([isStudySessionsOn(on, true), isStudySessionsOn(on, false), isStudySessionsOn(DEFAULT_POLICY, true), isStudySessionsOn(DEFAULT_POLICY, false)])
      .toEqual([true, false, false, false]);
  });

  it("SCHOLAR-COMPANION-01: the study plan defaults off, resolves on only from a published on, and needs 780 too", () => {
    const path = policyPath("scholar_study_plan");
    expect(DEFAULT_POLICY.scholarStudyPlan).toBe(false);
    expect(resolvePolicy([{ config_path: path, published: { value: "on" } }]).scholarStudyPlan).toBe(true);
    expect(resolvePolicy([{ config_path: path, published: { value: "yes" } }]).scholarStudyPlan).toBe(false);
    expect(resolvePolicy([{ config_path: path, published: { value: true } }]).scholarStudyPlan).toBe(false);
    expect(validateDraft("scholar_study_plan", "on")).toMatchObject({ ok: true, settings: { value: "on" } });
    expect(validateDraft("scholar_study_plan", "maybe").ok).toBe(false);
    const on = resolvePolicy([{ config_path: path, published: { value: "on" } }]);
    expect([isStudyPlanOn(on, true), isStudyPlanOn(on, false), isStudyPlanOn(DEFAULT_POLICY, true), isStudyPlanOn(DEFAULT_POLICY, false)])
      .toEqual([true, false, false, false]);
  });

  it("P0: the content-status minimum is one listed value, defaults to everything, and filters only when raised", () => {
    const path = policyPath("scholar_catalogue_min_status");
    expect(resolvePolicy([{ config_path: path, published: { value: "approved" } }]).scholarCatalogueMinStatus).toBe("approved");
    expect(resolvePolicy([{ config_path: path, published: { value: "verified" } }]).scholarCatalogueMinStatus).toBe("unreviewed");
    expect(validateDraft("scholar_catalogue_min_status", "draft")).toMatchObject({ ok: true, settings: { value: "draft" } });
    expect(validateDraft("scholar_catalogue_min_status", "verified").ok).toBe(false);
    expect(["unreviewed", "draft", "approved", "bogus"].map(s => meetsMinStatus(s, "unreviewed"))).toEqual([true, true, true, true]);
    expect(["unreviewed", "draft", "approved", "bogus"].map(s => meetsMinStatus(s, "draft"))).toEqual([false, true, true, false]);
    expect(["unreviewed", "draft", "approved", "bogus"].map(s => meetsMinStatus(s, "approved"))).toEqual([false, false, true, false]);
  });

  it("S1: a catalogue allowlist is ids only, deduplicated, capped, and empty when absent or malformed", () => {
    const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
    const p = resolvePolicy([{ config_path: policyPath("professional_catalogues"), published: { ids: [a, a.toUpperCase(), "not-an-id", b] } }]);
    expect(p.professionalCatalogues).toEqual([a, b]);
    expect(p.scholarCatalogues).toEqual([]);
    expect(resolvePolicy([{ config_path: policyPath("scholar_catalogues"), published: { ids: "everything" } }]).scholarCatalogues).toEqual([]);
    expect(validateDraft("scholar_catalogues", [a, b])).toMatchObject({ ok: true, settings: { ids: [a, b] } });
    expect(validateDraft("scholar_catalogues", ["all"])).toMatchObject({ ok: false });
    expect(validateDraft("scholar_catalogues", Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`))).toMatchObject({ ok: false });
    expect(validateDraft("scholar_catalogues", [])).toMatchObject({ ok: true, settings: { ids: [] } });
  });

  it("every default sits inside its own hard limit, and the Scholar and AI limits can only tighten", () => {
    for (const p of POLICIES) if (p.kind === "int") expect(p.fallback >= p.min && p.fallback <= p.max).toBe(true);
    for (const k of ["scholar_questions_per_request", "scholar_materials_per_person", "ai_hourly_limit", "share_link_max_days"] as const)
      expect((policyDef(k) as IntPolicy).max).toBe((policyDef(k) as IntPolicy).fallback);
  });

  it("refuses a write outside the hard limit instead of clamping it", () => {
    expect(validateDraft("scholar_questions_per_request", 4)).toMatchObject({ ok: false });
    expect(validateDraft("share_link_max_days", 366)).toMatchObject({ ok: false });
    expect(validateDraft("reminder_horizon_days", 6)).toMatchObject({ ok: false });
    expect(validateDraft("reminder_horizon_days", 2.5)).toMatchObject({ ok: false });
    expect(validateDraft(INDIVIDUAL_APP_FLAG, true)).toMatchObject({ ok: false });
    expect(validateDraft("reminder_horizon_days", "90")).toEqual({ ok: true, def: policyDef("reminder_horizon_days"), settings: { value: 90 } });
    expect(validateDraft("passport_achievement_kinds", ["practice_questions", "certificates"])).toMatchObject({ ok: false });
    expect(validateDraft("passport_achievement_kinds", [])).toMatchObject({ ok: true, settings: { enabled: [] } });
  });

  it("clamps a stored value that is out of range, whoever wrote it, and ignores drafts and unknown paths", () => {
    const p = resolvePolicy([
      { config_path: policyPath("scholar_questions_per_request"), published: { value: 99 } },
      { config_path: policyPath("reminder_horizon_days"), published: { value: 1 } },
      { config_path: policyPath("share_link_max_days"), published: { value: "x" } },
      { config_path: policyPath("passport_achievement_kinds"), published: { enabled: ["practice_scenarios", "made_up"] } },
      { config_path: `individual.policy.${INDIVIDUAL_APP_FLAG}`, published: { value: 1 } },
    ]);
    expect(p.scholarQuestionsPerRequest).toBe(QUESTIONS_PER_REQUEST);
    expect(p.reminderHorizonDays).toBe((policyDef("reminder_horizon_days") as IntPolicy).min);
    expect(p.shareLinkMaxDays).toBe(SHARE_DAYS_MAX);
    expect(p.passportAchievementKinds).toEqual(["practice_scenarios"]);
    expect(clampInt(policyDef("ai_hourly_limit") as IntPolicy, null)).toBe(30);
  });

  it("the Individual AI limit tightens the estate quota and never loosens it", () => {
    const tight = { ...DEFAULT_POLICY, aiHourlyLimit: 5 };
    expect(individualAiQuota({ ok: true, used: 5, limit: 30 }, tight)).toEqual({ ok: false, used: 5, limit: 5, unreadable: false });
    expect(individualAiQuota({ ok: true, used: 4, limit: 30 }, tight)).toEqual({ ok: true, used: 4, limit: 5, unreadable: false });
    expect(individualAiQuota({ ok: false, used: 10, limit: 10 }, DEFAULT_POLICY)).toEqual({ ok: false, used: 10, limit: 10, unreadable: false });
  });

  it("⚠ FAILS CLOSED: an unreadable count refuses Individual AI, where the estate quota would still say ok", () => {
    // The estate answer when the audit_log count fails: ok true, used 0 (fail open). Individual must refuse.
    const q = individualAiQuota({ ok: true, used: 0, limit: 30, unreadable: true }, DEFAULT_POLICY);
    expect(q).toEqual({ ok: false, used: 0, limit: 30, unreadable: true });
    expect(individualQuotaRefusal(q)).toEqual({ status: 503, error: "Your AI allowance could not be checked just now, so nothing was sent. Try again shortly." });
    expect(individualQuotaRefusal({ ok: false, limit: 5, unreadable: false }, "questions")).toEqual({ status: 429, error: "You have reached the limit of 5 questions an hour. Try again later." });
    expect(individualQuotaRefusal({ ok: true, limit: 30, unreadable: false })).toBeNull();
  });

  it("the share-link maximum caps what a person asks for and keeps the 30-day suggestion within it", () => {
    expect(parseShare({ days: 200 }, 90).days).toBe(90);
    expect(parseShare({}, 14).days).toBe(14);
    expect(parseShare({}, 365).days).toBe(30);
    expect(parseShare({ days: 9999 }, 9999).days).toBe(SHARE_DAYS_MAX);
  });

  it("loadIndividualPolicy fails soft to the defaults", async () => {
    expect(await loadIndividualPolicy({ from: () => { throw new Error("no table"); } })).toEqual(DEFAULT_POLICY);
  });
});

describe("WCE shared lifecycle, Individual partition", () => {
  it("a draft is not effective until published, and publishing one partition never sweeps the other", async () => {
    const admin = memoryAdmin();
    await setOverride(admin, actor, WS, "supervisor.module", { enabled: false });
    await setOverride(admin, actor, IND, policyPath("reminder_horizon_days"), { value: 90 });
    expect((await loadIndividualPolicy(admin)).reminderHorizonDays).toBe(REMINDER_HORIZON_DAYS);

    const v = await publishScope(admin, actor, IND, { note: "longer lead" });
    expect(v).toMatchObject({ ok: true, modules: 1 });
    expect((await loadIndividualPolicy(admin)).reminderHorizonDays).toBe(90);
    const ws = admin.tables.workspace_config_overrides.find(r => r.config_path === "supervisor.module");
    expect(ws.published).toBeNull();
    expect(admin.tables.workspace_config_audit.map(a => a.action)).toEqual(["set", "set", "publish"]);
  });

  it("rollback restores exactly, refuses a version from another scope, and is itself a new version", async () => {
    const admin = memoryAdmin();
    await setOverride(admin, actor, IND, policyPath("reminder_horizon_days"), { value: 90 });
    const v1 = await publishScope(admin, actor, IND);
    await setOverride(admin, actor, IND, policyPath("ai_hourly_limit"), { value: 5 });
    await publishScope(admin, actor, IND);
    expect((await loadIndividualPolicy(admin)).aiHourlyLimit).toBe(5);

    await setOverride(admin, actor, WS, "supervisor.module", { enabled: false });
    const wsv = await publishScope(admin, actor, WS);
    expect(await rollbackVersion(admin, actor, String((wsv as any).version_id), { scope: IND, prune: true })).toMatchObject({ ok: false });

    const r = await rollbackVersion(admin, actor, String((v1 as any).version_id), { scope: IND, prune: true });
    expect(r).toMatchObject({ ok: true, restored: 1, pruned: 1 });
    const now = await loadIndividualPolicy(admin);
    expect(now.reminderHorizonDays).toBe(90);
    expect(now.aiHourlyLimit).toBe(30);
    expect(admin.tables.workspace_config_versions.filter(x => x.scope_ref === "individual")).toHaveLength(3);
  });
});

it("SCHOLAR-PAI-RESEARCH-01: the sufficiency threshold is HQ's choice of 0.5, 0.6 or 0.7, falling back to 0.6", () => {
  const path = policyPath("scholar_recovery_sufficiency");
  expect(POLICIES.some(p => p.key === "scholar_recovery_sufficiency" && p.product === "Scholar")).toBe(true);
  expect(DEFAULT_POLICY.scholarRecovery.sufficiency).toBe(0.6);
  for (const v of ["0.5", "0.6", "0.7"]) expect(resolvePolicy([{ config_path: path, published: { value: v } }]).scholarRecovery.sufficiency).toBe(Number(v));
  for (const v of ["0.9", 0.7, "", null]) expect(resolvePolicy([{ config_path: path, published: { value: v } }]).scholarRecovery.sufficiency).toBe(0.6);
  expect(validateDraft("scholar_recovery_sufficiency", "0.7")).toMatchObject({ ok: true, settings: { value: "0.7" } });
  expect(validateDraft("scholar_recovery_sufficiency", "0.95").ok).toBe(false);
});
