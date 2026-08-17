import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";

// The public Enterprise Gateway -- COMP-ENT-UX-001, 2026-08-17. A gateway, not a brochure (s2): it
// orients, routes into sign-in, and offers one acquisition conversation. It supersedes the sparse
// WEB-HOME-001-era gate card that the /enterprise layout used to render for signed-out visitors.
//
// ⚠ NO CREDENTIAL FIELD, NO TENANT NAMES (s7, s14). The sign-in CTA is the existing access door at
// /enterprise/sign-in -- a thin branded wrapper that funnels to the one shared identity
// (src/lib/access-doors.ts pins its truth) -- and this page never enumerates organisations, tenants
// or workspaces. Organisation and role resolve server-side AFTER authentication (the enterprise
// layout + shell own that).
//
// ⚠ EXPLICIT EXCLUSIONS ARE LAW (s14): no pricing, no testimonials, no screenshots, no organisation
// directory, no carousels, no competing sign-in paths. The four product pillars carry the approved
// three-word microcopy (s4.2) and deliberately do NOT link anywhere: the sub-product surfaces live
// behind authentication, and a public link to them would be a door painted on a wall.
//
// ⚠ ANALYTICS (s12) DEFERRED, NOT FAKED. The public site has no analytics producer -- no script, no
// event pipeline, nothing in src/components/marketing/* emits anything (checked 2026-08-17; the only
// telemetry producer in the estate is Practice's authenticated activation telemetry, CPR-ADOPT).
// Inventing a pipeline for five events on one page would be a new estate-wide decision, not a page.
//
// ⚠ THE INDIGO IS THE APPROVED ENTERPRISE ACCENT, spelled where the product is defined:
// src/lib/marketing/products.ts:29 (#4F46E5), the same literal the authenticated shell uses. No
// enterprise-namespaced CSS token exists (--cmp-* has no indigo; --cp-* is Practice's layer), so the
// literal follows the recorded convention rather than borrowing another product's token. Every other
// colour is a --cmp-* design-system token (s6).
//
// All server components, zero client JavaScript (s13): hero text and the primary CTA are in the
// first flush, the visual is a CSS gradient (no image, no layout shift), and the only "motion" is a
// hover colour swap gated behind motion-safe (s10).

const TALK_TO_US =
  "mailto:gabriel@semacast.com?subject=" + encodeURIComponent("Competen Enterprise enquiry");

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";

// ── The Enterprise product family (s4.2) -- the approved microcopy, verbatim ───────────────────────
const PRODUCT_FAMILY = [
  { name: "Workforce", micro: "Plan and organise your workforce.", icon: "people" },
  { name: "Assessment", micro: "Verify capability.", icon: "clipboard" },
  { name: "Learning", micro: "Develop people.", icon: "book" },
  { name: "Quality", micro: "Assure standards.", icon: "shield" },
] as const;

/** Simple line icons, one stroke family (s6): 24px grid, 1.75 stroke, round caps, no fills. */
function PillarIcon({ icon }: { icon: (typeof PRODUCT_FAMILY)[number]["icon"] }) {
  const paths: Record<typeof icon, React.ReactNode> = {
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    clipboard: (
      <>
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </>
    ),
    book: (
      <>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </>
    ),
    shield: (
      <>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[icon]}
    </svg>
  );
}

// ── Header: Competen brand | ENTERPRISE, Back to Competen (s3) ─────────────────────────────────────
function EnterpriseGatewayHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--cmp-neutral-200)] bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-[72px] w-full max-w-[75rem] items-center gap-3 px-5 sm:px-8">
        {/* The product-branded brand block, the shape /practice and the coming-soon doors use. */}
        <Link href="/" aria-label="Competen home"
          className={`flex min-h-[44px] items-center gap-2.5 rounded-lg ${FOCUS_RING}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4F46E5] text-lg font-bold text-white">C</span>
          <span className="leading-tight">
            <span className="block text-lg font-bold tracking-tight text-[var(--cmp-neutral-900)]">competen</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#4F46E5]">Enterprise</span>
          </span>
        </Link>
        <Link href="/"
          className={`ml-auto inline-flex min-h-[44px] items-center rounded-lg px-2 text-[14px] font-medium text-[var(--cmp-neutral-600)] hover:text-[var(--cmp-neutral-900)] hover:underline ${FOCUS_RING}`}>
          <span aria-hidden="true" className="mr-1.5">←</span>Back to Competen
        </Link>
      </div>
    </header>
  );
}

// ── Primary actions: sign-in dominant, Talk to us outlined (s3, s8) ────────────────────────────────
function EnterprisePrimaryActions() {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      {/* The one dominant action (s2). The door itself redirects to the shared identity
          (/login?next=/enterprise) -- no second sign-in path competes with it (s14). */}
      <Link href="/enterprise/sign-in"
        className={`inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#4F46E5] px-7 text-[15px] font-semibold text-white shadow-sm motion-safe:transition-colors hover:bg-[#4338CA] hover:shadow ${FOCUS_RING}`}>
        Sign in to Enterprise <span aria-hidden="true" className="ml-2">→</span>
      </Link>
      <a href={TALK_TO_US}
        className={`inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cmp-neutral-300)] bg-white px-7 text-[15px] font-semibold text-[var(--cmp-neutral-700)] motion-safe:transition-colors hover:border-[var(--cmp-neutral-400)] hover:bg-[var(--cmp-neutral-100)] ${FOCUS_RING}`}>
        Talk to us
      </a>
    </div>
  );
}

// ── Hero (s4.1) -- approved copy verbatim; abstract treatment instead of a clinician photo (s16) ──
function EnterpriseHero() {
  return (
    <section className="mx-auto w-full max-w-[75rem] px-5 pb-14 pt-14 sm:px-8 sm:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,42rem)_1fr]">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#4F46E5]">Competen Enterprise</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-[var(--cmp-neutral-900)] sm:text-5xl">
            Build a workforce you can trust.
          </h1>
          <p className="mt-4 max-w-[40rem] text-[16px] leading-relaxed text-[var(--cmp-neutral-600)] sm:text-lg">
            Workforce capability, assessment, learning and quality assurance for healthcare organisations.
          </p>
          <EnterprisePrimaryActions />
        </div>
        {/* s16: the clinician image is optional and this is the restrained alternative it names -- a
            gradient/abstract healthcare-neutral treatment. Decorative, so hidden from assistive tech;
            hidden below lg so it can never push the CTA down a small screen (s9). A CSS box, not an
            image: nothing loads late, nothing shifts (s13). */}
        <div aria-hidden="true" className="relative hidden h-[22rem] overflow-hidden rounded-3xl bg-gradient-to-br from-[#4F46E5] to-[#312E81] lg:block">
          <PatternField className="absolute inset-0" tone="var(--cmp-neutral-0)" opacity={0.14} />
        </div>
      </div>
    </section>
  );
}

// ── Product strip: four pillars, concise cards, no feature catalogue (s2, s3) ──────────────────────
function EnterpriseProductCard({ p }: { p: (typeof PRODUCT_FAMILY)[number] }) {
  // Identity is carried by name + icon shape, never by colour alone (s10). Not a link: the surfaces
  // behind these names open only after authentication (s7), and a card that goes nowhere honest
  // stays a card.
  return (
    <li className="rounded-2xl border border-[var(--cmp-neutral-200)] bg-white p-6 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--cmp-neutral-100)] text-[#4F46E5]">
        <PillarIcon icon={p.icon} />
      </span>
      <h3 className="mt-4 text-[15px] font-bold text-[var(--cmp-neutral-900)]">{p.name}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--cmp-neutral-600)]">{p.micro}</p>
    </li>
  );
}

function EnterpriseProductFamily() {
  return (
    <section aria-labelledby="ent-family" className="mx-auto w-full max-w-[75rem] px-5 pb-16 sm:px-8">
      <h2 id="ent-family" className="sr-only">The Enterprise product family</h2>
      {/* s9's own breakpoints, not Tailwind's defaults: 2x2 holds through 1199px and the four-across
          row begins at the spec's 1200px desktop line (min-[75rem]), not at lg's 1024. */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[75rem]:grid-cols-4">
        {PRODUCT_FAMILY.map(p => <EnterpriseProductCard key={p.name} p={p} />)}
      </ul>
    </section>
  );
}

// ── Prospect prompt: the one acquisition route (s3) ────────────────────────────────────────────────
function EnterpriseProspectPrompt() {
  return (
    <section aria-labelledby="ent-prospect" className="mx-auto w-full max-w-[75rem] px-5 pb-20 sm:px-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--cmp-neutral-200)] bg-white p-8 text-center shadow-sm">
        <h2 id="ent-prospect" className="text-lg font-bold text-[var(--cmp-neutral-900)]">
          New to Competen Enterprise?
        </h2>
        <a href={TALK_TO_US}
          className={`mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--cmp-neutral-300)] bg-white px-6 text-[14px] font-semibold text-[var(--cmp-neutral-700)] motion-safe:transition-colors hover:border-[var(--cmp-neutral-400)] hover:bg-[var(--cmp-neutral-100)] ${FOCUS_RING}`}>
          Talk to us about your organisation
        </a>
      </div>
    </section>
  );
}

export default function EnterpriseGateway() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--cmp-neutral-50)]">
      <EnterpriseGatewayHeader />
      <main className="flex-1">
        <EnterpriseHero />
        <EnterpriseProductFamily />
        <EnterpriseProspectPrompt />
      </main>
    </div>
  );
}
