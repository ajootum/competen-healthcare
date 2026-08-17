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
  await requireHqCapability("hq.practice.health.view");
  return (
    <PdNotBuilt
      name="Data & Sync Health"
      spec="CPR-PD-008E"
      purpose="Persistence, synchronisation, queues, delayed writes and data-pipeline health."
      willShow="queue depth, delayed writes, pipeline health and the age of unsynced offline transactions."
      absence="Sync-transaction age is one of the few genuinely recorded signals here, held by the Practice offline ledger, and job-run durations are real too. Queue depth, delayed writes and data-pipeline health have no instrumentation at all. The module stays empty rather than showing two real figures surrounded by invented ones."
    />
  );
}
