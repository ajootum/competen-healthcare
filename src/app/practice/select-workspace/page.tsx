import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import WorkspaceChooser from "./WorkspaceChooser";

// /practice/select-workspace (SHELL-001 s4/s8: the safe chooser for multiple memberships). A user with
// exactly one workspace never sees this page -- the shell resolves them straight through -- so reaching
// it means a genuine choice exists. Ownership type is shown per SHELL-001 s11.1 so the user knows which
// boundary they are entering before confirming.

export const dynamic = "force-dynamic";

export default async function Page() {
  const shell = await resolvePracticeShell();
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/select-workspace");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice/no-account");
  if (shell.state === "READY") redirect("/practice/home");
  if (shell.state === "ONBOARDING_REQUIRED") redirect("/practice/onboarding");
  if (shell.state === "ACCESS_RESTRICTED") redirect("/practice/access-status");
  // CPR-370: a revoked device and an unmet MFA policy are refusals like any other, and are refused on
  // EVERY practice surface rather than only in the shell layout.
  if (shell.state === "SESSION_REVOKED" || shell.state === "MFA_REQUIRED"
    || shell.state === "SECURITY_CHECK_UNAVAILABLE") redirect("/practice/access-status");

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-bold text-gray-900 mb-1">Choose a Practice</h1>
        <p className="text-[13px] text-gray-500 mb-5">You belong to more than one. Which are you working in now?</p>
        <WorkspaceChooser workspaces={shell.workspaces} />
      </div>
    </main>
  );
}
