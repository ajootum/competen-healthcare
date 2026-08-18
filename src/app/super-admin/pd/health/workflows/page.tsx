import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, HEALTH_REFUSALS } from "@/lib/hq/pd-health";
import { HealthHeader, Panel, AbsentList, StateChip, Explain, ReadFailures } from "../_components/health-ui";

// CPR-PD-008D — WORKFLOW HEALTH.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THE NINE JOURNEYS ARE NAMED HERE EVEN THOUGH NONE IS MEASURED, and that is the point of the page.
// PD-008 s1 lists them by name; a build starts from that list. Rendering it with every row honestly
// unmeasured is more useful than rendering nothing, because it says exactly what instrumenting this
// module would have to cover — and it cannot be mistaken for a green dashboard.

export const dynamic = "force-dynamic";

/** PD-008 §1's critical practitioner journeys, in the order the specification lists them. */
const JOURNEYS = [
  { name: "Sign-in", what: "A practitioner reaches an authenticated session." },
  { name: "Practice open", what: "The workspace loads with its configuration resolved." },
  { name: "Planner", what: "The day's schedule renders with its appointments." },
  { name: "Booking", what: "An appointment is created and accepted by the rules engine." },
  { name: "Encounter save", what: "Clinical content is persisted mid-encounter." },
  { name: "Encounter sign", what: "An encounter is completed and locked." },
  { name: "Follow-up", what: "A follow-up is raised and lands in the queue that owns it." },
  { name: "Document generation", what: "A document renders and is issued to the patient record." },
  { name: "Invoice issue", what: "A charge becomes an issued invoice with a number." },
] as const;

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Workflow Health"
        spec="CPR-PD-008D"
        purpose="Synthetic and observed end-to-end practitioner journey health."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          Nine critical journeys, none of them observed.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          Journey health needs either a synthetic runner walking each path on a schedule, or step-level
          timing on the real paths. Neither exists: there is no synthetic runner in this product and no
          Practice route records how long a step took or whether it completed. The journeys below are the
          ones the specification names, listed so that the scope of the gap is legible.
        </p>
      </div>

      <ReadFailures problems={h.problems} />

      <Panel title="The nine journeys" note="From CPR-PD-008 §1. Every row is unmeasured, and says so.">
        <ul className="flex flex-col divide-y divide-gray-100">
          {JOURNEYS.map(j => (
            <li key={j.name} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-gray-900">{j.name}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-gray-600">{j.what}</span>
              </span>
              <StateChip state="absent" />
            </li>
          ))}
        </ul>
        <Explain summary="Why a proxy for these would be worse than leaving them empty">
          Several of these journeys leave a trace behind — an appointment row, a signed encounter, an
          issued invoice. It is tempting to count those rows and call it journey health. It is not: a
          created appointment proves one succeeded, and says nothing about how many were attempted, how
          long any took, or whether the ones that failed failed silently. A success count with no attempt
          count reads as a health figure and behaves like a volume figure, and it would be highest on the
          busiest day of an outage.
        </Explain>
      </Panel>

      <Panel title="What this page needs">
        <AbsentList items={[
          HEALTH_REFUSALS.journeys(),
          HEALTH_REFUSALS.requestLatency(),
          HEALTH_REFUSALS.errorRate(),
          HEALTH_REFUSALS.degradations(),
        ]} />
      </Panel>
    </div>
  );
}
