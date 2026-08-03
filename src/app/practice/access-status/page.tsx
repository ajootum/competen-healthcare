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
};

export default async function Page() {
  const shell = await resolvePracticeShell();
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/access-status");
  if (shell.state === "READY") redirect("/practice/home");
  if (shell.state === "ONBOARDING_REQUIRED") redirect("/practice/onboarding");
  if (shell.state === "CHOOSER_REQUIRED") redirect("/practice/select-workspace");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice");

  const reason = REASONS[shell.reason] ?? REASONS.WORKSPACE_INACTIVE;

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
