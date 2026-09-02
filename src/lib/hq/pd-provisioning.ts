/* eslint-disable @typescript-eslint/no-explicit-any */
import { CP_STANDARD_V1, CP_BASELINE_VERSION } from "@/lib/practice/baseline";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-PROV-001 §4 -- WHAT THE PROVISION-A-PRACTICE WIZARD IS ALLOWED TO OFFER.
//
// ⚠ EVERY OPTION HERE IS READ, NOT WRITTEN INTO THE COMPONENT. §3: "Plan codes and names must come from
// canonical commercial configuration. Do not hard-code commercial plans in the provisioning component."
// A wizard with `const PLANS = ["practice_trial", "practice_standard"]` in it is a second commercial
// catalogue that agrees with the first until somebody changes one.
//
// ⚠ AND THE DEFAULTS STEP DESCRIBES THE REAL SEEDER. §4 step 3 asks the wizard to "apply canonical CP
// default settings/provisioning template; show exceptions rather than requiring repetitive setup". The
// template is CP_STANDARD_V1 in src/lib/practice/baseline.ts and it already runs inside provisioning --
// so this module reads THAT object rather than restating what it contains. A hand-written list of "what
// gets set up" is a promise no code keeps.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type PlanOption = {
  planCode: string;
  name: string;
  /** The trial length the plan itself defines. Offered as the suggested duration, never imposed. */
  trialDays: number | null;
};

export type WizardOptions = {
  /** Active plans only. An inactive plan is one the product has withdrawn; offering it would be a trap. */
  plans: PlanOption[];
  /**
   * Whether the pilot-provisioning launch flag is on. The route refuses without it, and a wizard that
   * discovers this at the final step has wasted a Director's whole form.
   *
   * ⚠ NULL = COULD NOT BE READ, which is not the same as off. The screen says which.
   */
  pilotProvisioningOn: boolean | null;
  /** §4 step 3: what the canonical template will apply, named from the template itself. */
  baseline: { version: string; areas: BaselineArea[] };
  problems: string[];
};

export type BaselineArea = {
  key: string;
  value: string;
  /**
   * `materialised` = provisioning writes a record for it. `inherited` = NOTHING is written and the
   * enforcement point behaves this way on its own.
   *
   * ⚠ THE DISTINCTION IS THE POINT OF SHOWING THIS AT ALL. A Director reading "walk-ins: off" needs to
   * know whether a row now says off, or whether nothing was created and off is simply what happens --
   * because only the first is something the practice can see and change from its own settings.
   */
  enforcement: string;
  where: string;
};

export async function provisionWizardOptions(admin: any): Promise<WizardOptions> {
  const problems: string[] = [];

  const [planRes, flagRes] = await Promise.all([
    admin.from("practice_plans").select("plan_code, name, trial_days, active").eq("active", true).order("plan_code"),
    admin.from("practice_platform_flags").select("enabled").eq("flag", "practice_pilot_provisioning").maybeSingle(),
  ]);

  if (planRes.error) problems.push(`the plan catalogue could not be read: ${planRes.error.message}`);
  if (flagRes.error) problems.push(`the pilot-provisioning flag could not be read: ${flagRes.error.message}`);

  return {
    plans: ((planRes.data ?? []) as any[]).map(p => ({
      planCode: String(p.plan_code), name: String(p.name),
      trialDays: p.trial_days === null || p.trial_days === undefined ? null : Number(p.trial_days),
    })),
    pilotProvisioningOn: flagRes.error ? null : !!flagRes.data?.enabled,
    // ⚠ THE TEMPLATE IS PASSED THROUGH, NOT SUMMARISED. §4 step 3's list is CP_STANDARD_V1's own
    // `areas` matrix -- so when the baseline changes, this step changes with it and cannot describe a
    // setup the seeder no longer performs. It states what WILL be applied; whether each part succeeded
    // is reported after the run, because baseline seeding deliberately does not fail provisioning.
    baseline: {
      version: CP_BASELINE_VERSION,
      areas: CP_STANDARD_V1.areas.map(a => ({
        key: a.key, value: String(a.value), enforcement: a.enforcement, where: a.where,
      })),
    },
    problems,
  };
}
