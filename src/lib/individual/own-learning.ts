/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataScope } from "@/lib/ai/personal-assistant";
import { loadIndividualPolicy } from "./policy";
import { loadLearnerCatalogue } from "./scholar/competency-view";
import { contextHistory } from "./scholar/context";
import { competencyProgressRows } from "./scholar/store";
import { buildCompetencyProgress, type CompetencyProgressRow } from "./scholar/competency-progress";
import { NEEDS_PRACTICE_BELOW, levelWords, words } from "./scholar/learner-context";
import { loadNeedsWorkspace, type StageTwoNeed } from "./professional/needs-store";
import { loadPlanWorkspace, type PlanGoal } from "./professional/plan-store";
import { NEED_STAGE_LABEL, isNeedStage } from "./professional/needs-vocabulary";
import { GOAL_STATUS_TEXT, isGoalStatus } from "./professional/plan-vocabulary";

// ── THE PERSONAL AI'S VIEW OF THE LEARNER'S OWN RECORDED LEARNING ── Supervised Pilot, learner side ──────────────
//
// A READ-ONLY ADAPTER over rows that already exist, read by the signed-in person's own id and nothing else: their
// programme and level (individual_scholar_learner_context), their Scholar competency progress (the same builder the
// tutor and the Progress page use), and -- only when the published assistant profile lists the scope own_development
// AND the estate's AI switch for that store is on -- their own development needs and goals from Professional.
//
// ⚠ WORDS ABOUT WHAT THE PERSON RECORDED, NEVER A GUESS. Every item is labelled "recorded by you". An item that is
// not recorded says "Not recorded: <item>", so the model has nothing to invent in its place. Practice accuracy is
// not competence and is said as practice.
// ⚠ NEVER ANOTHER PERSON'S OR AN EMPLOYER'S DATA. Every read is keyed on the caller's user id. Nothing here reads an
// employer record, a verification, an assessment or another person's row.
// ⚠ NOTHING IS WRITTEN OR KEPT. The block is rebuilt per request and lives only in the prompt.

export const OWN_LEARNING_HEADING = "Your recorded learning (from your own Competen record)";
/** The whole block, in characters. Whole lines are dropped from the end rather than cut mid-sentence. */
export const OWN_LEARNING_MAX = 2500;
const LINE_MAX = 420, MAX_ITEMS = 5;

/** `null` = nothing recorded; `"unreadable"` = it could not be read just now. */
type Maybe<T> = T | null | "unreadable";

export type OwnLearningInput = {
  programme: Maybe<string>; level: Maybe<string>;
  /** Scholar competency progress (competency-progress.ts rows), or null when the programme has none to track. */
  progress: Maybe<CompetencyProgressRow[]>;
  /** Professional needs and goals, or "not_shared" when the owner has not enabled the scope or the estate switch is off. */
  development: "not_shared" | { needs: Maybe<StageTwoNeed[]> | "off"; goals: Maybe<PlanGoal[]> | "off" };
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const names = (xs: string[]) => [...new Set(xs.map(words).filter(Boolean))].slice(0, MAX_ITEMS).join("; ");

/** Pure: the block, or the lines that fit under the cap. Always names what is not recorded. */
export function ownLearningContext(i: OwnLearningInput): string {
  const lines: string[] = [];
  const text = (v: Maybe<string>, label: string, say: (s: string) => string) => {
    if (v === "unreadable") lines.push(`- ${label}: could not be read just now.`);
    else if (!v || !say(v)) lines.push(`- Not recorded: ${label.toLowerCase()}.`);
    else lines.push(`- ${label} (recorded by you): ${say(v)}.`);
  };
  text(i.programme, "Programme", words);
  text(i.level, "Level", levelWords);

  if (i.progress === "unreadable") lines.push("- Study progress: could not be read just now.");
  else {
    const rows = i.progress ?? [];
    const practised = rows.filter(r => r.status === "practising");
    const weak = names(practised.filter(r => r.latestAccuracy !== null && r.latestAccuracy < NEEDS_PRACTICE_BELOW).map(r => r.title));
    const fine = names(practised.filter(r => r.latestAccuracy === null || r.latestAccuracy >= NEEDS_PRACTICE_BELOW).map(r => r.title));
    const notYet = names(rows.filter(r => r.status === "notes_linked").map(r => r.title));
    if (!weak && !fine && !notYet) lines.push("- Not recorded: study progress (no competencies linked to your notes yet).");
    else {
      lines.push("- Study progress (recorded by you, from your own notes and practice questions; practice is not an assessment of competence):");
      if (fine) lines.push(`  - You have practised: ${fine}.`);
      if (weak) lines.push(`  - Your practice suggests more practice is needed on: ${weak}.`);
      if (notYet) lines.push(`  - You have linked notes to these but have not practised yet: ${notYet}.`);
    }
  }

  if (i.development === "not_shared") lines.push("- Not available to this assistant: your development needs, goals and plan. Do not guess them.");
  else {
    const { needs, goals } = i.development;
    if (needs === "off") lines.push("- Not available to this assistant: your development needs. Do not guess them.");
    else if (needs === "unreadable") lines.push("- Development needs: could not be read just now.");
    else {
      const open = (needs ?? []).filter(n => !["addressed", "retired"].includes(n.stage_code));
      if (!open.length) lines.push("- Not recorded: development needs.");
      else lines.push(`- Development needs (recorded by you): ${open.slice(0, MAX_ITEMS).map(n => `${clip(one(n.title), 90)}${isNeedStage(n.stage_code) ? ` (${NEED_STAGE_LABEL[n.stage_code].toLowerCase()})` : ""}`).join("; ")}.`);
    }
    if (goals === "off") lines.push("- Not available to this assistant: your development goals and targets. Do not guess them.");
    else if (goals === "unreadable") lines.push("- Development goals and targets: could not be read just now.");
    else {
      const live = (goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress");
      if (!live.length) lines.push("- Not recorded: development goals or targets.");
      else lines.push(`- Development goals and targets (recorded by you): ${live.slice(0, MAX_ITEMS).map(g => `${clip(one(g.title), 90)} (${isGoalStatus(g.status) ? GOAL_STATUS_TEXT[g.status].toLowerCase() : g.status}${g.target_date ? `, target ${g.target_date}` : ", no target date"})`).join("; ")}.`);
    }
  }

  // Whole lines only, so the cap never cuts a fact in half.
  const out = [OWN_LEARNING_HEADING + ". Use only what is written here about the learner. Do not add to it."];
  let size = out[0].length;
  for (const l of lines.map(x => clip(x, LINE_MAX))) {
    if (size + l.length + 1 > OWN_LEARNING_MAX) break;
    out.push(l); size += l.length + 1;
  }
  return out.join("\n");
}

/**
 * The block for one person, from their own rows. `development` is true only when the published profile lists
 * own_development; the estate's AI switches for the needs and plan stores (professional_needs_ai_suggestions,
 * professional_plan_ai) must also be on. `read` names the scopes whose data was actually read, for the audit row.
 */
export async function loadOwnLearning(admin: any, userId: string, opts: { development: boolean }): Promise<{ text: string; read: DataScope[] }> {
  const read: DataScope[] = ["own_learning"];
  let programme: Maybe<string> = null, level: Maybe<string> = null, progress: Maybe<CompetencyProgressRow[]> = null;
  try {
    const learner = await loadLearnerCatalogue(admin, userId);
    programme = learner.programme?.label ?? null;
    if (learner.provisioned && learner.programme) {
      const history = await contextHistory(admin, userId);
      level = history.ok ? history.periods.find(p => p.effectiveTo === null)?.levelLabel ?? null : "unreadable";
      if (learner.competencies === null) progress = "unreadable";
      else if (learner.competencies.length) {
        const rows = await competencyProgressRows(admin, userId);
        progress = rows.ok ? buildCompetencyProgress({
          competencies: learner.competencies,
          mappings: rows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
          questions: rows.data.questions, attempts: rows.data.attempts,
        }).layers.flatMap(l => l.rows) : "unreadable";
      }
    }
  } catch { programme = "unreadable"; level = "unreadable"; progress = "unreadable"; }

  let development: OwnLearningInput["development"] = "not_shared";
  if (opts.development) {
    const policy = await loadIndividualPolicy(admin);
    const needsOn = policy.professionalNeeds.aiSuggestions === "on", planOn = policy.professionalPlan.ai === "on";
    if (needsOn || planOn) {
      const [n, p] = await Promise.all([needsOn ? loadNeedsWorkspace(admin, userId) : null, planOn ? loadPlanWorkspace(admin, userId) : null]);
      development = {
        needs: n ? n.needs ?? "unreadable" : "off",
        goals: p ? p.goals ?? "unreadable" : "off",
      };
      read.push("own_development");
    }
  }
  return { text: ownLearningContext({ programme, level, progress, development }), read };
}
