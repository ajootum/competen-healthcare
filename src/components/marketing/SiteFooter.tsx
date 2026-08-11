import Link from "next/link";
import { ACCENT, BRAND, DEMO_REQUEST, FOOTER_LEGAL, STAFF_ACCESS } from "@/lib/marketing/home-content";
import { PRIMARY_SOLUTIONS } from "@/lib/marketing/solutions";
import { PRODUCTS } from "@/lib/marketing/products";

// Shared public footer. The Solutions column is generated from the same list as the routes and the header
// menu, so the three can never disagree about which solutions exist.

export default function SiteFooter() {
  return (
    <footer className="bg-[var(--cp-slate-900)] text-white/70">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 py-12 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Competen home">
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg font-bold"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #7C3AED)` }}>C</span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight text-white">{BRAND.name}</span>
              <span className="block text-[10px] text-white/50">{BRAND.tagline}</span>
            </span>
          </Link>
          <p className="mt-4 max-w-xs text-[12.5px] leading-relaxed text-white/45">
            Building a more competent, capable and confident healthcare workforce.
          </p>
          <div className="mt-4 flex gap-2">
            {["in", "X", "▶"].map(s => (
              <span key={s} aria-hidden className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[11px] text-white/60">{s}</span>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {/* WEB-HOME-001 s13: Products first, from the same catalogue as the header and homepage. */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Products</p>
            <ul className="mt-3 space-y-2">
              {PRODUCTS.map(p => (
                <li key={p.key}>
                  <Link href={p.href} className="text-[12.5px] text-white/55 hover:text-white transition-colors">{p.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Solutions</p>
            <ul className="mt-3 space-y-2">
              {PRIMARY_SOLUTIONS.map(s => (
                <li key={s.slug}>
                  <Link href={`/${s.slug}`} className="text-[12.5px] text-white/55 hover:text-white transition-colors">{s.nav}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Company</p>
            <ul className="mt-3 space-y-2">
              <li><Link href="/#cta" className="text-[12.5px] text-white/55 hover:text-white transition-colors">About Us</Link></li>
              <li><Link href="/#cta" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Resources</Link></li>
              <li><a href="mailto:gabriel@semacast.com?subject=Competen%20enquiry" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Access</p>
            <ul className="mt-3 space-y-2">
              <li><Link href="/login" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Sign in</Link></li>
              {/* ⚠ A mailto, not /signup. A demo request is a conversation; /signup is a registration
                  form, and signup is CLOSED by the owner's decision -- a demo button that walks into it
                  is a dishonest button in front of an honest wall. */}
              <li><a href={DEMO_REQUEST} className="text-[12.5px] text-white/55 hover:text-white transition-colors">Book a Demo</a></li>
              {/* ⚠ Quality is deliberately NOT here any more (WEB-HOME-001 s13): it is an Enterprise
                  sub-product, not an access route. The /quality PAGE stays -- WEB-STRAT-001 keeps it as
                  a secondary landing page and the disclosure harness asserts it stays reachable. */}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/40">
          <span>© {new Date().getFullYear()} Competen. All rights reserved.</span>
          {/* Plain text, not links: neither page exists yet, and a legal link to nowhere is worse than a label. */}
          {FOOTER_LEGAL.map(l => <span key={l.label}>{l.label}</span>)}
          {/* ⚠ WEB-HOME-001 s13: visually DISCREET and SEPARATED from customer access -- the legal bar,
              pushed to the far edge, not the Access column. It is a controlled governance entry, not a
              fifth product, and the gate behind it decides everything; this link only says the door
              exists. The href is the one configured constant, so the /hq rename later is one edit. */}
          <Link href={STAFF_ACCESS.href}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-white/15 px-2 py-1 text-white/45 hover:text-white/80 transition-colors">
            <span aria-hidden className="text-[10px]">🛡</span>{STAFF_ACCESS.label}
          </Link>
        </div>
      </div>
    </footer>
  );
}
