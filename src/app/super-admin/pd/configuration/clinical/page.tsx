import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor, SAFETY_LABEL } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §8 — CLINICAL CONFIGURATION.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE MOST SAFETY-SENSITIVE PAGE IN THE MODULE, AND THE HONEST POSITION IS THAT IT MUST NOT EDIT.
//
// §8 governs medication and dose safety thresholds, decision-support parameters, and lists a clinician
// picks from mid-consultation. Two facts decide what this page may be:
//
//   ONE. The vocabulary for classifying such a setting already exists and is right. Migration 092
//   constrains safety_classification to nine values including clinical_safety_critical and
//   regulatory_critical, and CLASS_LABEL/SAFETY_LABEL already render them. That is §4's Sensitivity
//   attribute implemented, not planned.
//
//   TWO. No clinical setting is a registry object, so not one of them CARRIES a classification, and no
//   approval class exists on any definition at all. §8 requires clinical-safety-sensitive configuration
//   to have explicit safety classification AND approval rules. Half of that exists as a column and none
//   of it exists as data.
//
// A screen that offered to edit a dose threshold under those conditions would be offering an unclassified,
// unapproved, unversioned write to a clinical safety parameter. So this page states where those values
// live, who governs them, and what would have to exist first.

export const dynamic = "force-dynamic";

const D = domain("clinical")!;

const CRITICAL = [
  "clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical",
];

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Clinical Configuration"
        purpose="Governed clinical lists, parameters and safety-sensitive defaults — where they live, who may change them, and why nothing here writes one."
        spec="CPR-PD-011 §8"
      />

      <Warn title="This page does not edit a clinical parameter, and the reason is not caution">
        <p>
          §8 requires clinical-safety-sensitive configuration to carry an explicit safety classification
          and approval rules, and requires medication and dose thresholds to be versioned and traceable.
          The classification VOCABULARY exists (migration 092 constrains it to nine values). No clinical
          setting is a configuration definition, so not one of them carries a classification; no
          definition anywhere carries an approval class; and there is no approval record to write a
          decision into.{" "}
          <span className="font-semibold">
            Editing a dose threshold here would be an unclassified, unapproved, unversioned write to a
            clinical safety parameter.
          </span>
        </p>
      </Warn>

      <Panel title="The safety vocabulary that already exists (§4 Sensitivity)"
        note="configuration_registry_objects.safety_classification, migration 092:24. Nine values, constrained by the database — the four marked critical are the ones §8's approval rules would attach to.">
        <ul className="grid gap-1.5 text-[12px] sm:grid-cols-2">
          {Object.entries(SAFETY_LABEL).map(([key, label]) => (
            <li key={key} className="flex items-baseline gap-2">
              <span aria-hidden className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${CRITICAL.includes(key) ? "bg-[var(--cmp-text-critical)]" : "bg-gray-300"}`} />
              <span className={CRITICAL.includes(key) ? "font-semibold text-gray-900" : "text-gray-600"}>
                {label}
                {CRITICAL.includes(key) && <span className="ml-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">critical</span>}
              </span>
            </li>
          ))}
        </ul>
        <Explain summary="What is missing beside it">
          §4 also requires an approval class on every definition — no approval, maker-checker, specialist
          approval or higher governance approval. There is no such column and no approval record, so a
          clinical-safety-critical classification could be applied today and would grant nothing: nothing
          would consult it before a change, because nothing consults a classification at all.
        </Explain>
      </Panel>

      <Panel title="The two rules §8 makes that this build must never break"
        note="Both are about history, and both are already respected by the Practice product's own writers.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">A change must not rewrite a signed historical encounter.</span>{" "}
            A signed encounter is a clinical record, and a configuration change that reached backwards
            into one would change what a clinician is recorded as having decided. The encounter status
            history (practice_encounter_status_history) is the trail that would show it. Nothing on this
            page writes anything, so nothing here can reach a historical record — but the rule is
            recorded because it constrains whatever writes one day.
          </li>
          <li>
            <span className="font-semibold text-gray-900">External terminology keeps its source and version.</span>{" "}
            §8 requires it. The investigation and medication catalogues carry their own rows; whether a
            source and version travel with them is a property of those tables, on the Practice plane,
            which this page cannot inspect.
          </li>
          <li>
            <span className="font-semibold text-gray-900">A safety invariant is not overridable by a Practice or a practitioner.</span>{" "}
            The registry has the column that would express this —{" "}
            <span className="font-mono text-[11px]">override_policy = &apos;none&apos;</span> — and no
            clinical setting is registered to carry it.
          </li>
        </ul>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23 and §24: clinical-safety governance, risk acceptance and specialist approval are Governance
        &amp; Risk&apos;s. Whether a clinical capability is deployed at all is Releases &amp;
        Capabilities&apos;. Clinical quality outcomes are not this workspace&apos;s at all.
      </NotThisModule>

      <NoReadNote why="Every clinical configuration store is on the Practice plane and refused to it." />
    </div>
  );
}
