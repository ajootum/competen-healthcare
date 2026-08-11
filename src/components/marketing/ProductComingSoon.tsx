import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";

// The product-branded entry screen for a product that is still being built -- the owner's request,
// 2026-08-11: Individual and Recruitment get their OWN sign-in screens like /practice has, not the
// generic /login with a notice squeezed above the form.
//
// ⚠ THERE IS DELIBERATELY NO PASSWORD FIELD. A credential box on a product that does not exist is a
// door painted on a wall -- the person types, submits, and lands somewhere that is not the thing the
// page promised. The Practice closed-state page set the pattern: an honest page says what is true and
// routes every real intention somewhere real. Here that means: the product is coming, your Competen
// account already works, and the generic sign-in takes you to everything it holds today.
//
// One component, two pages, so the pair cannot drift apart -- the same reason SolutionPage exists.

export type ComingSoonProduct = {
  wordmark: string;          // the sub-brand, e.g. "individual" -- rendered like competen PRACTICE
  name: string;              // "Competen Individual"
  accent: string;
  headline: string;
  body: string;
  points: string[];
  enquirySubject: string;
};

export default function ProductComingSoon({ p }: { p: ComingSoonProduct }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--cmp-neutral-50)] flex flex-col">
      <PatternField className="pointer-events-none absolute -top-24 -right-24 w-[36rem] h-[36rem]"
        tone={p.accent} opacity={0.12} />

      {/* The product-branded header, the shape /practice uses: the brand, then the sub-brand. */}
      <header className="relative border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 flex items-center gap-2.5 h-[70px]">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Competen home">
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg font-bold"
              style={{ background: p.accent }}>C</span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight text-gray-900">competen</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: p.accent }}>
                {p.wordmark}
              </span>
            </span>
          </Link>
        </div>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <span className="inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
            style={{ background: p.accent }}>
            Coming soon
          </span>
          <h1 className="mt-4 text-[1.6rem] font-bold leading-snug text-gray-900">{p.headline}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{p.body}</p>
          <ul className="mt-4 space-y-1.5">
            {p.points.map(pt => (
              <li key={pt} className="flex gap-2 text-[13px] text-gray-600">
                <span aria-hidden style={{ color: p.accent }}>✓</span>{pt}
              </li>
            ))}
          </ul>

          {/* ⚠ Every intention a visitor could arrive with, routed somewhere REAL. */}
          <div className="mt-6 space-y-2.5">
            <Link href="/login"
              className="block rounded-xl px-4 py-3 text-center text-[14px] font-semibold text-white hover:opacity-90"
              style={{ background: p.accent }}>
              Sign in to your Competen account →
            </Link>
            <p className="text-center text-[11.5px] text-gray-500">
              Your account already works everywhere Competen is live — sign in and you&apos;ll find
              {" "}{p.name} there the moment it opens.
            </p>
            {/* ⚠ ONE template string, not adjacent JSX text nodes: React server-rendering puts an HTML
                comment between a text node and an expression, which split the sentence in the rendered
                document and made the harness's needle span an invisible boundary. */}
            <a href={"mailto:gabriel@semacast.com?subject=" + encodeURIComponent(p.enquirySubject)}
              className="block rounded-xl border border-gray-300 px-4 py-3 text-center text-[14px] font-semibold text-gray-700 hover:bg-gray-50">
              {`Talk to us about ${p.name}`}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
