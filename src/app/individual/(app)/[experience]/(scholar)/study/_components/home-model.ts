import { experienceHref } from "@/lib/individual/experiences";
import { stageHref } from "@/lib/individual/scholar/study-carry";
import type { StudySpace } from "@/lib/individual/scholar/study-session";
import { monthLabel } from "@/lib/individual/scholar/monthly-review";

// THE SCHOLAR HOME: WHAT IT SAYS, from reads already made (modular restructuring S3). Pure: no reads, no AI.
//
// Every figure is the person's own. A read that could not complete is listed as a failure and is never turned into
// an empty row; a row with nothing to say is left out. Upcoming items are "learning checkpoints" (a monthly review
// and an exam date the learner set): they are practice and planning, never a formal assessment.

export const HOME_CARDS = [
  { key: "learning", title: "My Learning", line: "Learn your way.", cta: "Continue Learning" },
  { key: "courses", title: "Courses & Training", line: "Learn through structured programmes.", cta: "Explore Courses" },
  { key: "competencies", title: "My Competencies", line: "Develop and demonstrate your competencies.", cta: "View My Competencies" },
] as const;

export const NOTHING_YET = "Nothing to pick up yet. Start with your own notes in My Library.";

export const coursesExploreHref = () => experienceHref("scholar", "courses/explore");
export const competenciesHref = () => experienceHref("scholar", "my-competencies");

/** Where "Continue Learning" goes: the open study session in its last stage, else the active learning session, else Learn. No material at all: Upload in My Library. */
export function continueTarget(i: { noMaterial: boolean; study: { id: string; space: StudySpace } | null; resumeSessionId: string | null }): { href: string; label: string; kind: "upload" | "study" | "session" | "learn" } {
  if (i.noMaterial) return { href: `${experienceHref("scholar", "study")}#upload`, label: "Upload your first material", kind: "upload" };
  if (i.study) return { href: stageHref(i.study.space, i.study.id), label: HOME_CARDS[0].cta, kind: "study" };
  if (i.resumeSessionId) return { href: experienceHref("scholar", `study/learn?session=${i.resumeSessionId}`), label: HOME_CARDS[0].cta, kind: "session" };
  return { href: experienceHref("scholar", "study/learn"), label: HOME_CARDS[0].cta, kind: "learn" };
}

/** The learner's exam date as a checkpoint, only while it is today or ahead. */
export function examCheckpoint(plan: { examDate: string | null; examLabel: string | null } | null, today: string): { label: string; when: string } | null {
  if (!plan?.examDate || !/^\d{4}-\d{2}-\d{2}$/.test(plan.examDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const days = Math.round((Date.parse(`${plan.examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const date = new Date(`${plan.examDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return { label: `${plan.examLabel?.trim() || "Your exam date"}, ${date}`, when };
}

/** One read: its value, or that it could not be read, or that it does not apply here (off, not installed, nothing to ask). */
export type Part<T> = { state: "ok"; value: T } | { state: "failed" } | { state: "off" };
export const okPart = <T,>(value: T): Part<T> => ({ state: "ok", value });
export const failedPart = { state: "failed" } as const;
export const offPart = { state: "off" } as const;

export type NextStep = { title: string; minutes: number | null; href: string | null } | null;

export type ActivityInput = {
  study: { id: string; title: string; space: StudySpace } | null;
  /** My Plan's next step (off: not on, or none). */
  nextStep: Part<NextStep>;
  /** Courses not yet completed (off while courses are not offered). */
  courses: Part<{ id: string; title: string }[]>;
  monthly: Part<{ month: string }[]>;
  exam: Part<{ label: string; when: string } | null>;
  /** Coverage gaps, already limited to a measured programme. */
  gaps: Part<{ id: string; name: string }[]>;
  due: number | null;
  materials: Part<{ id: string; title: string }[]>;
};

export type ActivityItem = { key: string; text: string; sub?: string; href?: string; cta?: string };
export type ActivitySection = { key: string; heading: string; items: ActivityItem[]; failed: string[] };

const MAX_COURSES = 3;
const MAX_GAPS = 3;

/** The sections of the activity area, empty ones left out. An empty result is the "nothing yet" state. */
export function buildActivity(a: ActivityInput): ActivitySection[] {
  const out: ActivitySection[] = [];
  const add = (key: string, heading: string, items: ActivityItem[], failed: string[]) => { if (items.length || failed.length) out.push({ key, heading, items, failed }); };

  const cur: ActivityItem[] = []; const curFail: string[] = [];
  if (a.study) cur.push({ key: "study", text: a.study.title, sub: "Your open study session", href: stageHref(a.study.space, a.study.id), cta: "Continue study session" });
  if (a.nextStep.state === "failed") curFail.push("Your My Plan next step");
  else if (a.nextStep.state === "ok" && a.nextStep.value) {
    const n = a.nextStep.value;
    cur.push({ key: "plan", text: n.title, sub: `Next in My Plan${n.minutes !== null ? ` · ${n.minutes} min` : ""}`, href: n.href ?? experienceHref("scholar", "study/plan"), cta: n.href ? "Start studying" : "Open My Plan" });
  }
  add("current", "Pick up where you left off", cur, curFail);

  const courses: ActivityItem[] = []; const courseFail: string[] = [];
  if (a.courses.state === "failed") courseFail.push("Your courses");
  else if (a.courses.state === "ok") {
    for (const c of a.courses.value.slice(0, MAX_COURSES)) courses.push({ key: c.id, text: c.title, sub: "In progress", href: `/individual/learning/record/${c.id}`, cta: "Open course" });
    if (a.courses.value.length > MAX_COURSES) courses.push({ key: "more", text: `${a.courses.value.length - MAX_COURSES} more in progress`, href: experienceHref("scholar", "courses/mine"), cta: "My Courses" });
  }
  add("courses", "Active courses", courses, courseFail);

  const up: ActivityItem[] = []; const upFail: string[] = [];
  if (a.monthly.state === "failed") upFail.push("Your monthly review");
  else if (a.monthly.state === "ok")
    for (const n of a.monthly.value) up.push({ key: `m-${n.month}`, text: `Monthly review: ${monthLabel(n.month)}`, sub: "A learning checkpoint. It is practice, not a formal assessment.", href: experienceHref("scholar", "study/evaluate"), cta: "Open Evaluate" });
  if (a.exam.state === "failed") upFail.push("Your study plan");
  else if (a.exam.state === "ok" && a.exam.value) up.push({ key: "exam", text: a.exam.value.label, sub: `Learning checkpoint ${a.exam.value.when}, from the date you set in your plan.`, href: experienceHref("scholar", "study/plan"), cta: "Open My Plan" });
  add("upcoming", "Upcoming learning checkpoints", up, upFail);

  const gaps: ActivityItem[] = []; const gapFail: string[] = [];
  if (a.gaps.state === "failed") gapFail.push("Your competency coverage");
  else if (a.gaps.state === "ok")
    for (const g of a.gaps.value.slice(0, MAX_GAPS)) gaps.push({ key: g.id, text: g.name, sub: "Not yet touched by your practice", href: experienceHref("scholar", `study/learn?competency=${g.id}`), cta: "Study this" });
  add("gaps", "Priority gaps", gaps, gapFail);

  const prog: ActivityItem[] = []; const progFail: string[] = [];
  if (a.due === null) progFail.push("Your cards due");
  else if (a.due > 0) prog.push({ key: "due", text: `${a.due} ${a.due === 1 ? "card" : "cards"} due`, sub: "A short recall session from your saved questions", href: experienceHref("scholar", "study/revise"), cta: "Open revision" });
  if (a.materials.state === "failed") progFail.push("Your latest material");
  else if (a.materials.state === "ok" && a.materials.value[0]) {
    const m = a.materials.value[0];
    prog.push({ key: "latest", text: m.title, sub: "Your latest material", href: experienceHref("scholar", `study/${m.id}`), cta: "Open" });
  }
  add("progress", "Recent progress", prog, progFail);

  return out;
}
