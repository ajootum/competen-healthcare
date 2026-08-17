import Link from "next/link";
import { resolveEnterpriseShell } from "@/lib/enterprise-shell";
import { ENTERPRISE_BUILT_SUBPRODUCTS, ENTERPRISE_NOT_BUILT_REASON } from "@/lib/enterprise-constants";
import { pageMetadata } from "@/lib/marketing/site";
import EnterpriseGateway from "./EnterpriseGateway";

// Enterprise Home -- the catalogue as cards. ENT-DEC-001 D5.
//
// ⚠ SINCE COMP-ENT-UX-001 (2026-08-17) THIS PAGE IS ALSO THE PUBLIC ENTERPRISE GATEWAY: a signed-out
// visitor renders EnterpriseGateway.tsx here (the layout's AUTH_REQUIRED branch delegates to its
// children now). The two audiences never see each other's surface -- the gateway is AUTH_REQUIRED
// only, the catalogue READY only, and the gateway names no tenant, organisation or workspace (s7).
//
// ⚠ OWN GATE, NOT ONLY THE LAYOUT'S. Next's own documentation: a layout "will not prevent nested route
// segments and Server Actions from being accessed", and the access matrix distinguishes own from
// inherited guards for exactly this reason.
//
// ⚠ EVERY SENTENCE TRUE TODAY. No card claims an entitlement -- there is no per-sub-product entitlement
// store yet, and claiming "your organisation holds Workforce" would be an invention. What is true: the
// catalogue, which surface is built, and that the rest are not switched on.

export const dynamic = "force-dynamic";

// The gateway is a public marketing surface, so it carries its own canonical/OG metadata like every
// other public page (pageMetadata's two-trap rationale). The copy is the spec's approved hero (s4.1);
// none of WEB-STRAT-001's forbidden vocabulary appears in it.
export const metadata = pageMetadata({
  title: "Competen Enterprise — Build a workforce you can trust.",
  description: "Workforce capability, assessment, learning and quality assurance for healthcare organisations.",
  path: "/enterprise",
});

export default async function EnterpriseHome() {
  const shell = await resolveEnterpriseShell();
  // COMP-ENT-UX-001: the signed-out visitor is a PROSPECT following a product card, and this is the
  // gateway that orients them. Rendered, not redirected -- /enterprise IS the public route (spec s7).
  if (shell.state === "AUTH_REQUIRED") return <EnterpriseGateway />;
  // ⚠ NULL, NOT redirect(). A page executes even when its layout declines to render children -- the
  // layout gets children as a prop it may ignore, but the page has already run, and a redirect THROWN
  // here beats the layout's output. The first version redirected to /enterprise, which from under
  // /enterprise is an infinite loop for every non-member. The layout's refusal sentence is the answer
  // for NO_TENANT and REFUSED; this page's only job in those states is to contribute nothing.
  if (shell.state !== "READY") return null;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">
        {shell.tenantName ?? "Your organisation"} on Competen Enterprise
      </h1>
      <p className="mt-1 text-[13px] text-gray-600">
        One organisation, eight sub-products. What is not yet switched on is shown so you can see the
        whole of it, not because it can be opened.
      </p>

      {shell.subproductsUnavailable ? (
        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          The sub-product list could not be read just now, so nothing is shown. This is not a statement
          about what your organisation holds — it is worth trying again in a moment.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {shell.subproducts.map(s => {
            const built = ENTERPRISE_BUILT_SUBPRODUCTS.includes(s.code);
            return (
              <div key={s.code} className={`rounded-xl border bg-white p-4 ${built ? "border-blue-300" : "border-gray-200"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[14px] font-bold text-gray-900">{s.name}</h2>
                  {built
                    ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10.5px] font-bold text-blue-900">Read-only</span>
                    : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-bold text-gray-500">Not switched on</span>}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{s.description}</p>
                {built
                  ? <Link href={`/enterprise/${s.code}`} className="mt-2 inline-block text-[12.5px] font-semibold text-blue-700 underline">Open {s.name} →</Link>
                  : <p className="mt-2 text-[11px] text-gray-400">{ENTERPRISE_NOT_BUILT_REASON}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
