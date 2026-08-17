import { requireHqCapability } from "@/lib/hq/context";
import PdNotBuilt from "../../_components/PdNotBuilt";

// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ hq.practice.operations.view is the only Practice HQ capability that exists and is enforced today.
// Build 2 replaces it with the per-module matrix. A capability no migration has created would lock
// this workspace shut for everybody, silently.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  return (
    <PdNotBuilt
      name="AI Health"
      spec="CPR-PD-008H"
      purpose="AI service availability, latency, failure, guardrail and fallback health where AI is enabled."
      willShow="AI request latency, failure and fallback behaviour per capability, alongside guardrail outcomes."
      absence="AI request latency IS recorded, which makes this the one Product Health submodule with a genuine producer. AI availability, guardrail outcomes and fallback rates are not recorded anywhere. A page mixing one measured signal with several invented ones would be worse than an empty one, so it waits for the rest."
    />
  );
}
