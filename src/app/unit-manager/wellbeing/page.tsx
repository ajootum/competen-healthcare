import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadWellbeing } from "@/lib/workforce/wellbeing";
import { cardClass, Section, Badge, Alert, Progress, NotProvisioned, TableWrap, Th, type BadgeTone } from "@/components/ui/primitives";
import { KpiRibbon, BarChart, StackedBar, ChartCard } from "@/components/ui/charts";
import { estateRolesOf } from "@/lib/roles";

// Workforce Wellbeing & Fatigue Management (UMW-WFM-003) — migration 162.
//
// THE PRIVACY RULE IS NOT IMPLEMENTED ON THIS PAGE. It is enforced in the loader, which drops the identity
// of any check-in marked `private` before returning. This page cannot show who they belong to because it
// never receives it. What it CAN show — and does — is that those check-ins exist and count, so a manager
// sees real participation without seeing individuals.
//
// Fatigue is COMPUTED from rostered shifts (shared engine, same numbers the Shift Supervisor sees).
// Everything else is RECORDED, and each recorded source states its row count so an empty store reads as
// "nothing recorded yet" rather than as a healthy zero.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ALLOWED = ["hospital_admin", "super_admin"];
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const BAND_TONE: Record<string, BadgeTone> = { none: "success", watch: "warning", high: "critical" };
const RISK_TONE: Record<string, BadgeTone> = { low: "success", moderate: "warning", high: "error", severe: "critical" };
const URGENCY_TONE: Record<string, BadgeTone> = { routine: "neutral", soon: "info", urgent: "warning", immediate: "critical" };

export default async function WellbeingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");

  const d: any = await loadWellbeing(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const head = (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Workforce Wellbeing &amp; Fatigue</h1>
      <p className="text-sm text-gray-500 mt-0.5">
        Fatigue exposure, rest and overtime, and the wellbeing record for this unit — {d.window.days} days to {d.window.to}.
      </p>
    </div>
  );

  if (!d.provisioned) {
    return <div className="space-y-4 max-w-[1500px]">{head}<NotProvisioned what="The wellbeing stores" migration="162-workforce-wellbeing.sql" /></div>;
  }

  const k = d.kpis;

  return (
    <div className="space-y-4 max-w-[1500px]">
      {head}

      <KpiRibbon
        kpis={[
          { label: "Fatigue index", value: k.fatigueIndex == null ? "—" : `${k.fatigueIndex}%`,
            tone: k.fatigueIndex != null && k.fatigueIndex >= 40 ? "critical" : k.fatigueIndex != null && k.fatigueIndex >= 20 ? "warning" : "default",
            sub: k.rostered ? `${k.fatigueFlagged} of ${k.rostered} rostered flagged` : "nobody rostered in the window" },
          { label: "High fatigue", value: k.fatigueHigh, tone: k.fatigueHigh ? "critical" : "default", sub: "two or more flags, or short rest" },
          { label: "Avg hours / shift", value: k.avgOvertimeHours ?? "—", sub: k.avgOvertimeHours == null ? "no confirmed actuals" : `${d.overtime.withHours} shifts with times` },
          { label: "Missed breaks", value: k.missedBreaks ?? "—", tone: k.missedBreaks ? "warning" : "default", sub: k.missedBreaks == null ? "no breaks recorded" : `${d.breakCompliance.rate}% compliance` },
          { label: "Sick days", value: k.sickDays ?? "—", sub: k.sickDays == null ? "no leave recorded" : `${d.sickLeave.staffAffected} staff affected` },
          { label: "Wellbeing score", value: k.wellbeingScore == null ? "—" : `${k.wellbeingScore}%`,
            tone: k.wellbeingScore != null && k.wellbeingScore < 50 ? "warning" : "default",
            sub: k.wellbeingScore == null ? "no check-ins yet" : `${d.checkIns.participants} participants` },
          { label: "Open referrals", value: k.openReferrals ?? "—", tone: d.referrals.urgent ? "critical" : "default",
            sub: k.openReferrals == null ? "none recorded" : `${d.referrals.urgent} urgent` },
        ]}
        note={`Fatigue thresholds: ${d.thresholds.consecutiveDays}+ consecutive days, ${d.thresholds.weekHours}h+, under ${d.thresholds.restHours}h rest, ${d.thresholds.nightRun}+ nights. ${d.thresholdsConfigured ? "Configured for this unit." : "Platform defaults — configurable per tenant and unit."}`}
      />

      {d.signals.length > 0 && (
        <div className="space-y-2">
          {d.signals.map((s: any, i: number) => (
            <Alert key={i} tone={s.severity === "high" ? "critical" : "warning"}>{s.text}</Alert>
          ))}
        </div>
      )}

      {/* ── Fatigue exposure ── */}
      <Section title="Fatigue Exposure" sub={`${d.window.days}-day window`}
        note="Computed from ROSTERED shifts — the same engine and thresholds the Shift Supervisor sees, so the two never disagree. This is exposure, not a clinical judgement about any individual.">
        {d.fatigue.length === 0 ? (
          <p className="text-sm text-gray-500">No staff were rostered in this window, so there is no exposure to measure.</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100">
                <Th>Staff</Th><Th>Band</Th><Th align="right">Shifts</Th><Th align="right">Consecutive</Th>
                <Th align="right">Nights</Th><Th align="right">Hours</Th><Th align="right">Shortest rest</Th><Th>Flags</Th>
              </tr></thead>
              <tbody>
                {d.fatigue.slice(0, 25).map((f: any) => (
                  <tr key={f.staffId} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-900 font-medium">{f.name}</td>
                    <td className="py-2"><Badge tone={BAND_TONE[f.band]}>{f.band === "none" ? "Within thresholds" : titleCase(f.band)}</Badge></td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{f.shifts}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{f.consecutive}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{f.nights}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">
                      {f.hours == null ? <span className="text-gray-400">not recorded</span> : <>{f.hours}h{f.hoursPartial && <span className="text-[var(--cmp-text-warning)]" title="Some shifts have no start/end time recorded">*</span>}</>}
                    </td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{f.rest == null ? "—" : `${f.rest}h`}</td>
                    <td className="py-2 text-[11px] text-gray-500">{f.flags.join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {d.fatigue.some((f: any) => f.hoursPartial) && (
          <p className="text-[10px] text-gray-400 mt-2">* Some shifts have no start/end time recorded, so the hours total is partial. Those shifts still count toward consecutive days.</p>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Wellbeing check-ins ── */}
        <Section title="Wellbeing Check-ins" sub={`${d.checkIns.recorded} recorded`}
          note="Self-reported, 1 (worst) to 5 (best). Check-ins marked private count toward these figures but are never attributed — the loader drops their identity before this page sees them.">
          {d.checkIns.recorded === 0 ? (
            <p className="text-sm text-gray-500">No check-ins recorded yet. This is an absence of data, not a wellbeing score of zero.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-3">
                <p className="text-2xl font-bold tabular-nums text-gray-900">{d.checkIns.score}%</p>
                <span className="text-xs text-gray-500">overall · {d.checkIns.participants} participants</span>
                {d.checkIns.privateCount > 0 && <Badge tone="neutral">{d.checkIns.privateCount} private</Badge>}
              </div>
              <div className="space-y-1.5">
                {d.checkIns.byDimension.map((x: any) => (
                  <Progress key={x.dimension} label={titleCase(x.dimension)} value={x.value == null ? null : Math.round(((x.value - 1) / 4) * 100)}
                    tone={x.value != null && x.value <= 2.5 ? "warning" : "primary"} />
                ))}
              </div>
              {d.checkIns.lowDimension[0]?.lowCount > 0 && (
                <p className="text-[11px] text-gray-500 mt-3">
                  Most frequently scored low: <span className="font-medium">{titleCase(d.checkIns.lowDimension[0].dimension)}</span> ({d.checkIns.lowDimension[0].lowCount} check-ins at 2 or below).
                </p>
              )}
              {d.checkIns.shared.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Shared with you ({d.checkIns.shared.length})</p>
                  <ul className="space-y-1.5">
                    {d.checkIns.shared.slice(0, 6).map((c: any) => (
                      <li key={c.id} className="text-[11px]">
                        <span className="text-gray-900 font-medium">{c.name}</span>
                        <span className="text-gray-400"> · {c.date}</span>
                        {c.lowest && <span className="text-gray-500"> · lowest: {titleCase(c.lowest.d)} {c.lowest.v}/5</span>}
                        {c.comment && <p className="text-gray-600">{c.comment}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Section>

        {/* ── Burnout risk ── */}
        <Section title="Burnout Risk" sub={`${d.burnout.recorded} assessments`}
          note="Structured assessments only. The instrument is recorded with each score so results are never compared across incompatible scales.">
          {d.burnout.recorded === 0 ? (
            <p className="text-sm text-gray-500">No burnout assessments recorded. A distribution cannot be shown, and no risk is implied by the absence.</p>
          ) : (
            <>
              <StackedBar label="Burnout risk distribution"
                segments={d.burnout.distribution.filter((b: any) => b.n > 0).map((b: any) => ({
                  name: titleCase(b.band), value: b.n,
                  color: b.band === "severe" ? "var(--cmp-color-critical)" : b.band === "high" ? "var(--cmp-color-error)"
                    : b.band === "moderate" ? "var(--cmp-color-warning)" : "var(--cmp-color-success)",
                }))} />
              <p className="text-[11px] text-gray-500 mt-2">{d.burnout.assessed} staff assessed · {d.burnout.followUp} flagged for follow-up</p>
              {d.burnout.atRisk.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {d.burnout.atRisk.slice(0, 6).map((b: any) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-gray-900">{b.name}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-gray-400">{b.instrument.toUpperCase()}{b.score != null ? ` · ${b.score}` : ""}</span>
                        <Badge tone={RISK_TONE[b.band]}>{titleCase(b.band)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── Rest, overtime, breaks ── */}
        <ChartCard title="Sick Leave" sub={`${d.window.days} days`} source="op_leave_records">
          {d.sickLeave.recorded === 0
            ? <p className="text-sm text-gray-500">No leave records in this window.</p>
            : <BarChart label="Sick days by week" points={d.sickLeave.byWeek} />}
        </ChartCard>

        <Section title="Break Compliance" sub={`${d.breakCompliance.recorded} recorded`}>
          {d.breakCompliance.recorded === 0 ? (
            <p className="text-sm text-gray-500">No breaks recorded in this window, so compliance cannot be measured.</p>
          ) : (
            <>
              <Progress label="Break compliance" value={d.breakCompliance.rate}
                tone={d.breakCompliance.rate >= 90 ? "success" : d.breakCompliance.rate >= 70 ? "warning" : "critical"} />
              <p className="text-[11px] text-gray-500 mt-2">
                {d.breakCompliance.completed} completed · {d.breakCompliance.overdue} overdue · {d.breakCompliance.missed} missed
              </p>
            </>
          )}
        </Section>

        <Section title="Recorded Hours" sub={`${d.overtime.recorded} confirmed shifts`}
          note="From confirmed roster actuals — trails the live roster, and only shifts a manager has confirmed appear.">
          {d.overtime.recorded === 0 ? (
            <p className="text-sm text-gray-500">No confirmed roster actuals in this window.</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-gray-700">Total <span className="font-semibold tabular-nums">{d.overtime.totalHours ?? "—"}h</span> across {d.overtime.withHours} shifts with recorded times</p>
              <p className="text-gray-700">Average <span className="font-semibold tabular-nums">{d.overtime.avgHours ?? "—"}h</span> per shift</p>
              <p className="text-gray-700">Overtime extensions <span className="font-semibold tabular-nums">{d.overtime.overtimeShifts}</span></p>
            </div>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Occupational health referrals ── */}
        <Section title="Occupational Health Referrals" sub={`${d.referrals.recorded} recorded`}>
          {d.referrals.open.length === 0 ? (
            <p className="text-sm text-gray-500">{d.referrals.recorded === 0 ? "No referrals recorded." : "No open referrals."}</p>
          ) : (
            <ul className="space-y-2">
              {d.referrals.open.slice(0, 8).map((r: any) => (
                <li key={r.id} className="flex items-start justify-between gap-2 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">
                      {r.profiles?.full_name ?? "Staff"}
                      {r.self_referred && <span className="ml-1.5 text-[10px] text-teal-700">self-referred</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">{titleCase(r.category)} · {r.reason}</p>
                    <p className="text-[10px] text-gray-400">{titleCase(r.status)} · {new Date(r.referred_at).toLocaleDateString()}</p>
                  </div>
                  <Badge tone={URGENCY_TONE[r.urgency] ?? "neutral"}>{titleCase(r.urgency)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {d.referrals.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {d.referrals.byCategory.map((c: any) => <Badge key={c.category} tone="neutral">{titleCase(c.category)} · {c.n}</Badge>)}
            </div>
          )}
        </Section>

        {/* ── Wellbeing action plans ── */}
        <Section title="Wellbeing Action Plans" sub={`${d.plans.recorded} recorded`}>
          {d.plans.open.length === 0 ? (
            <p className="text-sm text-gray-500">{d.plans.recorded === 0 ? "No wellbeing plans recorded." : "No open plans."}</p>
          ) : (
            <ul className="space-y-2">
              {d.plans.open.slice(0, 8).map((p: any) => (
                <li key={p.id} className="flex items-start justify-between gap-2 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">{p.goal}</p>
                    <p className="text-[11px] text-gray-500">
                      {p.scope === "individual" ? (p.name ?? "Staff") : titleCase(p.scope)} · triggered by {titleCase(p.trigger)}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {titleCase(p.status)}{p.owner_name ? ` · ${p.owner_name}` : ""}{p.review_date ? ` · review ${p.review_date}` : " · no review date"}
                    </p>
                  </div>
                  {p.overdue && <Badge tone="critical" icon="▲">Review overdue</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">How these figures are produced</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li><span className="font-medium text-gray-700">Fatigue is computed</span> from rostered shifts by the shared engine, against thresholds configurable per tenant and unit. A shift with no recorded start/end counts toward consecutive days but not toward hours, and is marked.</li>
          <li><span className="font-medium text-gray-700">Everything else is recorded.</span> Overtime, breaks, sick leave, check-ins, assessments, referrals and plans all show their row count — an empty store reads as &quot;nothing recorded yet&quot;, never as a healthy zero.</li>
          <li><span className="font-medium text-gray-700">Private check-ins stay private.</span> They count toward the score and the distributions; their identity is dropped before this page receives them, so it cannot show who they belong to.</li>
          <li><span className="font-medium text-gray-700">Not modelled:</span> AI burnout prediction and automated workload redistribution. Both need an outcome history to learn from, and inventing one would produce confident guesses about people&apos;s health.</li>
        </ul>
      </div>
    </div>
  );
}
