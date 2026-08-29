import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { channelSettings } from "@/lib/practice/messaging";
import CommunicationsConsole from "./CommunicationsConsole";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Patient Communications" };

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-EMAIL-001 s10 -- PATIENT COMMUNICATIONS. The practitioner's words, not "notifications
// configuration": how what you send reaches patients, and the one switch the pilot needs.
//
// Email is the pilot's only channel. Text messages and WhatsApp are a single quiet sentence -- never a
// warning, never a dead control (s1). Provider diagnostics stay out of ordinary setup.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PatientCommunicationsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "practice.settings.manage") && !hasCapability(ctx, "practice.calendar.view"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const channels = await channelSettings(admin, ctx.workspaceId);
  const email = channels.find(c => c.kind === "email")!;

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        <div className="min-w-0">
          <nav className="flex items-baseline gap-1.5 text-[12px]">
            <Link href="/practice/setup" className="font-semibold text-[var(--cp-primary)] hover:underline">
              Practice Setup
            </Link>
            <span className="text-gray-300">›</span>
            <span className="text-gray-500">Patient Communications</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">Patient Communications</h1>
          <p className="text-[13px] text-gray-500">
            How booking codes and confirmations reach your patients.
          </p>
        </div>

        <CommunicationsConsole
          email={{
            enabled: email.enabled, senderName: email.senderName,
            providerConfigured: email.providerConfigured, enabledAt: email.enabledAt,
          }}
          mayManage={hasCapability(ctx, "practice.settings.manage")}
        />

        {/* s1: deferred channels are one quiet sentence -- no warning, no control. */}
        <p className="text-[11.5px] text-gray-500">
          Text messages and WhatsApp: coming later.
        </p>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">What email being on changes</h2>
          <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-gray-600">
            <li>· A patient booking online receives a one-time code to their email and enters it to verify.</li>
            <li>· Booking confirmations and cancellation notices send by email, where the patient agreed to be contacted.</li>
            <li>· Your public booking page becomes bookable automatically once this and its other checks pass — there is no separate switch.</li>
          </ul>
          <Link href="/practice/setup/patient-booking?tab=publish"
            className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
            Review booking readiness →
          </Link>
        </section>
      </div>
    </div>
  );
}
