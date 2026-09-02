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
  await requireHqCapability("hq.practice.commercial.view");
  return (
    <PdNotBuilt
      name="Plans & Pricing"
      spec="CPR-PD-007A"
      purpose="Plan catalogue, price books, currencies, billing intervals and effective-dated pricing."
      willShow="the Practice plan catalogue with its price book, currencies, billing intervals and effective-dated price changes."
      // ⚠ THIS REFUSAL WAS FALSE AND HAD BEEN FOR SOME TIME. It read: "practice_plans carries no price
      // and no currency; and UGX appears nowhere in the schema at all." Migration 349 gave the table
      // amount_minor, currency and interval_unit, and practice_solo_ugx has carried a real UGX price
      // ever since. A stale refusal UNDERSTATES the product -- the recorded lesson from CPR-HFE-REF-001
      // -- and this one told a Product Director that a price book was unrepresentable while a priced
      // plan sat in the table it named.
      //
      // What is genuinely absent is narrower and is what this now says: the effective-dated PRICE BOOK
      // (one price per plan, no history, no second currency), and any way to edit a plan from this
      // plane. Activating a plan is migration 369, a row update, because there is no writer here.
      absence="The plan catalogue is real: practice_plans carries plan_code, name, trial_days, active and, since migration 349, amount_minor, currency and interval_unit -- practice_solo_ugx is priced in UGX today. What does not exist is the PRICE BOOK this page is specified to show: there is one price per plan with no effective dating, no history of a change, and no second currency; and nothing on this plane can write to the table, so activating or repricing a plan is a migration. Plan-level commercial precedence is settled and enforced -- see ADR-015 -- it is the pricing MODEL that is unbuilt, not the plans."
    />
  );
}
