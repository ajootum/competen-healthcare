import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { channelSettings, emailChannelState } from "@/lib/practice/messaging";
import { bookingLinkSummary } from "@/lib/practice/identity-service";
import CommunicationsConsole from "./CommunicationsConsole";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Patient Communications" };

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SET-COMMS-001 -- PATIENT COMMUNICATIONS. The practitioner's words, not "notifications
// configuration": how what you send reaches patients, under whose name, and which messages send.
//
// Email is the pilot's only channel. SMS and WhatsApp are visible as coming-soon cards with no dead
// control (s3.3). Provider infrastructure never appears here (s1) -- the derived channel state is the
// only fact about service health a practitioner sees, and it arrives without a provider name on it.
//
// s4: the readiness summary below is a MIRROR of canonical sources (emailChannelState over the same
// channelSettings the send path reads, and bookingLinkSummary -- the resolver's own live test). It
// duplicates no readiness engine, and its CTA routes to the canonical readiness workspace.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

function ReadinessRow({ label, tone, verdict, detail }: {
  label: string; tone: "ok" | "warn" | "bad" | "unknown"; verdict: string; detail: string;
}) {
  const dot = {
    ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", unknown: "bg-slate-300",
  }[tone];
  const text = {
    ok: "text-emerald-800", warn: "text-amber-800", bad: "text-rose-800", unknown: "text-slate-500",
  }[tone];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-gray-800">
          <span className="font-semibold">{label}:</span>{" "}
          <span className={`font-bold ${text}`}>{verdict}</span>
        </p>
        <p className="text-[10.5px] leading-relaxed text-gray-500">{detail}</p>
      </div>
    </li>
  );
}

export default async function PatientCommunicationsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "practice.settings.manage") && !hasCapability(ctx, "practice.calendar.view"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const [channels, bookingLink] = await Promise.all([
    channelSettings(admin, ctx.workspaceId),
    bookingLinkSummary(admin, ctx.userId),
  ]);
  const email = channels.find(c => c.kind === "email")!;
  const state = emailChannelState(email);

  // s4's three lines, each read from its canonical source. The one precise next action a missing
  // communications prerequisite gets is stated here, not left for the practitioner to infer.
  const emailRow = state === "ACTIVE"
    ? { tone: "ok" as const, verdict: "Ready", detail: "Patients receive a one-time code at the email address they provide before completing their booking." }
    : state === "ACTION_NEEDED"
      ? { tone: "bad" as const, verdict: "Action needed", detail: "Email messages cannot be sent right now. This is a service matter on our side — your settings are kept." }
      : {
        tone: "warn" as const, verdict: "Needs setup",
        detail: email.senderName?.trim()
          ? "Save your email settings to enable patient verification."
          : "Set your email sender name to enable patient verification.",
      };
  const commsRow = state === "ACTIVE"
    ? { tone: "ok" as const, verdict: "Ready", detail: "Booking confirmations and notices send by email, as configured above." }
    : { tone: "warn" as const, verdict: "Needs setup", detail: "No appointment communication can send until email is set up." };
  const publicRow = bookingLink.state === "live"
    ? { tone: "ok" as const, verdict: "Available", detail: "Patients can open your booking page and book online." }
    : bookingLink.state === "unreadable"
      ? { tone: "unknown" as const, verdict: "Could not be read", detail: "Whether patients can book could not be read just now." }
      : { tone: "warn" as const, verdict: "Not yet available", detail: "Your booking page has checks left before patients can book online." };

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
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
              Choose how your practice communicates with patients about appointments and online booking.
            </p>
          </div>
          <Link href="/practice/setup/patient-booking?tab=publish"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--cp-primary)] hover:bg-gray-50">
            Review booking readiness →
          </Link>
        </div>

        <CommunicationsConsole
          email={{
            state,
            senderName: email.senderName,
            replyTo: email.replyTo,
            messagePreferences: email.messagePreferences as Record<string, boolean>,
          }}
          senderNameDefault={ctx.workspaceName ?? ""}
          mayManage={hasCapability(ctx, "practice.settings.manage")}
        />

        {/* ── s4: the compact readiness mirror. The engine lives on the booking workspace. ───────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Online booking readiness</h2>
          <ul className="mt-1.5 divide-y divide-gray-50">
            <ReadinessRow label="Email verification" {...emailRow} />
            <ReadinessRow label="Booking communications" {...commsRow} />
            <ReadinessRow label="Public booking" {...publicRow} />
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
