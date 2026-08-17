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
  await requireHqCapability("hq.practice.intelligence.view");
  return (
    <PdNotBuilt
      name="Product Intelligence"
      spec="CPR-PD-005 §2–3"
      purpose="The executive product-intelligence summary: how Competen Practice is actually used, and what changed."
      willShow="the product pulse across Practices and practitioners, materially significant period-over-period changes, the activation funnel, retention against a stated cohort definition, feature-adoption ranking and market highlights, each carrying its filters through to the deeper views."
      absence="Competen Practice emits no product telemetry today: there is no page-view, no feature-invocation and no session event anywhere in the schema. Adoption, DAU/WAU, retention curves, feature penetration and funnel conversion are therefore not unbuilt queries over an empty table — they have no substrate at all. This module stays empty until an event stream exists to measure."
    />
  );
}
