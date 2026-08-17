import Link from "next/link";
import { resolveEnterpriseShell } from "@/lib/enterprise-shell";
import { ENTERPRISE_BUILT_SUBPRODUCTS, ENTERPRISE_NOT_BUILT_REASON } from "@/lib/enterprise-constants";

// The Competen Enterprise tenant workspace shell -- ENT-DEC-001 D5, the walkable slice.
//
// ⚠ THIS IS NOT /super-admin/enterprise. That surface is Competen's own (the landlord org-hierarchy
// module, renumbered ENT-ORG-001 per ENT-DEC-001 D8); this one is a hospital tenant looking at its own
// organisation, behind
// gate 3. The two must never share a layout, a loader or a gate.
//
// ⚠ EVERY NON-READY STATE RENDERS A SENTENCE, NOT A DEAD END. AUTH_REQUIRED redirects to sign-in;
// NO_TENANT and REFUSED say what is true and who can change it. A refusal caused by an outage says to
// try again -- the sentence comes from the gate, which knows the difference.

export const dynamic = "force-dynamic";

/**
 * ⚠ A NO-ACCESS STATE IS A SENTENCE WITH AN EXIT (2026-08-17, the owner reading this very screen).
 *
 * Both of these states used to render a heading and a paragraph in the middle of an empty page: no
 * header, no way back to Competen, and no route to the product the account DOES hold. The staff door
 * settled this rule for the estate -- "who you are signed in as, what is true of this account, and
 * where to go" -- and COMP-ID-ROUTE-001 s7 states it again for the no-product state: a heading, the
 * message, an approved support path, and Return to Competen. A dead end is not honesty, it is honesty
 * that stops halfway.
 *
 * ⚠ THE WORKSPACE LINK IS /dashboard, NOT /practice. This layout does not know which products the
 * account holds, and offering Practice to somebody who does not hold it would be a wrong door with a
 * confident label. The Personal Workspace is the one destination every authenticated account has
 * (PW-014's universal landing), and it aggregates whatever they actually hold.
 */
function NoAccess({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg p-10">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Competen</p>
      <h1 className="mt-1 text-xl font-bold text-gray-900">Competen Enterprise</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-gray-700">{children}</p>
      <div className="mt-5 flex flex-col gap-2 text-[13px]">
        <Link href="/dashboard" className="font-semibold text-blue-700 hover:underline">
          Go to your Competen workspace &rarr;
        </Link>
        <a href="mailto:gabriel@semacast.com?subject=Competen%20Enterprise%20enquiry"
          className="font-semibold text-gray-700 hover:underline">
          Talk to us about Competen Enterprise
        </a>
        <Link href="/" className="text-gray-600 hover:underline">Return to Competen</Link>
      </div>
    </div>
  );
}

export default async function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  const shell = await resolveEnterpriseShell();

  // ⚠ THE SIGNED-OUT VISITOR BELONGS TO THE CHILDREN NOW -- COMP-ENT-UX-001 (2026-08-17) superseded
  // the small gate card this branch used to render (the WEB-HOME-001 s15 shape). Each public segment
  // answers a signed-out visitor itself: /enterprise renders the full Enterprise Gateway (page.tsx +
  // EnterpriseGateway.tsx), /enterprise/sign-in's thrown redirect now actually reaches the browser --
  // so the door genuinely funnels to /login?next=/enterprise, making its registry truth string
  // (src/lib/access-doors.ts) literally true where before this layout swallowed it -- and
  // /enterprise/workforce sends the visitor to the gateway via its own nested layout.
  // ⚠ Rendering any gate HERE would sit that gate at EVERY child path, including the sign-in door
  // itself -- whose "Sign in to Enterprise" CTA would then loop onto its own page.
  // What WEB-HOME-001 s15 decided still holds, one level down: a prospect is oriented, never thrown
  // at a bare login form, and s10 still keeps sub-product surfaces behind membership -- the gateway
  // names the four pillars (the UX spec's product family) and no tenant, workspace or catalogue row.
  if (shell.state === "AUTH_REQUIRED") return <>{children}</>;

  /**
   * ⚠ NO_TENANT BELONGS TO THE CHILDREN TOO (2026-08-17, the owner opening competenhealthcare.com/enterprise).
   *
   * This branch used to render the "your account is not attached to an organisation" card, and it did
   * so at EVERY path under /enterprise -- including /enterprise itself, which is the PUBLIC PRODUCT
   * PAGE. So anyone already signed in to Competen for another reason (a practitioner using Practice, a
   * member of staff in HQ) who followed a product link to see what Enterprise IS was shown a dead end
   * telling them they were not attached to something they had never asked to join. The marketing
   * gateway sat behind it, rendered by nobody.
   *
   * The gateway's own reasoning is the argument: page.tsx calls the signed-out visitor "a PROSPECT
   * following a product card". A signed-in visitor with no Enterprise tenant is exactly as much a
   * prospect -- being signed in to a DIFFERENT product is not evidence of anything about this one.
   * Being signed out was never what made them a prospect; having no tenant is.
   *
   * The sentence is not lost, it is MOVED to where somebody actually reached for tenant content:
   * /enterprise/workforce's own layout. That is where "an administrator there can attach your account"
   * answers a real question, rather than pre-empting one nobody asked.
   */
  if (shell.state === "NO_TENANT") return <>{children}</>;

  // ⚠ REFUSED STAYS. It is not "you are a prospect" -- it is a genuine block, or an outage the gate
  // could not read past, and enterpriseRefusalSentence says which. Quietly swapping that for a
  // marketing page would be the product claiming everything is fine while something is wrong.
  if (shell.state === "REFUSED")
    return <NoAccess>{shell.sentence}</NoAccess>;

  return (
    <div className="flex min-h-screen bg-[#f7f8fa]">
      <aside className="hidden w-60 shrink-0 flex-col bg-[#0f1f4b] text-white md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold">C</span>
          <span className="text-[15px] font-bold">competen<span className="text-blue-300">Enterprise</span></span>
        </div>
        <nav className="px-3 py-3" aria-label="Enterprise sub-products">
          <Link href="/enterprise" className="mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-blue-100 hover:bg-white/10">
            Home
          </Link>
          {/* ⚠ THE CATALOGUE, NOT A HAND-KEPT LIST. What is not built renders DISABLED WITH A REASON --
              hidden entries read as absent from the product, and this product has paid for that twice. */}
          {shell.subproductsUnavailable ? (
            <p className="px-1 text-[12px] leading-relaxed text-blue-100/60">
              The list of sub-products could not be read just now, so none are shown. This is not a
              statement about what your organisation holds.
            </p>
          ) : shell.subproducts.map(s =>
            ENTERPRISE_BUILT_SUBPRODUCTS.includes(s.code) ? (
              <Link key={s.code} href={`/enterprise/${s.code}`}
                className="mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-blue-100 hover:bg-white/10">
                {s.name}
              </Link>
            ) : (
              <span key={s.code} aria-disabled="true" title={ENTERPRISE_NOT_BUILT_REASON}
                className="mb-0.5 flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-blue-100/35">
                {s.name}
              </span>
            ))}
        </nav>
        <div className="mt-auto border-t border-white/10 px-4 py-3">
          <p className="truncate text-[12.5px] font-semibold text-white">{shell.tenantName ?? "Your organisation"}</p>
          <p className="text-[10px] text-blue-200/50">Enterprise workspace</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
