import { requireHqCapability } from "@/lib/hq/context";
import PdNotBuilt from "../_components/PdNotBuilt";

// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT. PD-001 s7: "A hidden navigation item does not
// constitute authorization. Every destination must enforce server-side authorization", and "direct URL
// access to an unauthorized item must fail safely". Next's own authentication guide says a layout check
// is not sufficient because layouts do not re-render on navigation, so each page repeats it. The await
// completes before any JSX is returned: nothing renders ahead of the decision.
//
// ⚠ CAPABILITY: hq.practice.operations.view is the ONLY Practice HQ capability that exists and is
// enforced today. Build 2 replaces it with the per-module matrix PD-001 s7 describes. Inventing a code
// no migration has created would lock the workspace shut for everyone, silently.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  return (
    <PdNotBuilt
      name="Practices"
      spec="CPR-PD-003 §1"
      purpose="The authoritative landlord-side view of every Competen Practice workspace in scope, and the drill-through into Practice 360."
      willShow="the canonical Practice estate — each workspace with its owner, market, plan, lifecycle state, practitioner count and activity — and open a per-Practice 360 covering operations, adoption, commercial state, configuration, support and security, without becoming a clinical-record viewer or a silent route into the practitioner's tenant."
    />
  );
}
