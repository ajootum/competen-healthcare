import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { GovHeader, Panel, EmptyOrUnreadable, StateList, Needs, Explain, Cite } from "../_components/gov-ui";

// CPR-PD-010 §10 — COMPLIANCE & OBLIGATIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE FIVE-STATE MODEL IS THIS PAGE'S CONTENT, EVEN WITH AN EMPTY REGISTER. §10 requires compliance
// state to distinguish Compliant, At Risk, Non-compliant, NOT ASSESSED and NOT APPLICABLE — and the
// last two are different kinds of absence. Not Assessed means nobody looked. Not Applicable means
// somebody looked and ruled this does not bind us here. Teaching that distinction is worth a screen
// whether or not the register has rows, because it is the thing a reader will otherwise get wrong.

export const dynamic = "force-dynamic";

const STATES = [
  { key: "compliant", label: "Compliant", note: "Assessed as met." },
  { key: "at_risk", label: "At Risk", note: "Assessed, and the gap is stated." },
  { key: "non_compliant", label: "Non-compliant", note: "Assessed, and the gap is stated." },
  { key: "not_applicable", label: "Not Applicable", note: "A JUDGEMENT — somebody examined this and ruled it does not bind us here, with a name and a reason." },
  { key: "not_assessed", label: "Not Assessed", note: "The ABSENCE of a judgement. Nobody has looked." },
] as const;

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();

  const [obligations, states] = await Promise.all([
    admin.from("gov_obligation").select("obligation_id, reference, title, source_kind, source_authority, owner_name, review_frequency, next_review_on, is_active").limit(300),
    admin.from("gov_obligation_state").select("obligation_id, reference, title, state, never_assessed, review_overdue").limit(300),
  ]);

  const rows = obligations.error ? null : (obligations.data as Record<string, unknown>[]);
  const stateRows = states.error ? [] : (states.data as Record<string, unknown>[]);
  const tally = STATES.map(s => ({
    key: s.key, label: s.label, note: s.note,
    n: stateRows.filter(r => String(r.state) === s.key).length,
  }));

  return (
    <div className="flex flex-col gap-4">
      <GovHeader
        title="Compliance & Obligations"
        purpose="What binds Competen Practice, who owns each obligation, and whether it is met — per market."
      />

      <Panel title="The obligation register (§10)">
        <EmptyOrUnreadable
          rows={rows} what="obligation"
          meaning="A measured zero. ⚠ It does not mean nothing binds this product — it means nobody has written down what does. §10 asks for source, applicability, owner, evidence links, review frequency and a compliance state per obligation, and an empty register is the absence of that work rather than a clean bill."
        />
        {rows && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-gray-100">
            {rows.map(o => {
              const st = stateRows.find(s => s.obligation_id === o.obligation_id);
              return (
                <li key={String(o.obligation_id)} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-[12.5px] font-semibold text-gray-900">
                    <span className="font-mono text-[11px] text-gray-500">{String(o.reference)}</span> {String(o.title)}
                  </p>
                  <p className="mt-1 text-[11.5px] text-gray-600">
                    {String(o.source_authority ?? o.source_kind)}
                    {o.owner_name ? ` · ${String(o.owner_name)}` : " · no owner"}
                    {" · "}{st ? String(st.state).replace(/_/g, " ") : "not assessed"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="The five states §10 requires"
        note="Two of them are different kinds of absence, and a register that merged them would be wrong in the direction that reassures."
      >
        <StateList items={tally} total={Math.max(1, stateRows.length)} />
        <ul className="mt-3 flex flex-col gap-1">
          {STATES.map(s => (
            <li key={s.key} className="text-[11.5px] leading-relaxed text-gray-600">
              <span className="font-semibold text-gray-800">{s.label}</span> — {s.note}
            </li>
          ))}
        </ul>
        <Explain summary="Why Not Assessed and Not Applicable are the pair that matters">
          They are epistemic opposites. One says nobody has looked; the other says somebody looked
          carefully and concluded this obligation does not bind us here. A single column would put them
          one keystroke apart, and a column DEFAULTING to not-assessed is indistinguishable from an
          assessment that concluded nothing — which is how an unexamined obligation comes to look
          reviewed. So state is derived: no assessment resolves to Not Assessed, and Not Applicable is
          storable only as an explicit judgement carrying a rationale.
          <Cite>gov_obligation has no compliance_state column; gov_obligation_state derives it from the newest assessment</Cite>
        </Explain>
      </Panel>

      <Panel
        title="Why nothing is seeded here"
        note="Unlike the trigger catalogue and the risk categories, which are the specification's own vocabulary."
      >
        <p className="text-[12px] leading-relaxed text-gray-700">
          §10 forbids hard-coding one jurisdiction: applicability must be market and product scoped.
          Seeding a plausible obligation register would do exactly that — whichever regulations were
          chosen would silently become the ones this product believes bind it, in every market, for as
          long as nobody checked. An obligation binding in one market and irrelevant in another is the
          ordinary case, which is why assessments are made against a canonical subject and the same
          obligation can be Compliant for the product and Not Applicable for a market without either
          overwriting the other.
        </p>
      </Panel>

      <Panel title="What §10 asks for that no query can produce">
        <Needs items={[
          { label: "The obligations themselves", why: "Which laws, regulations, contracts, standards and internal policies bind Competen Practice, per market. A legal and commercial determination, not a fact about the code." },
          { label: "Applicability per market", why: "The same obligation binds in one jurisdiction and not another. §10 requires the assessment to be scoped, and each scoping is a judgement somebody makes and signs." },
          { label: "Evidence and control links", why: "§10 wants each obligation tied to the controls that satisfy it and the evidence that proves they do. Both stores exist and both are empty." },
        ]} />
      </Panel>
    </div>
  );
}
