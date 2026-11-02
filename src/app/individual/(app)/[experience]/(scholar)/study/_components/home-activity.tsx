import Link from "next/link";
import type { IndividualContext } from "@/lib/individual/guard";
import type { IndividualPolicy } from "@/lib/individual/policy";
import { loadToday } from "@/lib/individual/scholar/plan-data";
import { getStudyPlan, studyPlanSchema } from "@/lib/individual/scholar/store";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { loadLearningIntelligence } from "@/lib/individual/scholar/intelligence-data";
import { COVERAGE_REASON } from "@/lib/competency/progress-model";
import { loadMonthlyOverview, monthlyReviewOn } from "@/lib/individual/scholar/monthly-review-data";
import { learningEnabled } from "@/lib/learning/policy";
import { myRecords } from "@/lib/learning/record";
import { isStudyPlanOn } from "@/lib/individual/policy";
import type { ScholarModuleKey } from "@/lib/individual/scholar/module-access";
import { focusRing } from "../../../../../_components/chrome";
import { buildActivity, examCheckpoint, failedPart, NOTHING_YET, offPart, okPart, type ActivityInput, type NextStep, type Part } from "./home-model";

// THE SCHOLAR HOME'S ACTIVITY AREA -- modular restructuring S3.
//
// Real reads only, each run in parallel with the others and each failing on its own: a read that throws or
// reports an error becomes "could not be read" for its row and never an empty one. Existing readers are reused
// as they are (My Plan's Today, the study plan, the monthly overview, Learning Intelligence's coverage, the
// Competen Learning record). No AI call, and nothing here enrols, pays for or certifies anything.

type Extras = Pick<ActivityInput, "nextStep" | "courses" | "monthly" | "exam" | "gaps">;

/** Runs one read; a throw is a failure for that row alone. */
async function guarded<T>(read: () => Promise<Part<T>>): Promise<Part<T>> {
  try { return await read(); } catch { return failedPart; }
}

export async function readHomeExtras(ctx: IndividualContext, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; modules: readonly ScholarModuleKey[] }): Promise<Extras> {
  const { admin, userId } = ctx;
  const [nextStep, courses, monthly, exam, gaps] = await Promise.all([
    // My Plan's next step, only where My Plan is on. A gate that is shut is "off", not a failure.
    guarded<NextStep>(async () => {
      if (policy.scholarMyPlan !== "on") return offPart;
      const t = await loadToday(ctx, policy, o);
      return t.ok ? okPart(t.next ? { title: t.next.title, minutes: t.next.minutes, href: t.next.href } : null) : offPart;
    }),
    // Active courses: only while Competen Learning is on for this deployment.
    guarded<{ id: string; title: string }[]>(async () => {
      // Courses & Training is private while in development: its records are not even read for a learner who may not see it.
      if (!o.modules.includes("courses")) return offPart;
      if (!(await learningEnabled(admin).catch(() => false))) return offPart;
      const rs = await myRecords(admin, userId);
      if (rs === null) return failedPart;
      return okPart(rs.filter(r => r.status === "enrolled" || r.status === "in_progress").map(r => ({ id: r.id, title: r.title })));
    }),
    // The monthly review nudge, only where the review is on. null is an unreadable record.
    guarded<{ month: string }[]>(async () => {
      if (!monthlyReviewOn(policy)) return offPart;
      const m = await loadMonthlyOverview(admin, userId, policy, o.today);
      return m ? okPart(m.nudges.map(n => ({ month: n.month }))) : failedPart;
    }),
    // The exam date the learner set in their plan, only where the plan is on (780 present).
    guarded<{ label: string; when: string } | null>(async () => {
      if (!policy.scholarStudyPlan || !isStudyPlanOn(policy, await studyPlanSchema(admin, userId))) return offPart;
      const p = await getStudyPlan(admin, userId);
      if (!p.ok) return p.notProvisioned ? offPart : failedPart;
      return okPart(examCheckpoint(p.data, o.today));
    }),
    // Priority gaps: only with a programme set and coverage measured. No programme, or not measured, is "off"; an unreadable one is a failure.
    guarded<{ id: string; name: string }[]>(async () => {
      const learner = await loadLearnerCatalogue(admin, userId);
      if (!learner.provisioned) return offPart;
      if (!learner.programme) return offPart;
      if (learner.competencies === null) return failedPart;
      const li = await loadLearningIntelligence(admin, userId, policy, o.today, { tz: o.tz });
      if (!li.ok) return li.notProvisioned ? offPart : failedPart;
      const c = li.data.coverage;
      if (c.state === "measured") return okPart(c.gaps.slice(0, 3).map(g => ({ id: g.id, name: g.name })));
      return c.state === "not_measured" && c.reason === COVERAGE_REASON.unreadable ? failedPart : offPart;
    }),
  ]);
  return { nextStep, courses, monthly, exam, gaps };
}

export default function HomeActivity({ input, accent, modules }: { input: ActivityInput; accent: string; modules: readonly ScholarModuleKey[] }) {
  const sections = buildActivity(input, modules);
  return (
    <section aria-labelledby="activity-h" data-testid="home-activity" className="mb-6">
      <h2 id="activity-h" className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">Your activity</h2>
      {sections.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 text-[15px] text-gray-700">{NOTHING_YET}</p>
      ) : (
        <div className="mt-3 grid gap-[18px] md:grid-cols-2">
          {sections.map(s => (
            <section key={s.key} aria-labelledby={`act-${s.key}`} className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 id={`act-${s.key}`} className="text-[16px] font-bold text-gray-900">{s.heading}</h3>
              {s.items.length > 0 && (
                <ul className="mt-2 divide-y divide-gray-200">
                  {s.items.map(i => (
                    <li key={i.key} className="flex flex-col gap-1 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="break-words text-[15px] font-semibold text-gray-900">{i.text}</p>
                        {i.sub && <p className="text-[13.5px] text-gray-600">{i.sub}</p>}
                      </div>
                      {i.href && i.cta && (
                        <Link href={i.href} className={`inline-flex min-h-[44px] shrink-0 items-center text-[15px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: accent }}>
                          {i.cta}<span className="sr-only">: {i.text}</span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {s.failed.map(f => (
                <p key={f} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">{f} could not be read just now. This is not the same as having none. Try again shortly.</p>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
