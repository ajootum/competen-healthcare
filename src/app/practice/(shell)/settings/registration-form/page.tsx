import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listTemplates, CORE_FIELDS, FIELD_TYPES } from "@/lib/practice/registration-config";
import FormEditor from "./FormEditor";

// /practice/settings/registration-form -- CPR-PRM-001 s9's no-code editor.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s2 SAYS "CONFIGURATION REPLACES HARD-CODED FORMS". THIS IS THE PLACE THAT DOES IT -- and the one
// thing it will not let you configure away is the minimum dataset.
//
// The protected fields appear in the list, locked, with a sentence saying why. Hiding them from the
// editor would be the tempting design and the wrong one: an administrator who cannot see the date of
// birth assumes the form never asks for it, and then cannot explain why registrations are refused.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function RegistrationFormSettings() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");

  const canManage = hasCapability(shell.ctx, "practice.settings.manage");
  // LOADED HERE, NOT IN AN EFFECT. The list is server data and this is a server component; fetching it
  // again from the browser on mount would be a second round trip for something already in hand -- and
  // it is what forced the editor to setState inside an effect.
  const templates = canManage ? await listTemplates(createAdminClient(), shell.ctx) : [];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <Link href="/practice/settings" className="hover:text-[var(--cp-primary-deep)]">Settings</Link>
        <span>/</span><span className="text-gray-600">Registration form</span>
      </div>
      <h1 className="mt-0.5 text-xl font-bold text-gray-900">Registration form</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Decide what your practice asks when it registers somebody, and in what order.
      </p>

      <div className="mt-4">
        <FormEditor
          canManage={canManage}
          initialTemplates={templates}
          coreFields={CORE_FIELDS.map(f => ({ key: f.key, label: f.label, protected: f.protected }))}
          fieldTypes={[...FIELD_TYPES]}
        />
      </div>

      {/* THE TWO RULES NO FORM CAN CHANGE, said once, at the bottom, where somebody wondering will look. */}
      <section className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Two things a form cannot change</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          <li>
            <p className="text-[12px] font-semibold text-gray-700">The minimum a record needs</p>
            <p className="text-[10px] text-gray-500">
              A name, a date of birth or an estimated age, and one contact. A form that hid those would
              build a registration the system then refuses &mdash; and the person at the desk would get an
              error about a field their own form never showed them, which they cannot fix from where they
              are standing.
            </p>
          </li>
          <li>
            <p className="text-[12px] font-semibold text-gray-700">Whether a child needs a guardian</p>
            <p className="text-[10px] text-gray-500">
              That is decided by the date of birth, every time it is asked, and no form setting switches
              it off. It is also why nothing here stores &ldquo;is a minor&rdquo;: a child turns eighteen
              on a particular morning whether or not anybody opened this software that week.
            </p>
          </li>
        </ul>
      </section>
    </div>
  );
}
