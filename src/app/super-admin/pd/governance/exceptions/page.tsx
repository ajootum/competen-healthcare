import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §12 — EXCEPTIONS & RISK ACCEPTANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE THING THIS PAGE EXISTS TO PREVENT IS AN EXPIRED EXCEPTION THAT STILL READS AS LIVE. §12: they
// "cannot silently remain active". So there is no is_active flag anywhere — live is computed from the
// dates every time anybody looks, and an exception lapses by the passage of time rather than by
// somebody remembering to clear something.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const live = await admin.from("gov_exception_live")
    .select("exception_id, reference, kind, title, scope, status, approved_by, expires_on, is_live, is_expired, days_to_expiry")
    .limit(300);

  const rows = live.error ? null : (live.data as Record<string, unknown>[]);
  const all = rows ?? [];
  const inForce = all.filter(r => r.is_live === true);
  const expired = all.filter(r => r.is_expired === true);
  const acceptances = all.filter(r => r.kind === "risk_acceptance");

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Exceptions & Risk Acceptance"
        purpose="What has been permitted to depart from a control or an obligation, for how long, and on whose authority."
      />

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "In force now", v: inForce.length, note: "Approved, started, not past expiry." },
          { label: "Expired", v: expired.length, note: "Past their window. Cannot silently remain in force.", warn: true },
          { label: "Risk acceptances", v: acceptances.length, note: "Accepting a specific measured residual." },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{s.label}</p>
            <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
              s.warn && s.v > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
              {rows === null ? "—" : s.v}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{s.note}</p>
          </div>
        ))}
      </div>

      <Panel title="The exception register (§12)">
        <EmptyOrUnreadable
          rows={rows} what="exception or risk acceptance"
          meaning="A measured zero, and a genuinely good one to see — an empty exception register means nothing has been permitted to depart from a control. ⚠ Though with no controls registered and no risks scored, there is not yet much to depart from."
        />
        {all.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100">
            {all.map(e => (
              <li key={String(e.exception_id)} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                    <span className="font-mono text-[11px] text-gray-500">{String(e.reference)}</span> {String(e.title)}
                  </p>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    e.is_expired
                      ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                      : e.is_live ? "border-teal-300 bg-teal-50 text-teal-800" : "border-gray-300 bg-gray-50 text-gray-700"}`}>
                    {e.is_expired ? "expired" : e.is_live ? "in force" : String(e.status)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-gray-600">
                  {String(e.kind).replace(/_/g, " ")} · {String(e.scope)}
                  {e.approved_by ? ` · approved by ${String(e.approved_by)}` : " · not approved"}
                  {` · expires ${String(e.expires_on)}`}
                  {Number(e.days_to_expiry) >= 0 ? ` (${e.days_to_expiry} days)` : " (passed)"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Why the status column and the in-force column disagree on purpose">
        <p className="text-[12px] leading-relaxed text-gray-700">
          An expired exception keeps its status of <em>approved</em>, because it was approved — that is a
          historical fact about a decision somebody made. Whether it is in force is a question about
          today, and the two are different. Conflating them is what leaves a lapsed waiver reading as a
          live control until somebody happens to notice.
        </p>
        <Explain summary="Why there is no is_active flag to clear">
          A flag is set true on approval and stays true until a job nobody wrote runs. The failure is
          silent, permanent, and looks exactly like a working control — which is the state §12 exists to
          prevent. Deriving it from the dates means an exception lapses by the passage of time, and that
          is the only mechanism that works when the thing you are protecting against is inattention.
          <Cite>gov_exception has no is_active column; gov_exception_live computes is_live and is_expired from the dates</Cite>
        </Explain>
      </Panel>

      <Panel title="What §12 requires before one can be recorded">
        <Needs items={[
          { label: "A specific residual risk, for an acceptance", why: "§12: a risk acceptance records the specific residual being accepted, not a generic permission to ignore controls — so it points at one assessment, a score made on a date under a stated methodology, and not merely at the risk whose score moves underneath it." },
          { label: "Compensating controls", why: "As real links to real controls, so a compensating control is something that exists and is tested rather than a word typed into a field." },
          { label: "An approver who is not the requester", why: "§19's segregation of duties, enforced case-insensitively. And §12 adds that high or critical residual acceptance may require authority above the Product Director — which is already true of the capability grants." },
        ]} />
        <p className="mt-3 text-[12px] leading-relaxed text-gray-700">
          A matter needing authority above the Product Director escalates by corporate-impact trigger,
          recorded in{" "}
          <Link href="/super-admin/pd/governance/decisions" className="font-semibold text-teal-700 hover:underline">
            Decisions &amp; Approvals
          </Link>.
        </p>
      </Panel>
    </div>
  );
}
