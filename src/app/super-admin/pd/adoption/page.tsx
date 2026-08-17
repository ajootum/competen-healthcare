import { requireHqCapability } from "@/lib/hq/context";
import PdNotBuilt from "../_components/PdNotBuilt";

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
      name="Adoption & Growth"
      spec="CPR-PD-006 §1–3"
      purpose="The action layer: approved interventions intended to change acquisition, onboarding, activation, retention, reactivation and advocacy."
      willShow="the growth journey from acquisition through active-at-thirty-days, the interventions running against each stage with their target cohort, objective, owner, channel, measurement window and outcome, and the drop-offs worth acting on."
      absence="Competen Practice emits no product telemetry today: there is no page-view, no feature-invocation and no session event anywhere in the schema. Every intervention in this module is required to carry a measured outcome, and there is nothing to measure one with. This module stays empty until an event stream exists to measure."
    />
  );
}
