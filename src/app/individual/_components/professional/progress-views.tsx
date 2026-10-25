import Link from "next/link";
import { focusRing } from "../chrome";
import { ApiForm, Field, inputCls } from "./forms";
import { Empty, Section, fmtDate } from "./bits";
import type { Bucket, CompetencyRow, JourneyGroup, LearningProgress, NextStep, TimelineEvent, TreeNode } from "@/lib/individual/professional/progress-intel";

// ── MY PROFESSIONAL PROGRESS: SERVER-RENDERED VIEWS ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR1-PR6 ────────────────────────────
//
// Next actions first and few numbers. Every next step says the finding it comes from and opens its owning module. In
// competency progress the five things are columns side by side, never combined. Missing evidence reads "Nothing recorded
// yet", never zero. Dates are the record's own: when it happened and when it was recorded, both kept.

const KIND_LABEL: Record<string, string> = {
  need: "Need", goal: "Goal", goal_done: "Goal addressed", goal_revised: "Goal review", cpd: "CPD", learning: "Course", assessment: "Assessed course",
  reflection: "Reflection", self_assessment: "Self-assessment", verification: "Independent decision", milestone: "Milestone", profile: "Profile", evaluation: "Evaluation", context: "Context",
};

export function NextSteps({ steps, accent }: { steps: readonly NextStep[]; accent: string }) {
  if (!steps.length) return <Empty>No next steps are suggested right now. Your record is up to date with the current rules.</Empty>;
  return (
    <ul className="divide-y divide-gray-100">
      {steps.map(s => (
        <li key={s.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-gray-900">{s.title}</p>
            <p className="text-[12.5px] text-gray-600">Because: {s.finding}</p>
            <Link href={s.href} className={`mt-1 inline-flex min-h-[36px] items-center text-[13.5px] font-semibold ${focusRing}`} style={{ color: accent }}>{s.hrefLabel} →</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["deferred", "dismissed"] as const).map(d => (
              <ApiForm key={d} action="/api/individual/professional/progress" submitLabel={d === "deferred" ? "Later" : "Dismiss"} accent={accent} reset={false} savedText={d === "deferred" ? "Deferred for 30 days." : "Dismissed."}>
                <input type="hidden" name="action" value="decide" /><input type="hidden" name="key" value={s.key} /><input type="hidden" name="decision" value={d} />
                {d === "deferred" && <input type="hidden" name="deferredUntil" value={new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)} />}
              </ApiForm>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EventList({ events }: { events: readonly TimelineEvent[] }) {
  return (
    <ul className="divide-y divide-gray-100">
      {events.map(e => (
        <li key={e.key} className="py-2">
          <p className="text-[13.5px] text-gray-900">
            <span className="mr-2 rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-semibold text-gray-700">{KIND_LABEL[e.kind] ?? e.kind}</span>
            {e.href ? <Link href={e.href} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`}>{e.title}</Link> : <span className="font-semibold">{e.title}</span>}
            {e.repeat && <span className="ml-2 text-[12px] font-semibold text-gray-600">· repeated practice</span>}
          </p>
          <p className="text-[12px] text-gray-500">{[`Happened ${fmtDate(e.occurredOn)}`, e.recordedOn && e.recordedOn !== e.occurredOn ? `recorded ${fmtDate(e.recordedOn)}` : null, e.source, e.version, e.category, e.note].filter(Boolean).join(" · ")}</p>
        </li>
      ))}
    </ul>
  );
}

export function TimeView({ buckets, periods, period, accent }: { buckets: readonly Bucket[]; periods: readonly (readonly [string, string])[]; period: string; accent: string }) {
  return (
    <>
      <nav aria-label="Reporting period" className="mb-3 flex flex-wrap gap-2 text-[13px]">
        {periods.map(([p, label]) => (
          <Link key={p} href={`?view=time&period=${p}`} aria-current={p === period ? "true" : undefined}
            className={`rounded-full border px-3 py-1 font-semibold ${focusRing} ${p === period ? "text-white" : "border-gray-300 text-gray-800"}`} style={p === period ? { background: accent, borderColor: accent } : undefined}>{label}</Link>
        ))}
      </nav>
      <p className="mb-3 text-[12.5px] text-gray-500">Changing the period only groups your records differently. No date, version or record is changed.</p>
      {buckets.length === 0 ? <Empty>Nothing is recorded yet.</Empty> : buckets.map(b => (
        <section key={b.key} aria-label={b.label} className="mb-2 rounded-xl border border-gray-200 p-3">
          <h3 className="text-[14px] font-semibold text-gray-900">{b.label} <span className="font-normal text-gray-500">· {b.events.length} {b.events.length === 1 ? "record" : "records"}{b.to ? ` · ${fmtDate(b.from)} to ${fmtDate(b.to)}` : ""}</span></h3>
          <EventList events={b.events} />
        </section>
      ))}
      <ApiForm action="/api/individual/professional/progress" submitLabel="Save a snapshot of this view" accent={accent} reset={false} savedText="Snapshot saved: the record keys and counts, never copies.">
        <input type="hidden" name="action" value="snapshot" /><input type="hidden" name="period" value={period} />
      </ApiForm>
    </>
  );
}

const Cell = ({ v, empty }: { v: string | null; empty: string }) => <td className="py-2 pr-3 align-top">{v ?? <span className="text-gray-500">{empty}</span>}</td>;
function CompetencyTable({ rows }: { rows: readonly CompetencyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <caption className="sr-only">Each competency, with expected, self-assessed, evidence, formative and independent columns kept apart</caption>
        <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500">
          {["Competency", "Expected", "Self-assessed", "Evidence", "Formative evaluation", "Independent decision", "Evidence confidence"].map(h => <th key={h} scope="col" className="py-2 pr-3 font-bold">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-gray-100">
              <th scope="row" className="py-2 pr-3 align-top font-semibold text-gray-900">{r.name}{r.personal && <span className="block text-[11.5px] font-normal text-gray-500">In your own words, never verified</span>}
                {r.outcomes.length > 0 && <span className="block text-[11.5px] font-normal text-gray-600">Outcomes: {r.outcomes.join("; ")}</span>}
                {r.limitations.map(l => <span key={l} className="block text-[11.5px] font-normal text-amber-900">{l}</span>)}</th>
              <Cell v={r.expected} empty="Not set" /><Cell v={r.selfAssessed} empty="Not self-assessed" /><Cell v={r.evidence ? `${r.evidence} linked` : null} empty="Nothing recorded yet" />
              <Cell v={r.formative} empty="Not evaluated" /><Cell v={r.independent} empty="None recorded" /><Cell v={r.confidence} empty="" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompetencyView({ tree, personal, byGoal, href }: { tree: readonly TreeNode[]; personal: readonly CompetencyRow[]; byGoal: readonly { goal: string; competencies: string[] }[]; href: string }) {
  return (
    <>
      {tree.length === 0 && personal.length === 0 ? <Empty>No competency is linked yet. That is fine: <Link href={href} className="font-semibold underline">My Competencies</Link> works with or without a catalogue, and your goals and learning count without one.</Empty> : null}
      {tree.map(n => (
        <section key={`${n.domain}|${n.cpu}`} aria-label={`${n.domain}, ${n.cpu}`} className="mb-3 rounded-xl border border-gray-200 p-3">
          <h3 className="text-[14px] font-semibold text-gray-900">{n.domain} <span className="font-normal text-gray-500">→ {n.cpu}</span></h3>
          <CompetencyTable rows={n.rows} />
        </section>
      ))}
      {personal.length > 0 && <Section title="Personal capabilities" note="Competencies in your own words, for when no catalogue fits. Self-assessed and evidenced, never verified."><CompetencyTable rows={personal} /></Section>}
      {byGoal.length > 0 && (
        <Section title="By goal">
          <ul className="space-y-1 text-[13.5px]">{byGoal.map(g => <li key={g.goal}><span className="font-semibold">{g.goal}:</span> {g.competencies.join("; ")}</li>)}</ul>
        </Section>
      )}
    </>
  );
}

export function LearningStats({ p }: { p: LearningProgress }) {
  const tile = (label: string, value: string, sub: string) => (
    <div className="rounded-xl border border-gray-200 p-3"><p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</p><p className="text-[12px] text-gray-600">{sub}</p></div>
  );
  return (
    <>
      {p.participation.state !== "measured" ? <p className="text-[13.5px] text-gray-700">{p.participation.reason}</p> : (
        <div className="grid gap-3 sm:grid-cols-3">
          {tile("Participation", `${p.participation.entries + p.participation.courses}`, `${p.participation.entries} CPD entries and ${p.participation.courses} courses since ${fmtDate(p.participation.since)}`)}
          {tile("Assessment results", String(p.assessments), "Courses with assessed knowledge: formative, not verification")}
          {tile("Hours recorded", p.hours == null ? "Not recorded" : String(p.hours), p.points == null ? "No CPD points recorded" : `${p.points} CPD points recorded`)}
          {tile("Reflections", String(p.reflections), `${p.applied} say the learning was applied in practice (your report)`)}
          {tile("Linked to goals", String(p.linkedToGoals), "Learning records serving a goal in your plan")}
          {tile("Completions", String(p.completions), "Competen Learning courses completed")}
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-gray-500">Volume shows activity. It is not by itself evidence of what you learned, and never of verified competence.</p>
      {p.requirement && <div className="mt-3 rounded-xl border border-gray-200 p-3"><p className="text-[13.5px] font-semibold text-gray-900">{p.requirement.label}</p><p className="text-[12.5px] text-gray-700">{p.requirement.text}</p></div>}
      {p.interests.length > 0 && <p className="mt-3 text-[13px] text-gray-700"><span className="font-semibold">Current learning interests (your own):</span> {p.interests.map(i => i.title).join("; ")}.</p>}
    </>
  );
}

export function CareerView({ groups, accent, profileHref }: { groups: readonly JourneyGroup[]; accent: string; profileHref: string }) {
  if (!groups.length) return <Empty>Your journey starts with your profile. <Link href={profileHref} className="font-semibold underline" style={{ color: accent }}>Add qualifications, roles and aspirations</Link>.</Empty>;
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.category}>
          <h3 className="text-[14px] font-bold text-gray-900">{g.category}</h3>
          <ul className="mt-1 divide-y divide-gray-100">
            {g.items.map((i, n) => (
              <li key={n} className="py-1.5 text-[13.5px]"><span className="font-semibold">{i.title}</span>{i.detail ? `, ${i.detail}` : ""}
                <span className="text-[12px] text-gray-500"> · {i.from ? fmtDate(i.from) : "Date not recorded"}{i.to ? ` to ${fmtDate(i.to)}` : ""}{i.kept ? " · an earlier version, kept" : ""}</span></li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[12.5px] text-gray-500">No ladder is imposed. Your direction is yours to define and revise in your profile, and earlier versions are kept.</p>
    </div>
  );
}

export function SaveView({ view, period, accent }: { view: string; period: string; accent: string }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <ApiForm action="/api/individual/professional/progress" submitLabel="Make this my default" accent={accent} reset={false} savedText="Saved as your default.">
        <input type="hidden" name="action" value="preference" /><input type="hidden" name="view" value={view} /><input type="hidden" name="period" value={period} />
      </ApiForm>
      <ApiForm action="/api/individual/professional/progress" submitLabel="Save view" accent={accent} savedText="View saved.">
        <input type="hidden" name="action" value="view" /><input type="hidden" name="view" value={view} /><input type="hidden" name="period" value={period} />
        <Field label="Name this view" htmlFor="view-name"><input id="view-name" name="name" required maxLength={120} className={inputCls} /></Field>
      </ApiForm>
    </div>
  );
}
