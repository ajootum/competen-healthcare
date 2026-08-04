import Link from "next/link";
import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";

// /practice/access-status (IAM-001 s7.1, SHELL-001 s13): a member of a restricted workspace sees WHAT
// KIND of restriction stands and what they may do -- a status page, not a broken dashboard. Reason
// CATEGORIES only, never internal detail (IAM-001 s16), and only for workspaces the caller is genuinely
// a member of; everyone else was already routed elsewhere by the guards.

export const dynamic = "force-dynamic";

const REASONS: Record<string, { title: string; body: string }> = {
  WORKSPACE_INACTIVE: {
    title: "This Practice is not currently available",
    body: "The workspace is suspended or being closed. Clinical data access is paused while that stands. If you believe this is wrong, contact support with your workspace name.",
  },
  NOT_ENTITLED: {
    title: "No active plan on this Practice",
    body: "The trial or subscription covering this workspace has ended, so access is paused. Your data is retained under the retention policy; reactivating the plan restores access.",
  },
  // CPR-370 (migration 213). Both say plainly what happened and what it does NOT mean -- a person who
  // has just been locked out needs to know whether they are still signed in to Competen.
  revoked: {
    title: "This device has been locked out of the Practice",
    body: "Somebody in this practice revoked access for this device. You are still signed in to Competen elsewhere — this is a Practice lockout, not a sign-out. Signing in from a device that has not been revoked will work as usual.",
  },
  idle: {
    title: "This device was idle for too long",
    body: "This practice sets a limit on how long a device may sit unused before it has to sign in again. Nothing is wrong with your account. Sign in again to carry on.",
  },
  MFA_REQUIRED: {
    title: "This Practice requires a second factor",
    body: "Somebody in this practice has made two-factor authentication a requirement. Two-factor is set up on your Competen account rather than here, so add an authenticator to your account and then come back.",
  },
};

export default async function Page() {
  const shell = await resolvePracticeShell();
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/access-status");
  if (shell.state === "READY") redirect("/practice/home");
  if (shell.state === "ONBOARDING_REQUIRED") redirect("/practice/onboarding");
  if (shell.state === "CHOOSER_REQUIRED") redirect("/practice/select-workspace");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice");

  // MFA_REQUIRED carries no `reason` field -- the state itself is the reason.
  const key = shell.state === "MFA_REQUIRED" ? "MFA_REQUIRED" : shell.reason;
  const reason = REASONS[key] ?? REASONS.WORKSPACE_INACTIVE;

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-lg font-bold text-gray-900">{reason.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">{reason.body}</p>
        <p className="mt-4 text-[13px] text-gray-500">
          <Link href="/practice" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Back to Competen Practice</Link>
        </p>
      </div>
    </main>
  );
}
