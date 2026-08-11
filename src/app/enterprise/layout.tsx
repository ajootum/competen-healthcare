import Link from "next/link";
import { resolveEnterpriseShell } from "@/lib/enterprise-shell";
import { ENTERPRISE_BUILT_SUBPRODUCTS, ENTERPRISE_NOT_BUILT_REASON } from "@/lib/enterprise-constants";

// The Competen Enterprise tenant workspace shell -- ENT-DEC-001 D5, the walkable slice.
//
// ⚠ THIS IS NOT /super-admin/enterprise. That surface is Competen's own (the landlord org-hierarchy
// module, the other ENT-001); this one is a hospital tenant looking at its own organisation, behind
// gate 3. The two must never share a layout, a loader or a gate.
//
// ⚠ EVERY NON-READY STATE RENDERS A SENTENCE, NOT A DEAD END. AUTH_REQUIRED redirects to sign-in;
// NO_TENANT and REFUSED say what is true and who can change it. A refusal caused by an outage says to
// try again -- the sentence comes from the gate, which knows the difference.

export const dynamic = "force-dynamic";

export default async function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  const shell = await resolveEnterpriseShell();

  // ⚠ A PUBLIC GATE PAGE, NOT A BOUNCE -- WEB-HOME-001 s15, adopted 2026-08-11: an unauthenticated
  // visitor to /enterprise is a PROSPECT following a product card, and throwing them at a login form
  // answers a question they did not ask. The sign-in CTA carries the destination, so authentication
  // still lands them back here rather than on /dashboard.
  // ⚠ It says nothing about sub-products: s10 keeps those behind the door until Enterprise is chosen
  // AND the visitor is a member -- the catalogue renders only in the authenticated shell below.
  if (shell.state === "AUTH_REQUIRED")
    return (
      <div className="mx-auto max-w-lg p-10">
        <h1 className="text-2xl font-bold text-gray-900">Competen Enterprise</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
          Manage workforce, assess, train, and assure quality and performance across your organisation.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login?next=/enterprise"
            className="rounded-xl bg-[#4F46E5] px-5 py-2.5 text-[14px] font-semibold text-white hover:opacity-90">
            Sign in
          </Link>
          <a href={"mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen Enterprise enquiry")}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-[14px] font-semibold text-gray-700 hover:bg-gray-50">
            Talk to us
          </a>
        </div>
        <p className="mt-4 text-[12px] text-gray-500">
          Your organisation not on Competen Enterprise yet? Talk to us and we will walk you through it.
        </p>
      </div>
    );

  if (shell.state === "NO_TENANT")
    return (
      <div className="mx-auto max-w-lg p-10">
        <h1 className="text-xl font-bold text-gray-900">Competen Enterprise</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-gray-700">
          This account is not attached to an organisation on Competen Enterprise, so there is nothing to
          show here. If your organisation uses Competen Enterprise, an administrator there can attach
          your account.
        </p>
      </div>
    );

  if (shell.state === "REFUSED")
    return (
      <div className="mx-auto max-w-lg p-10">
        <h1 className="text-xl font-bold text-gray-900">Competen Enterprise</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-gray-700">{shell.sentence}</p>
      </div>
    );

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
