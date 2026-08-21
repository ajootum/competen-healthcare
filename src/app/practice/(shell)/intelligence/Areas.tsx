import Link from "next/link";
import type { IntelligenceSuite } from "@/lib/practice/intelligence";
import { PI_PANEL, STATE_COPY } from "@/lib/practice/intelligence-constants";
import { CARD, PanelHead, StateNote, Provenance, OpenableCountBlock, RefusedCard, Comparison } from "./Ui";
import { Distribution, Proportion, MetricLine, ModuleNote, LabelList, ComputedNotAi } from "./Parts";
import Trend from "./Trend";

// CPR-PI-001 s6's nine areas, minus the Assistant, which has its own file.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ EVERY ONE OF THESE IS A TAB INSIDE ONE WORKSPACE, NOT A ROUTE AND NOT A SIDEBAR ENTRY.
//
// All three comps draw the nine as an expanded submenu under Practice Intelligence in the global
// sidebar. s4 forbids that in the same paragraph that lists them: "Practice Intelligence may use
// internal tabs, but these must not create expandable global sidebar submenus." The flat nine-item
// sidebar s4 mandates stops meaning anything the moment one of its items unfolds into nine more.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ NO AREA HERE OPENS A FORM. s14: "No new clinical documentation within Practice Intelligence." Every
// figure links OUT to the workspace that owns the record. This suite reads; it never writes.

type Suite = IntelligenceSuite;

const grid2 = "grid gap-4 md:grid-cols-2";

// ── TODAY'S BRIEF ────────────────────────────────────────────────────────────────────────────────────

export function BriefArea({ suite }: { suite: Suite }) {
  const b = suite.brief;
  const tone: Record<string, string> = {
    critical: "border-rose-300 bg-rose-50 text-rose-800",
    warning: "border-amber-200 bg-amber-50/70 text-amber-800",
    normal: "border-slate-200 bg-slate-50/70 text-slate-700",
  };
  return (
    <section className={CARD}>
      <PanelHead panel="todays_brief" title="Today's clinical brief"
        note="Sentences counted from your own diary, follow-ups, consultations, tasks, documents and incoming register."
        action={{ href: "/practice/today", label: "Open today" }} />

      {/* ⚠ DERIVED, AND THE LABEL IS A FIELD RATHER THAN PAGE TEXT. brief.ts carries `status: "derived"`
          in the payload so a second surface cannot render the same sentences without it. */}
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500">
        <span className="rounded bg-emerald-50 px-1.5 py-[1px] text-[9px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-200">
          DERIVED
        </span>
        <span>Calculated {new Date(b.calculatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. {b.method}</span>
      </p>

      {b.items.length === 0 ? (
        <p className="mt-3 text-[12px] text-gray-500">
          {b.unavailable
            ? "Nothing could be counted. That is not the same as nothing waiting -- see the blind spots below."
            : "Nothing is waiting. A real answer, not an empty page."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {b.items.map(i => (
            <li key={i.key}>
              <Link href={i.href}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 transition hover:shadow-sm ${tone[i.severity] ?? tone.normal}`}>
                <span className="shrink-0 rounded bg-white/70 px-1.5 py-[1px] text-[11px] font-bold tabular-nums">
                  {i.count}
                </span>
                <span className="text-[12px] leading-snug">{i.sentence}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {b.blindSpots.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">
          Not in this brief because your role does not include it: {b.blindSpots.join(", ")}.
        </p>
      )}
      {/* ⚠ THE WORDS A DERIVED BRIEF MAY NOT USE. brief.ts keeps the list (FORBIDDEN_IN_BRIEF) and the
          harness asserts against it; saying so here is what stops somebody adding "trending up" later. */}
      <p className="mt-2 text-[10px] text-gray-400">
        Every sentence above is the length of a list that exists right now. None of them predicts, ranks
        or compares this practice with any other &mdash; there is nothing to compare it with.
      </p>
    </section>
  );
}

// ── PRACTICE ACTIVITY + CLINICAL TRENDS (the overview's two analytic panels) ─────────────────────────

export function ActivityPanel({ suite }: { suite: Suite }) {
  const m = suite.workspace.modules.clinicalActivity;
  const d = m.data;
  return (
    <section className={CARD}>
      <PanelHead panel="practice_activity" title="Practice activity"
        note={`Consultations per day across ${suite.range.period.label}, counted in this practice's own calendar rather than UTC.`}
        action={{ href: "/practice/intelligence?tab=clinical", label: "Clinical insights" }} />
      {!d ? <ModuleNote module={m} /> : (
        <>
          <Trend buckets={d.trend.buckets} />
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-gray-600">
            <span><b className="text-[13px] text-violet-700">{d.trend.total}</b> this period</span>
            {/* A COUNT AGAINST A COUNT. The comps write "up 12% vs last week". */}
            <span><b className="text-[13px] text-gray-700">{d.trend.priorTotal}</b> in the period before</span>
            {d.trend.busiestDay && d.trend.busiestDay.total > 0 && (
              <span className="text-gray-500">busiest {d.trend.busiestDay.day} with {d.trend.busiestDay.total}</span>
            )}
          </div>
          <div className="mt-3 flex flex-col">
            <MetricLine m={d.completed} figureClass="text-violet-700" />
            <MetricLine m={d.patientsSeen} figureClass="text-violet-700" />
          </div>
          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

export function TrendsPanel({ suite }: { suite: Suite }) {
  const m = suite.workspace.modules.overview;
  const d = m.data;
  return (
    <section className={CARD}>
      <PanelHead panel="clinical_trends" title="Compared with the period before"
        note={`Against ${suite.range.prior.fromDay} to ${suite.range.prior.toDay}.`} />
      {!d ? <ModuleNote module={m} /> : (
        <>
          {/* ⚠ CPR-PI-002 s5 ASKS FOR "time trends, comparisons" AND THIS IS THEM -- gated, not refused.
              Two things about the comps' "▲12% vs last week" are wrong and only two: the percentage,
              and the assumption that last week existed. Both are fixed here. */}
          {!suite.range.priorUsable && (
            <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-gray-700">No comparison for this window</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{suite.range.priorReason}</p>
            </div>
          )}
          <div className="mt-2 flex flex-col">
            {d.comparisons.map(c => <Comparison key={c.key} c={c} />)}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            Differences are signed counts. A percentage of a small base moves violently for reasons
            nobody acted on, and a practice younger than the window it is compared against has no
            previous period at all.
          </p>
          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

// ── PATIENTS ─────────────────────────────────────────────────────────────────────────────────────────

export function PatientsArea({ suite, compact }: { suite: Suite; compact?: boolean }) {
  const m = suite.patients;
  const d = m.data;
  const reg = suite.workspace.modules.patients.data;

  return (
    <section className={CARD}>
      <PanelHead panel="patient_attention" title="Patients needing attention"
        note={d ? `Date rules only, as at ${d.today}. Each figure is a list you can open.` : undefined}
        action={{ href: "/practice/patients", label: "All patients" }} />

      {!d ? <ModuleNote module={m} /> : (
        <>
          <div className="mt-3 flex flex-col gap-4">
            {d.groups.map(g => (
              <OpenableCountBlock key={g.key} item={g}
                figureClass={g.key === "overdue" ? "text-rose-700" : g.key === "lost_to_follow_up" ? "text-amber-700" : "text-violet-700"} />
            ))}
          </div>

          {/* ⚠ THE THREE STATES s5 ASKS FOR THAT NOTHING RECORDED, IN THE POSITION THEY WOULD OCCUPY.
              This is the point of the whole panel: an omitted card reads as a feature nobody got round
              to, and a card that says what would make it real is the difference between a gap and a lie. */}
          <div className="mt-5">
            <div className="flex items-center gap-2">
              <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-lg text-[13px] ${PI_PANEL.refused.badge}`}>⊘</span>
              <div>
                <h3 className="text-[12px] font-bold text-gray-800">The three the specification asks for and nothing recorded</h3>
                <p className="text-[10px] text-gray-500">
                  Improving, deteriorating and high complexity are clinical trajectories. No clinician has
                  ever been asked, in this software, whether a patient is getting better.
                </p>
              </div>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {d.refused.map(r => (
                <RefusedCard key={r.key} label={r.label} why={r.why} wouldRequire={r.wouldRequire} />
              ))}
            </div>
          </div>

          {!compact && reg && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <h3 className="text-[12px] font-bold text-gray-800">Who this practice sees</h3>
              <div className={`mt-2 ${grid2}`}>
                <Distribution d={reg.bySex} />
                <Distribution d={reg.byAgeBand} />
              </div>
              <div className="mt-3 flex flex-col">
                <MetricLine m={reg.patientsSeen} figureClass="text-violet-700" />
                <Proportion p={reg.newToPractice} />
              </div>
              {!reg.identified && (
                <p className="mt-2 text-[11px] text-gray-500">
                  You hold reporting access but not clinical access, so this shows counts and no patient
                  names &mdash; the same rule the access log follows.
                </p>
              )}
            </div>
          )}
          <ModuleNote module={m} />

          {/* CPR-PIE-001 §4's "parameter deterioration" and §7's alert framework, which is the one part
              of PIE that had a real store and no reader at all. Full area only: the Overview's compact
              patients panel is the date rules, and an alert board underneath it would bury them. */}
          {!compact && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <AlertsPanel suite={suite} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── COHORTS ──────────────────────────────────────────────────────────────────────────────────────────

export function CohortsArea({ suite, query }: { suite: Suite; query: string }) {
  const m = suite.cohorts;
  const d = m.data;
  const link = (dim: string) => {
    const p = new URLSearchParams(query);
    p.set("tab", "cohorts");
    p.set("cohortBy", dim);
    return `/practice/intelligence?${p.toString()}`;
  };

  return (
    <section className={CARD}>
      <PanelHead panel="cohorts" title="Cohorts"
        note="Groups of patients, defined by an attribute this record actually holds." />

      {d && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.available.map(a => (
            <Link key={a.key} href={link(a.key)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                a.key === d.dimension
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-gray-200 bg-white text-violet-700 hover:bg-violet-50"
              }`}>
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {!d ? <ModuleNote module={m} /> : (
        <>
          <StateNote status={d.status} reason={d.reason} />
          {d.status === "ok" && (
            <>
              <p className="mt-2 text-[11px] text-gray-500">{d.note}</p>
              {d.slices.length === 0 ? (
                <p className="mt-3 text-[12px] text-gray-400">
                  No patient carries this attribute in this window. {STATE_COPY.empty.body}
                </p>
              ) : (
                <ul className="mt-3 flex flex-col">
                  {d.slices.map((s, i) => (
                    <li key={s.key} className="border-b border-gray-100 py-1.5 last:border-0">
                      <div className="flex items-baseline gap-2">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${
                          ["bg-violet-500", "bg-emerald-500", "bg-cyan-500", "bg-amber-500", "bg-sky-500", "bg-rose-500"][i % 6]
                        }`} />
                        <span className="min-w-0 truncate text-[12px] text-gray-800" title={s.label}>{s.label}</span>
                        {/* PEOPLE AND RECORDS AS TWO NUMBERS. One person with two diagnoses is one
                            patient and two records, and a single figure under an ambiguous label is how
                            a cohort counting rows ends up beside a list counting people. */}
                        <span className="ml-auto shrink-0 text-[12px] font-bold tabular-nums text-violet-700">
                          {s.patients}
                          <span className="ml-1 text-[10px] font-normal text-gray-500">
                            {s.patients === 1 ? "patient" : "patients"}
                          </span>
                        </span>
                        <span className="w-20 shrink-0 text-right text-[10px] text-gray-400">
                          {s.records} record{s.records === 1 ? "" : "s"}
                        </span>
                      </div>
                      {s.sample.length > 0 && (
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {s.sample.map(x => (
                            <Link key={x.id} href={x.href ?? "/practice/patients"}
                              className="rounded border border-gray-200 bg-gray-50 px-1.5 py-[1px] text-[10px] text-gray-700 hover:bg-gray-100">
                              {x.label}
                            </Link>
                          ))}
                          {s.sampleIsPartial && <span className="px-1 py-[1px] text-[10px] text-gray-400">and more</span>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                {/* ⚠ THE SLICES DO NOT SUM AND THE PAGE SAYS SO. */}
                {d.patientsInAnySlice} distinct patient{d.patientsInAnySlice === 1 ? "" : "s"} across every
                group above. That is a set union, not the sum of the rows &mdash; one person can be in
                several groups, so adding the rows up would count them twice.
                {d.unclassified > 0 && ` ${d.unclassified} record${d.unclassified === 1 ? "" : "s"} had nothing recorded for this attribute and ${d.unclassified === 1 ? "is" : "are"} in no group.`}
              </p>
              {!d.identified && (
                <p className="mt-1 text-[11px] text-gray-500">
                  Counted and not named: you hold reporting access but not clinical access.
                </p>
              )}
            </>
          )}
          <Provenance formula={d.formula} fromDay={d.fromDay} toDay={d.toDay} />
          {/* ⚠ "SAVE COHORT" IS s9's ACTION AND IT IS NOT BUILT HERE. Saying so, rather than drawing a
              button that does nothing. */}
          <p className="mt-2 text-[10px] text-gray-400">
            Saving a group for later is not built into this area. The practice&rsquo;s saved-search store
            already holds named filters &mdash; <Link href="/practice/search" className="underline">Search</Link> owns it &mdash;
            and a second store here would be a second answer to &ldquo;what is my epilepsy cohort&rdquo;.
          </p>
          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

// ── CLINICAL INSIGHTS ────────────────────────────────────────────────────────────────────────────────

export function ClinicalArea({ suite }: { suite: Suite }) {
  const patients = suite.workspace.modules.patients;
  const procedures = suite.workspace.modules.procedures;
  const followUps = suite.workspace.modules.followUps;
  const activity = suite.workspace.modules.clinicalActivity;
  const documents = suite.workspace.modules.documents;

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <PanelHead panel="clinical_trends" title="What this practice sees"
          note="Diagnosis labels, counted exactly as they were typed. Nothing here forces a terminology, and tidying the labels would invent a coding nobody performed." />
        {!patients.data ? <ModuleNote module={patients} /> : (
          <>
            <LabelList rows={patients.data.diagnoses.rows.slice(0, 10)}
              empty="No diagnoses recorded in this period. A fact about the period, not a gap in the data." />
            <p className="mt-1.5 text-[10px] text-gray-400">
              {patients.data.diagnoses.total} recorded across {patients.data.diagnoses.distinctLabels} distinct labels.
            </p>
            <ModuleNote module={patients} />
          </>
        )}
      </section>

      <div className={grid2}>
        <section className={CARD}>
          <PanelHead panel="clinical_trends" title="What this practice does"
            note="Procedures, and what became of them." />
          {!procedures.data ? <ModuleNote module={procedures} /> : (
            <>
              <LabelList rows={procedures.data.topLabels} empty="No procedures recorded in this period." />
              <div className="mt-3 flex flex-col">
                <Proportion p={procedures.data.complications} />
                <Proportion p={procedures.data.abandoned} />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <Distribution d={procedures.data.byCategory} />
                <Distribution d={procedures.data.byConsent} />
              </div>
              <ModuleNote module={procedures} />
            </>
          )}
        </section>

        <section className={CARD}>
          <PanelHead panel="patient_attention" title="What this practice promised"
            note="Follow-ups raised in this window and what became of them." />
          {!followUps.data ? <ModuleNote module={followUps} /> : (
            <>
              <div className="flex flex-col">
                <MetricLine m={followUps.data.due} figureClass="text-rose-700" />
                <Proportion p={followUps.data.completion} />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <Distribution d={followUps.data.byKind} />
                <Distribution d={followUps.data.byPriority} />
              </div>
              <ModuleNote module={followUps} />
            </>
          )}
        </section>
      </div>

      <div className={grid2}>
        <section className={CARD}>
          <PanelHead panel="practice_activity" title="How the work happened" />
          {!activity.data ? <ModuleNote module={activity} /> : (
            <div className="flex flex-col gap-3">
              <Distribution d={activity.data.byMode} />
              <Distribution d={activity.data.byPathway} />
              <Distribution d={activity.data.byActivityType} />
            </div>
          )}
        </section>

        <section className={CARD}>
          <PanelHead panel="recent_reports" title="What this practice wrote"
            note="Documents, and the ones nobody has finished." />
          {!documents.data ? <ModuleNote module={documents} /> : (
            <>
              <div className="flex flex-col gap-3">
                <Distribution d={documents.data.byStatus} />
                <Distribution d={documents.data.byType} />
                <Distribution d={documents.data.incoming} />
              </div>
              <div className="mt-3 flex flex-col">
                <Proportion p={documents.data.unsigned} />
              </div>
              <ModuleNote module={documents} />
            </>
          )}
        </section>
      </div>

      {/* CPR-PIE-001 §5's referral trends. The store has existed since migration 238 and this is the
          first reader it has had; it sits here because a referral is a clinical conclusion, beside the
          diagnoses and the procedures that led to it. */}
      <ReferralsPanel suite={suite} />

      {/* ⚠ WHAT THIS PRODUCT CANNOT COMPUTE, NAMED. A reader cannot tell an absent number from an
          unbuilt one, and the comps show every one of these as a figure. */}
      <section className={`${CARD} border-dashed bg-gray-50/60`}>
        <PanelHead panel="refused" title="What this page will not tell you"
          note="The designs show each of these as a number. None is knowable from this practice's own records." />
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {suite.workspace.modules.ai.data?.refusedClaims.map((r, i) => (
            <li key={i} className="rounded-lg border border-dashed border-slate-300 bg-white p-2.5">
              <p className="text-[11px] font-bold text-gray-700">{r.claim}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{r.why}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                <span className="font-semibold">Would require: </span>{r.wouldRequire}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* CPR-PIE-001 §3/§4/§5's modules with no store at all -- a different claim from the list above,
          which is about figures this product's records cannot support. These are whole modules whose
          tables do not exist. */}
      <NotBuildableArea suite={suite} />
    </div>
  );
}

// ── REFERRALS -- CPR-PIE-001 §5 ──────────────────────────────────────────────────────────────────────
//
// ⚠ THE HEADING AND THE CAPTION ARE DOING SAFETY WORK HERE, WHICH IS UNUSUAL FOR COPY.
//
// practice_referral has no channel and no sent_at (migration 238, deliberately), so a panel headed
// "Referrals outstanding" would be read as letters sitting in somebody's inbox awaiting a reply. It is
// not that. It is a list of decisions a practitioner wrote down, and the ones nobody has since written
// any news about. The engine carries that sentence in the payload; this draws it where it is read.

export function ReferralsPanel({ suite }: { suite: Suite }) {
  const m = suite.referrals;
  const d = m.data;

  return (
    <section className={CARD}>
      <PanelHead panel="clinical_trends" title="Where this practice sends people"
        note="Referrals recorded in this window, and the ones nobody has heard anything about." />
      {!d ? <ModuleNote module={m} /> : (
        <>
          <div className="mt-3 flex flex-col gap-4">
            <OpenableCountBlock item={d.made} figureClass="text-emerald-700" />
            <OpenableCountBlock item={d.awaitingNews} figureClass="text-amber-700" />
          </div>

          <div className="mt-4">
            <Comparison c={d.change} />
          </div>

          <div className="mt-4">
            <Distribution d={d.byStatus} />
          </div>

          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[12px] font-bold text-gray-800">Destinations</h3>
              {d.distinctDestinations !== null && (
                <span className="ml-auto text-[10px] text-gray-500">
                  {d.distinctDestinations} distinct {d.distinctDestinations === 1 ? "destination" : "destinations"} typed
                </span>
              )}
            </div>
            <LabelList rows={d.destinations}
              empty="No referral was recorded in this period. A fact about the period, not a gap in the data." />
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
              Counted exactly as they were typed, with only surrounding spaces removed. Referred-to is
              free text because the service may be at an institution this product has never heard of, and
              merging spellings would invent a facility register nobody maintains.
            </p>
          </div>

          {/* ⚠ THE LIMITATION, WHERE IT IS READ. Not a footnote and not a tooltip. */}
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-2.5 py-2 text-[10px] leading-relaxed text-gray-600">
            <span className="font-semibold text-gray-700">Recorded, not sent. </span>{d.limitation}
          </p>

          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

// ── CLINICAL PARAMETER ALERTS -- CPR-PIE-001 §7, AND §4's "PARAMETER DETERIORATION" ───────────────────
//
// ⚠ "NOT CLASSIFIED" IS DRAWN AS TWO WORDS AND NEVER AS A QUIET BAR AT THE BOTTOM OF THE LIST.
//
// Migration 246 makes severity nullable and states the rendering rule itself: an alert whose rule
// declared no severity "must render as those words -- never as low, and never as a blank cell." So the
// count gets its own block, at the top of the severity list rather than the foot of it, because a
// classification nobody made is a question for somebody rather than the mildest answer.

export function AlertsPanel({ suite }: { suite: Suite }) {
  const m = suite.alerts;
  const d = m.data;

  return (
    <section className={CARD}>
      <PanelHead panel="patient_attention" title="Clinical parameter alerts"
        note="Raised by the parameter engine's own rules. Nothing on this page raises an alert or changes one."
        action={{ href: "/practice/patients", label: "Patients" }} />
      {!d ? <ModuleNote module={m} /> : (
        <>
          <div className="mt-3 flex flex-col gap-4">
            <OpenableCountBlock item={d.open} figureClass="text-rose-700" />
            {d.actionable.map(a => (
              <OpenableCountBlock key={a.key} item={a}
                figureClass={a.key === "alerts_critical" ? "text-rose-700" : "text-amber-700"} />
            ))}
            <OpenableCountBlock item={d.notClassified} figureClass="text-slate-600" />
            <OpenableCountBlock item={d.vitalSigns} figureClass="text-cyan-700" />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Distribution d={d.bySeverity} />
            <Distribution d={d.byType} />
          </div>

          <div className="mt-3 flex flex-col">
            <Proportion p={d.acknowledged} />
          </div>
          <div className="mt-2">
            <Comparison c={d.raised} />
          </div>

          {/* ⚠ THE TAXONOMY, IN THE OPEN. Four levels and one absence, each saying what it asserts, so
              nobody has to infer severity from a colour -- and so the fifth entry is visibly NOT a fifth
              level. Two documents disagreed about the third; the disagreement was settled in writing and
              the settlement is shown rather than assumed. */}
          <div className="mt-4 border-t border-gray-100 pt-3">
            <h3 className="text-[12px] font-bold text-gray-800">What the four levels mean</h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {d.taxonomy.map(t => (
                <li key={t.key} className="flex gap-2">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    t.key === "critical" ? "bg-rose-100 text-rose-700"
                      : t.key === "action_required" ? "bg-amber-100 text-amber-700"
                      : t.key === "advisory" ? "bg-sky-100 text-sky-700"
                      : t.key === "informational" ? "bg-slate-100 text-slate-600"
                      : "border border-dashed border-slate-300 bg-white text-slate-500"
                  }`}>
                    {t.label}
                  </span>
                  <span className="text-[10px] leading-relaxed text-gray-600">
                    {t.meaning}
                    {!t.isLevel && (
                      <span className="ml-1 font-semibold text-gray-700">Not a level.</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

// ── WHAT CPR-PIE-001 ASKS FOR THAT HAS NO STORE AT ALL ───────────────────────────────────────────────
//
// ⚠ A MODULE-SCALE VERSION OF THE REFUSED CARDS ON THE PATIENTS AREA, AND IT EARNS ITS SPACE THE SAME
// WAY. A reader who sees no medication panel cannot tell "unbuilt" from "not permitted" from "nothing
// happened this month", and the first of those three is the only one that is a roadmap item.

export function NotBuildableArea({ suite }: { suite: Suite }) {
  return (
    <section className={`${CARD} border-dashed bg-gray-50/60`}>
      <PanelHead panel="refused" title="What the specification asks for and this product has no store for"
        note="Each names the search that was run, so nobody repeats it." />
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {suite.notBuildable.map(u => (
          <div key={u.key} className="rounded-xl border border-dashed border-slate-300 bg-white p-3">
            <div className="flex items-baseline gap-2">
              <p className="text-[12px] font-bold text-gray-700">{u.label}</p>
              <span className="ml-auto shrink-0 text-[10px] text-gray-400">{u.from}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-gray-600">{u.why}</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
              <span className="font-semibold">What would make it real: </span>{u.wouldRequire}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── PATHWAYS ─────────────────────────────────────────────────────────────────────────────────────────

export function PathwaysArea({ suite }: { suite: Suite }) {
  const m = suite.pathways;
  const d = m.data;
  return (
    <section className={CARD}>
      <PanelHead panel="pathway_status" title="Care pathway status"
        note="Enrolment and stage progression, read from the Pathways engine rather than recounted here."
        action={{ href: "/practice/pathways", label: "Open pathways" }} />

      {!d ? <ModuleNote module={m} /> : (
        <>
          <StateNote status={d.status} reason={d.reason} />
          {d.status === "ok" && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
                {d.cards.map((c, i) => {
                  const hue = ["text-cyan-700", "text-violet-700", "text-emerald-700", "text-rose-700", "text-sky-700"][i % 5];
                  const box = ["border-cyan-200 bg-cyan-50/60", "border-violet-200 bg-violet-50/60",
                    "border-emerald-200 bg-emerald-50/60", "border-rose-200 bg-rose-50/60",
                    "border-sky-200 bg-sky-50/60"][i % 5];
                  return (
                    <div key={c.key} className={`rounded-xl border p-2.5 ${c.count === null ? "border-dashed border-slate-300 bg-white" : box}`}>
                      <p className={`text-xl font-bold tabular-nums ${c.count === null ? "text-slate-300" : hue}`}>
                        {c.count ?? "—"}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold text-gray-800">{c.label}</p>
                      <p className="mt-0.5 line-clamp-3 text-[9px] leading-snug text-gray-500">{c.blurb}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-col gap-4">
                <OpenableCountBlock item={d.milestonesPassed} figureClass="text-rose-700" />
                <OpenableCountBlock item={d.milestonesUpcoming} figureClass="text-cyan-700" />
              </div>
              {/* ⚠ THE COMPS DRAW AN "AT RISK" SEGMENT AND THERE IS NO SUCH STATE. */}
              <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
                The designs put an &ldquo;At risk&rdquo; band between On track and Overdue. A stage is
                before its date or past it; &ldquo;at risk&rdquo; would need a prediction about whether it
                is going to be met, and nothing here predicts. The Pathways engine refuses it by name and
                that refusal is inherited rather than worked around.
              </p>
            </>
          )}
          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}

// ── PERFORMANCE & PORTFOLIO ──────────────────────────────────────────────────────────────────────────

export function PerformanceArea({ suite, portfolio, exportHrefs }: {
  suite: Suite;
  /** CPR-PI-001 v2 s11's period summary -- person-scoped, one owner (portfolio.ts) for tab and report. */
  portfolio?: import("@/lib/practice/portfolio").PortfolioPeriodSummary;
  exportHrefs?: { csv: string; xlsx: string; print: string };
}) {
  const overview = suite.workspace.modules.overview;
  const growth = suite.workspace.modules.growth;
  const locations = suite.workspace.modules.locations;
  const pp = portfolio?.available ? portfolio.data : null;

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <PanelHead panel="performance" title="The twelve figures"
          note="Every one of these is defined and computed by one engine, so no two screens in this product can disagree about them." />
        {!overview.data ? <ModuleNote module={overview} /> : (
          <div className="mt-2 grid gap-x-6 md:grid-cols-2">
            {Object.values(overview.data.metrics.metrics).map(m => (
              <MetricLine key={m.key} m={m} figureClass="text-amber-700" />
            ))}
          </div>
        )}
        <ModuleNote module={overview} />
      </section>

      <div className={grid2}>
        <section className={CARD}>
          <PanelHead panel="performance" title="Growth" />
          {!growth.data ? <ModuleNote module={growth} /> : (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold tabular-nums ${growth.data.cumulativePatients.status === "ok" ? "text-emerald-700" : "text-slate-300"}`}>
                  {growth.data.cumulativePatients.value ?? "—"}
                </span>
                <span className="text-[12px] text-gray-700">patients ever registered</span>
              </div>
              <StateNote status={growth.data.cumulativePatients.status} reason={growth.data.cumulativePatients.reason} />
              <Provenance formula={growth.data.cumulativePatients.formula} />
              <p className="mt-2 text-[11px] text-gray-500">
                {growth.data.recordingSince
                  ? `Keeping records here since ${growth.data.recordingSince}. That date is what licenses any comparison at all.`
                  : "This practice has no recorded start date, so no comparison against an earlier period can be shown to be real."}
              </p>
              <div className="mt-3 flex flex-col">
                {growth.data.comparisons.map(c => <Comparison key={c.key} c={c} />)}
              </div>
              <ModuleNote module={growth} />
            </>
          )}
        </section>

        <section className={CARD}>
          <PanelHead panel="performance" title="Where the work happened" />
          {!locations.data ? <ModuleNote module={locations} /> : (
            <>
              {!locations.data.appointments.comparable ? (
                <p className="mt-2 text-[12px] text-gray-500">
                  This practice has fewer than two locations, so there is nothing to compare it with.
                  A site compared with itself is a chart with one bar.
                </p>
              ) : (
                <LabelList
                  rows={locations.data.appointments.locations.map((l: { name: string; appointments: number }) => ({ label: l.name, total: l.appointments }))}
                  empty="No appointments in this period." />
              )}
              <StateNote status={locations.data.encounters.status} reason={locations.data.encounters.reason} />
              {locations.data.encounters.status === "ok" && locations.data.encounters.rows.length > 0 && (
                <>
                  <h3 className="mt-3 text-[12px] font-bold text-gray-800">Consultations by site</h3>
                  <LabelList rows={locations.data.encounters.rows.map(r => ({ label: r.name, total: r.total }))}
                    empty="None placed at a site." />
                  {locations.data.encounters.unattributed > 0 && (
                    <p className="mt-1 text-[10px] text-amber-700">
                      {locations.data.encounters.unattributed} consultation
                      {locations.data.encounters.unattributed === 1 ? "" : "s"} carry no location and
                      {locations.data.encounters.unattributed === 1 ? " is" : " are"} counted separately
                      rather than spread across the sites.
                    </p>
                  )}
                </>
              )}
              <Provenance formula={locations.data.encounters.formula} />
              <ModuleNote module={locations} />
            </>
          )}
        </section>
      </div>

      <section className={CARD}>
        <PanelHead panel="performance" title="Your professional portfolio"
          note="Procedures, teaching, supervision and CPD, derived from records you already made."
          action={{ href: "/practice/portfolio", label: "Open portfolio" }} />
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          The portfolio is assembled from your own activity log and is a document you export rather than a
          dashboard you read, so it lives at its own route and is not duplicated here. Reflection and Case
          Memory sit beside it &mdash; all three live under Practice Intelligence without becoming
          panels inside it.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[["/practice/portfolio", "Portfolio"], ["/practice/reflection", "Reflection"], ["/practice/cases", "Case memory"], ["/practice/activity", "Clinical activity"]].map(([href, label]) => (
            <Link key={href} href={href}
              className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50">
              {label} →
            </Link>
          ))}
        </div>
      </section>

      {/* ── CPR-PI-001 v2 s11's CONDITIONAL ROWS, gates met: reflections (mig 216), teaching
             (activity kinds, mig 209) and CPD minutes are all INTENTIONALLY CAPTURED. Person-scoped:
             this is YOUR record in the selected period, not the practice's. ─────────────────────── */}
      {portfolio && (
        <section className={CARD}>
          <PanelHead panel="performance" title="Reflections, teaching and CPD this period"
            note="Only what you intentionally captured. Nothing is inferred, and CPD counts only items carrying minutes." />
          {!pp ? (
            <p className="mt-2 text-[12px] text-gray-600">{portfolio.reason ?? "Could not be read."}</p>
          ) : (
            <>
              <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {[
                  ["Reflections you authored", pp.reflections],
                  ["Teaching or training sessions", pp.teaching.sessions],
                  ["Teaching minutes (where entered)", pp.teaching.minutes],
                  ["CPD minutes (where entered)", pp.cpd.minutes],
                ].map(([k, v]) => (
                  <p key={String(k)} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-gray-700">{k}</span>
                    <span className="ml-auto font-bold tabular-nums text-gray-900">{v}</span>
                  </p>
                ))}
              </div>
              {pp.teaching.withoutDuration > 0 && (
                <p className="mt-1 text-[10px] text-amber-700">
                  {pp.teaching.withoutDuration} teaching session{pp.teaching.withoutDuration === 1 ? "" : "s"} carr
                  {pp.teaching.withoutDuration === 1 ? "ies" : "y"} no duration and contribute{pp.teaching.withoutDuration === 1 ? "s" : ""} no
                  minutes &mdash; never estimated.
                </p>
              )}
              {exportHrefs && (
                <div className="mt-3 border-t border-gray-100 pt-2">
                  <p className="text-[11px] font-semibold text-gray-700">Portfolio report for this period</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
                    Governed like every report: date range, definitions and provenance travel with the
                    file. s11&apos;s own rule: appraisal and credentialing support &mdash; not a claim of
                    competence or quality, and nothing in it is verified by this product.
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <a href={exportHrefs.csv} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">CSV ↓</a>
                    <a href={exportHrefs.xlsx} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">XLSX ↓</a>
                    <Link href={exportHrefs.print} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">Print</Link>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ── REPORTS ──────────────────────────────────────────────────────────────────────────────────────────

export function ReportsArea({ suite }: { suite: Suite }) {
  const m = suite.reports;
  const d = m.data;
  return (
    <section className={CARD}>
      <PanelHead panel="recent_reports" title="Reports"
        note="What this practice has defined, and where the exports live."
        action={{ href: "/practice/reports", label: "Generate a report" }} />

      {!d ? <ModuleNote module={m} /> : (
        <>
          <StateNote status={d.status} reason={d.reason} />
          {d.status === "ok" && (
            d.defined.length === 0 ? (
              <p className="mt-3 text-[12px] text-gray-500">
                No report has been defined here yet. Reports are generated on demand from
                the <Link href="/practice/reports" className="underline">Reports</Link> workspace; defining
                one records an intention to run it again.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col">
                {d.defined.map(r => (
                  <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-gray-800">{r.name}</span>
                      <span className="block text-[10px] text-gray-500">{r.kind} · {r.cadence}{r.active ? "" : " · paused"}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-right text-[10px] text-gray-500">
                      {r.lastRunAt ? `last run ${String(r.lastRunAt).slice(0, 10)}` : "never run"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
          {/* ⚠ THE PANEL THE COMP CALLS "RECENT REPORTS" IS A LIST OF INTENTIONS, AND IT SAYS SO. */}
          <p className="mt-2 text-[10px] leading-relaxed text-amber-700">{d.limitation}</p>
          <Provenance formula={d.formula} />
          <ModuleNote module={m} />
        </>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3">
        <h3 className="text-[12px] font-bold text-gray-800">Exports</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Counts and denominators only; no rates and no benchmarks. An export is aggregate but{" "}
          <b>not anonymised</b> &mdash; a count of one identifies somebody to anybody who knows this practice.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[["/practice/reports", "Activity report"], ["/practice/reports/analytics", "Analytics"], ["/practice/documents", "Documents"]].map(([href, label]) => (
            <Link key={href} href={href}
              className="rounded-lg border border-sky-200 bg-sky-50/60 px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-50">
              {label} →
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── AI INSIGHT AND RECOMMENDATIONS (s7.3's panel) ────────────────────────────────────────────────────

export function AiInsightPanel({ suite }: { suite: Suite }) {
  const m = suite.workspace.modules.ai;
  const d = m.data;
  const figures = (d?.authorisedFigures ?? []).slice(0, 6);

  return (
    <section className={CARD}>
      <PanelHead panel="ai_insight" title="What the assistant may say about this practice"
        note="The exact set of figures it is allowed to cite, and the claims it is not."
        action={{ href: "/practice/intelligence?tab=assistant", label: "Ask" }} />
      <ComputedNotAi />

      {!d ? <ModuleNote module={m} /> : (
        <>
          {figures.length === 0 ? (
            <p className="mt-3 text-[12px] text-gray-500">
              No figure about this practice stands well enough to be quoted yet. The assistant is
              therefore not given any &mdash; a model handed a labelled blank writes the number itself.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col">
              {figures.map(f => (
                <li key={f.key} className="border-b border-gray-100 py-1.5 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] text-gray-700">{f.label}</span>
                    <span className="ml-auto text-[13px] font-bold tabular-nums text-sky-700">{f.value}</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-gray-500">{f.formula}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            {/* THE COMPS' AI CARD READS "78% of VP shunt patients had no complications" AND
                "your follow-up completion is 14% lower than average". Neither is implementable. */}
            The designs put sentences here like &ldquo;78% of shunt patients had no complications&rdquo;
            and &ldquo;your completion is 14% lower than average&rdquo;. There is no average: this product
            holds one practice per workspace and has never seen another. Whatever the assistant says, it
            is built only from the figures above and each one arrives carrying the calculation that
            produced it.
          </p>
          <ModuleNote module={m} />
        </>
      )}
    </section>
  );
}
