import Link from "next/link";
import { ACCENT, BRAND, FOOTER_LEGAL } from "@/lib/marketing/home-content";
import { PRIMARY_SOLUTIONS } from "@/lib/marketing/solutions";

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

        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-6">
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
              <li><Link href="/login" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Login</Link></li>
              <li><Link href="/signup" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Book a Demo</Link></li>
              <li><Link href="/quality" className="text-[12.5px] text-white/55 hover:text-white transition-colors">Quality</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/40">
          <span>© {new Date().getFullYear()} Competen. All rights reserved.</span>
          {/* Plain text, not links: neither page exists yet, and a legal link to nowhere is worse than a label. */}
          {FOOTER_LEGAL.map(l => <span key={l.label}>{l.label}</span>)}
        </div>
      </div>
    </footer>
  );
}
