import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveEnterpriseShell } from "@/lib/enterprise-shell";

// COMP-ENT-UX-001 s7: unauthorised routes fail CLOSED and land somewhere that says what to do next.
//
// ⚠ WHY THIS EXISTS. The outer /enterprise layout stopped rendering its own gate for AUTH_REQUIRED
// (the gateway spec moved that state into the children), and this page's own gate contributes null
// for every non-READY state -- which for a signed-out visitor would have rendered a BLANK 200, the
// exact dead-end shape the walkthroughs keep finding. A signed-out visitor here goes to the public
// gateway at /enterprise, whose dominant action is the sign-in door.
//
// ⚠ NO_TENANT NOW LIVES HERE TOO (2026-08-17). It used to sit in the outer layout, which meant it
// rendered at EVERY path under /enterprise -- including /enterprise itself, the public product page --
// so a visitor signed in to Competen for some other reason was told they were not attached to an
// organisation instead of being shown what Enterprise is. The sentence was not wrong, it was in the
// wrong place. HERE it answers a real question: somebody reached for tenant content and there is no
// tenant to serve it from. REFUSED stays with the outer layout, because a genuine block or an outage
// is not a prospect's problem to read past.
// Redirecting to /enterprise is not the recorded loop (page.tsx's lesson): that loop was /enterprise
// redirecting to ITSELF for non-members; from a child path, /enterprise renders the gateway.

export const dynamic = "force-dynamic";

/**
 * The same shape the outer layout uses for REFUSED: a heading, what is true, and three ways onward.
 * A no-access state is a sentence WITH AN EXIT -- the recorded rule from the staff door, and the one
 * this page would otherwise break by being a dead end at the end of a link somebody followed.
 *
 * ⚠ THE WORKSPACE LINK IS /dashboard, NOT /practice. This layout does not know which products the
 * account holds, and offering Practice to somebody who does not hold it is a wrong door with a
 * confident label. The Personal Workspace is the one destination every authenticated account has.
 */
function NoTenant() {
  return (
    <div className="mx-auto max-w-lg p-10">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Competen</p>
      <h1 className="mt-1 text-xl font-bold text-gray-900">Competen Enterprise</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-gray-700">
        This account is not attached to an organisation on Competen Enterprise, so there is nothing to
        show here. If your organisation uses Competen Enterprise, an administrator there can attach
        your account.
      </p>
      <div className="mt-5 flex flex-col gap-2 text-[13px]">
        <Link href="/enterprise" className="font-semibold text-blue-700 hover:underline">
          See what Competen Enterprise does &rarr;
        </Link>
        <Link href="/dashboard" className="font-semibold text-gray-700 hover:underline">
          Go to your Competen workspace
        </Link>
        <a href="mailto:gabriel@semacast.com?subject=Competen%20Enterprise%20enquiry"
          className="text-gray-600 hover:underline">
          Talk to us about Competen Enterprise
        </a>
      </div>
    </div>
  );
}

export default async function EnterpriseWorkforceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/enterprise");

  const shell = await resolveEnterpriseShell();
  if (shell.state === "NO_TENANT") return <NoTenant />;

  return <>{children}</>;
}
