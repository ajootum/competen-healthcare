import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import OnboardingWizard from "./OnboardingWizard";

// /practice/onboarding (CPR-IAM-001 s9, CPR-PROV-001 s12). Guarded: authentication + workspace, and a
// workspace already ACTIVE goes straight to home -- re-running onboarding on an active practice is not a
// thing this page offers. The wizard itself is driven by the step catalog through the onboarding API, so
// the required steps live in one place (the database) rather than three.

export const dynamic = "force-dynamic";

export default async function Page() {
  const shell = await resolvePracticeShell();
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/onboarding");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice");
  if (shell.state === "CHOOSER_REQUIRED") redirect("/practice/select-workspace");
  if (shell.state === "ACCESS_RESTRICTED") redirect("/practice/access-status");
  // CPR-370: a revoked device and an unmet MFA policy are refusals like any other, and are refused on
  // EVERY practice surface rather than only in the shell layout.
  if (shell.state === "SESSION_REVOKED" || shell.state === "MFA_REQUIRED") redirect("/practice/access-status");
  if (shell.state === "READY") redirect("/practice/home");

  // ONBOARDING_REQUIRED is the one state that stays.
  const { ctx } = shell;

  return (
    <main className="min-h-screen bg-gray-50 flex items-start justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2.5 mb-6 mt-6">
          <span className="w-9 h-9 rounded-full bg-[var(--cp-primary)] flex items-center justify-center text-white font-bold">C</span>
          <div>
            <p className="text-[15px] font-bold text-gray-900">Set up {ctx.workspaceName}</p>
            <p className="text-[12px] text-gray-500">Short enough to finish in one sitting (IAM-001 rule, and ours).</p>
          </div>
        </div>
        <OnboardingWizard workspaceId={ctx.workspaceId} />
      </div>
    </main>
  );
}
