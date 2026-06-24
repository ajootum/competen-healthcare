export default function Home() {
  return (
    <div className="flex flex-col min-h-full font-[family-name:var(--font-geist-sans)]">

      {/* ── NAVBAR ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#0a2e38]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-sm">C</div>
          <span className="text-white font-semibold tracking-tight">Competen Healthcare</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-teal-200/80">
          <a href="/login" className="hover:text-white transition-colors">Login</a>
          <a href="/signup" className="rounded bg-teal-500 px-4 py-1.5 text-white font-medium hover:bg-teal-400 transition-colors">Start Free</a>
        </nav>
        <nav className="flex md:hidden items-center gap-3">
          <a href="/login" className="text-teal-200/80 text-sm hover:text-white transition-colors">Login</a>
          <a href="/signup" className="rounded bg-teal-500 px-3 py-1.5 text-white text-sm font-medium hover:bg-teal-400 transition-colors">Start Free</a>
        </nav>
      </header>

      {/* ── HERO ── */}
      <section className="bg-gradient-to-br from-[#0a2e38] via-[#0d3d4c] to-[#0f5060] px-6 pt-16 pb-14 text-center">
        <span className="inline-block mb-5 rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1 text-xs text-teal-300 tracking-wider">
          ✦ East Africa&apos;s Clinical Competency Platform
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-1">
          Build a Competent
        </h1>
        <h1 className="text-4xl sm:text-5xl font-bold italic text-amber-400 leading-tight mb-6">
          Healthcare Workforce.
        </h1>
        <p className="max-w-lg mx-auto text-teal-100/80 text-base leading-relaxed mb-8">
          Train nurses. Validate clinical skills. Issue certifications. Track workforce compliance — all in one platform built for African healthcare systems.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <a href="/signup" className="rounded-md bg-teal-500 px-6 py-3 text-white font-semibold hover:bg-teal-400 transition-colors text-sm">
            Start Free Trial
          </a>
          <a href="mailto:gabriel@semacast.com?subject=Hospital Demo Request" className="rounded-md border border-white/20 bg-white/5 px-6 py-3 text-white font-semibold hover:bg-white/10 transition-colors text-sm">
            Book a Hospital Demo
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-10 text-center">
          {[
            { num: "8", label: "PLATFORM MODULES" },
            { num: "1M+", label: "NURSES IN MARKET" },
            { num: "6", label: "TARGET COUNTRIES" },
            { num: "100%", label: "AFRICA-BUILT" },
          ].map(({ num, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-amber-400">{num}</div>
              <div className="text-xs text-teal-300/70 mt-0.5 tracking-widest">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURE NAV TABS ── */}
      <div className="bg-teal-700 flex justify-center gap-0 text-sm font-medium text-white/80">
        {["Train", "Assess", "Certify", "Track", "Improve"].map((tab) => (
          <span key={tab} className="px-8 py-3 hover:bg-teal-600 hover:text-white transition-colors border-r border-teal-600/50 last:border-0 cursor-default">
            {tab}
          </span>
        ))}
      </div>

      {/* ── THE PROBLEM ── */}
      <section className="bg-gray-50 px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-teal-600 tracking-widest uppercase mb-3 text-center">THE PROBLEM</p>
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-10">East Africa has a nursing competency crisis.</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { stat: "40%", desc: "of nurses in East Africa lack access to structured CPD training, leading to competency gaps that cost lives." },
              { stat: "0", desc: "digital platforms specifically built for East African nursing competency assessment, certification, and tracking." },
              { stat: "$1.2B", desc: "annual cost of healthcare workforce inefficiency in Sub-Saharan Africa due to untracked competency gaps." },
            ].map(({ stat, desc }) => (
              <div key={stat} className="bg-white rounded-xl border border-gray-100 p-6 text-center">
                <div className="text-4xl font-bold text-teal-700 mb-3">{stat}</div>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MODULES ── */}
      <section className="bg-white px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-teal-600 tracking-widest uppercase mb-3">PLATFORM</p>
          <h2 className="text-3xl font-bold text-gray-900 mb-1">One platform.</h2>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Eight modules.</h2>
          <p className="text-gray-500 text-sm max-w-md mb-12">
            From individual CPD courses to enterprise workforce intelligence — Competen Healthcare scales with every stage of your growth.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { tag: "LIVE", tagColor: "bg-green-100 text-green-700", title: "CPD Academy", desc: "Self-paced courses covering Pediatric Resus, Airway Management, Critical Care, Infection Prevention, and more. Earn certificates automatically.", cta: "From $2/month", ctaColor: "text-teal-600" },
              { tag: "LIVE", tagColor: "bg-green-100 text-green-700", title: "Question Bank", desc: "Clinical MCQs across Emergency, Safety, Pharmacology, Pediatrics, and Critical Care. Evidence-based questions mapped to real nursing competencies.", cta: "Included in Pro", ctaColor: "text-gray-500" },
              { tag: "LIVE", tagColor: "bg-green-100 text-green-700", title: "Competency Passport", desc: "Every nurse gets a digital portfolio tracking BLS, ALS, safe injectables, annual competencies, and expiry dates — all in one place.", cta: "Included in Premium", ctaColor: "text-gray-500" },
              { tag: "ENTERPRISE", tagColor: "bg-purple-100 text-purple-700", title: "Hospital Dashboard", desc: "Nursing directors see ward-by-ward competency heat maps, compliance reports, expiring certifications, and skill gap analysis.", cta: "$14/staff/month", ctaColor: "text-teal-600" },
              { tag: "LIVE", tagColor: "bg-green-100 text-green-700", title: "AI Clinical Copilot", desc: "Ask clinical questions and get instant, evidence-based answers powered by Claude AI. Grounded in WHO guidelines and East African nursing protocols.", cta: "Included in Premium", ctaColor: "text-gray-500" },
              { tag: "Q3 2026", tagColor: "bg-cyan-100 text-cyan-700", title: "Virtual Simulation", desc: "Africa's first AI-powered nursing simulation. Branching patient scenarios with immediate feedback — no mannequin required.", cta: "Add on", ctaColor: "text-gray-500" },
              { tag: "Q4 2026", tagColor: "bg-indigo-100 text-indigo-700", title: "Digital OSCE Platform", desc: "Students record responses remotely, examiners score using structured checklists. Serve nursing schools and hospitals at scale.", cta: "Institutional", ctaColor: "text-gray-500" },
              { tag: "LIVE", tagColor: "bg-green-100 text-green-700", title: "Knowledge Hub", desc: "Clinical library with WHO guidelines, protocols, and research summaries. Evidence-based answers to clinical questions, searchable and curated.", cta: "Included in Pro", ctaColor: "text-gray-500" },
            ].map(({ tag, tagColor, title, desc, cta, ctaColor }) => (
              <div key={title} className="border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow flex flex-col gap-3">
                <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded ${tagColor}`}>{tag}</span>
                <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed flex-1">{desc}</p>
                <span className={`text-xs font-medium ${ctaColor}`}>{cta}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SEE IT IN ACTION ── */}
      <section className="bg-[#0f1f2e] px-6 py-20 text-center">
        <p className="text-xs font-semibold text-teal-400 tracking-widest uppercase mb-3">INTERACTIVE DEMO</p>
        <h2 className="text-2xl font-bold text-white mb-2">See it in action.</h2>
        <p className="text-gray-400 text-sm mb-8">Explore what nurses and hospitals actually see on the platform.</p>
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-center gap-2 mb-6">
            {["Competency Passport", "AI Clinical Copilot", "Hospital Dashboard"].map((tab, i) => (
              <button key={tab} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${i === 0 ? "bg-teal-500 border-teal-500 text-white" : "border-gray-600 text-gray-400 hover:text-white"}`}>
                {tab}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl p-5 text-left shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm">JN</div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Jane Namwocha, RN</p>
                  <p className="text-xs text-gray-400">Kenyatta National Hospital · Medical Ward</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">28</p>
                <p className="text-xs text-gray-400">CPD hrs / 30h target</p>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-medium">COMPETENCY</th>
                  <th className="text-left py-2 font-medium">STATUS</th>
                  <th className="text-left py-2 font-medium">EXPIRES</th>
                  <th className="text-left py-2 font-medium">LEVEL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { name: "BLS Certification", status: "✓", exp: "Dec 2026", level: "Competent", levelColor: "text-green-600 bg-green-50" },
                  { name: "Pediatric Assessment", status: "✓", exp: "Mar 2027", level: "Competent", levelColor: "text-green-600 bg-green-50" },
                  { name: "Infection Control", status: "✓", exp: "Jun 2027", level: "Advanced", levelColor: "text-blue-600 bg-blue-50" },
                  { name: "Medication Safety", status: "⏳", exp: "Pending", level: "In Progress", levelColor: "text-gray-500 bg-gray-100" },
                  { name: "Critical Care", status: "!", exp: "—", level: "Required", levelColor: "text-red-600 bg-red-50" },
                ].map(({ name, status, exp, level, levelColor }) => (
                  <tr key={name}>
                    <td className="py-2.5 text-gray-700">{name}</td>
                    <td className="py-2.5 text-gray-500">{status}</td>
                    <td className="py-2.5 text-gray-500">{exp}</td>
                    <td className="py-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${levelColor}`}>{level}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">3 of 5 competencies complete · 1 expiring in 60 days</span>
              <a href="/signup" className="text-xs bg-teal-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-teal-700 transition-colors">Try it free →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="bg-white px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold text-teal-600 tracking-widest uppercase mb-3">PRICING</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Pay for what you need.</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto">Built for East Africa — pay monthly, annually, or per course. No long-term contracts. M-Pesa friendly.</p>
          </div>

          {/* Individual plans */}
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-4">FOR INDIVIDUAL NURSES</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-left mb-14">
            {[
              {
                name: "Free", price: "$0", sub: "Always free", highlight: false,
                features: ["3 CPD courses", "Basic question bank", "Progress tracking", "Certificate preview"],
                cta: "Get Started", ctaStyle: "border border-gray-200 text-gray-700 hover:bg-gray-50", href: "/signup",
              },
              {
                name: "Pro", price: "$4", sub: "/mo · or $35/yr  (save 27%)", highlight: true, badge: "MOST POPULAR",
                features: ["All CPD courses", "Full question bank", "Competency tracking", "CPD certificates", "Knowledge Hub"],
                cta: "Start Free Trial", ctaStyle: "", href: "/signup",
              },
              {
                name: "Premium", price: "$12", sub: "/mo · or $99/yr  (save 31%)", highlight: false,
                features: ["Everything in Pro", "AI Clinical Copilot", "Simulation previews", "Clinical portfolio", "Priority support"],
                cta: "Start Free Trial", ctaStyle: "border border-gray-200 text-gray-700 hover:bg-gray-50", href: "/signup",
              },
              {
                name: "Pay-per-course", price: "$2", sub: "per course — pay as you go", highlight: false, badge: "M-PESA FRIENDLY",
                features: ["Buy one course at a time", "No subscription needed", "Certificate included", "Pay via M-Pesa or card"],
                cta: "Browse Courses", ctaStyle: "border border-gray-200 text-gray-700 hover:bg-gray-50", href: "/signup",
              },
            ].map(({ name, price, sub, highlight, badge, features, cta, ctaStyle, href }) => (
              <div key={name} className={`rounded-2xl p-6 flex flex-col gap-4 ${highlight ? "bg-teal-600 text-white shadow-xl scale-105" : "border border-gray-100"}`}>
                {badge && <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded ${highlight ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"}`}>{badge}</span>}
                <div>
                  <p className={`text-sm font-semibold ${highlight ? "text-teal-100" : "text-gray-500"}`}>{name}</p>
                  <p className={`text-3xl font-bold mt-1 ${highlight ? "text-white" : "text-gray-900"}`}>{price}</p>
                  <p className={`text-[11px] mt-0.5 ${highlight ? "text-teal-200" : "text-gray-400"}`}>{sub}</p>
                </div>
                <ul className="flex flex-col gap-2 flex-1">
                  {features.map((f) => (
                    <li key={f} className={`text-xs flex gap-2 items-start ${highlight ? "text-teal-100" : "text-gray-500"}`}>
                      <span className={`mt-0.5 shrink-0 ${highlight ? "text-teal-300" : "text-teal-500"}`}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                <a href={href} className={`text-center rounded-lg py-2.5 text-sm font-semibold transition-colors ${highlight ? "bg-white text-teal-600 hover:bg-teal-50" : ctaStyle}`}>
                  {cta}
                </a>
              </div>
            ))}
          </div>

          {/* Hospital / Institution plans */}
          <div className="bg-[#0a2e38] rounded-2xl p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <p className="text-[10px] font-bold text-teal-400 tracking-widest uppercase mb-1">FOR HOSPITALS &amp; INSTITUTIONS</p>
                <h3 className="text-xl font-bold text-white">Per-seat pricing. Billed annually.</h3>
                <p className="text-teal-300/70 text-sm mt-1">The more nurses, the less you pay per seat.</p>
              </div>
              <a href="mailto:gabriel@semacast.com?subject=Hospital Demo Request"
                className="shrink-0 rounded-lg bg-teal-500 px-5 py-2.5 text-white text-sm font-semibold hover:bg-teal-400 transition-colors text-center">
                Book a Demo
              </a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { tier: "Starter", nurses: "1–25 nurses", price: "$8", desc: "Perfect for clinics and small wards" },
                { tier: "Growth", nurses: "26–100 nurses", price: "$6", desc: "Department-level deployment" },
                { tier: "Scale", nurses: "101–500 nurses", price: "$4", desc: "Hospital-wide competency management" },
                { tier: "Enterprise", nurses: "500+ nurses", price: "Custom", desc: "Multi-site, custom integrations & SLA" },
              ].map(({ tier, nurses, price, desc }) => (
                <div key={tier} className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <p className="text-teal-300 text-[10px] font-bold tracking-widest uppercase mb-2">{tier}</p>
                  <p className="text-white text-2xl font-bold">{price}{price !== "Custom" && <span className="text-sm font-normal text-teal-300">/nurse/mo</span>}</p>
                  <p className="text-teal-400/80 text-xs mt-1 mb-3">{nurses}</p>
                  <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {["Workforce dashboard", "Compliance heat maps", "Expiry alerts", "Bulk nurse onboarding"].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-teal-300/70">
                  <span className="text-teal-500 shrink-0">✓</span>{f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── ROADMAP ── */}
      <section className="bg-[#0f1f2e] px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs font-semibold text-teal-400 tracking-widest uppercase mb-3 text-center">TRACTION</p>
          <h2 className="text-3xl font-bold text-white text-center mb-12">What&apos;s built. What&apos;s next.</h2>
          <div className="flex flex-col gap-0">
            {[
              { module: "LIVE", title: "CPD Academy", desc: "8 evidence-based courses with lesson content, progress tracking, and CPD point certificates", live: true },
              { module: "LIVE", title: "Question Bank", desc: "Clinical MCQs across Emergency, Safety, Pharmacology, Pediatrics, and Critical Care", live: true },
              { module: "LIVE", title: "Competency Passport", desc: "Digital portfolio tracking BLS, ALS, safe injectables, and annual competencies with expiry alerts", live: true },
              { module: "LIVE", title: "AI Clinical Copilot", desc: "Powered by Claude AI — evidence-based answers to clinical questions, grounded in WHO and African guidelines", live: true },
              { module: "Q3 2026", title: "Virtual Simulation Lab", desc: "AI-powered branching patient scenarios — Africa's first nursing simulation without a mannequin", live: false },
              { module: "Q4 2026", title: "Digital OSCE + Hospital Dashboard", desc: "Remote OSCE assessment platform and ward-level compliance dashboard for nursing directors", live: false },
            ].map(({ module, title, desc, live }, i, arr) => (
              <div key={title} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${live ? "bg-teal-500" : "bg-teal-800 border border-teal-700"}`}>
                    {live ? "✓" : i - 3}
                  </div>
                  {i < arr.length - 1 && <div className="w-0.5 flex-1 bg-teal-800 my-1" />}
                </div>
                <div className="pb-8">
                  <p className={`text-[10px] font-bold tracking-widest ${live ? "text-teal-400" : "text-gray-500"}`}>{module}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-white font-semibold text-sm">{title}</p>
                    {live && <span className="text-[9px] bg-teal-500/20 text-teal-400 border border-teal-500/30 px-1.5 py-0.5 rounded font-bold">LIVE</span>}
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY COMPETEN ── */}
      <section className="bg-white px-6 py-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-semibold text-teal-600 tracking-widest uppercase mb-3">WHY COMPETEN HEALTHCARE</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-5">Domain expertise. Finally, software to match it.</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-7">
              Competen Healthcare is purpose-built for African nursing — not adapted from a generic LMS. We understand the CPD gap, the competency crisis, and the daily challenges of clinical training with limited resources. This is a clinical workforce intelligence platform built for Africa, by people who know Africa.
            </p>
            <div className="flex gap-3">
              <a href="/signup" className="rounded-md bg-teal-500 px-5 py-2.5 text-white text-sm font-semibold hover:bg-teal-600 transition-colors">Start Free</a>
              <a href="mailto:gabriel@semacast.com?subject=Hospital Demo Request" className="rounded-md border border-gray-200 px-5 py-2.5 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors">Book a Demo</a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            {[
              { icon: "🏥", title: "Healthcare-Built", desc: "Not adapted from a generic LMS — designed for nursing guidelines and clinical competency frameworks from day one." },
              { icon: "🌍", title: "Africa-Focused", desc: "Content aligned with Kenyan, Ugandan, Tanzanian, and Rwandan nursing boards, regulators, and local protocols." },
              { icon: "🤖", title: "AI-Powered", desc: "Claude AI provides instant, evidence-based clinical guidance. No hallucinations — grounded in real guidelines." },
              { icon: "✅", title: "Compliance-Ready", desc: "Built for in-service, pre-service, and hospital-level CPD compliance across all East African countries." },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="p-5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="text-2xl mb-3">{icon}</div>
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="bg-teal-600 px-6 py-20 text-center">
        <p className="text-xs font-semibold text-teal-200 tracking-widest uppercase mb-4">FREE TO JOIN</p>
        <h2 className="text-3xl font-bold text-white mb-3">Ready to build Africa&apos;s most<br />competent nursing workforce?</h2>
        <p className="text-teal-100 text-sm mb-8">Join nurses and hospitals already using the platform.<br />No credit card required — get started in 60 seconds.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/signup" className="rounded-lg bg-amber-400 px-8 py-3 text-sm font-bold text-amber-900 hover:bg-amber-300 transition-colors">
            Get Early Access — It&apos;s Free
          </a>
          <a href="mailto:gabriel@semacast.com?subject=Hospital Demo Request" className="rounded-lg border border-white/30 bg-white/10 px-8 py-3 text-sm font-semibold text-white hover:bg-white/20 transition-colors">
            Book a Hospital Demo
          </a>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-[#0a2e38] px-6 py-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-xs">C</div>
              <span className="text-white font-semibold text-sm">Competen Healthcare</span>
            </div>
            <p className="text-gray-500 text-xs leading-relaxed">East Africa&apos;s clinical competency platform. Training nurses since 2025.</p>
          </div>
          {[
            { heading: "PLATFORM", links: ["CPD Academy", "Question Bank", "Competency Passport", "Hospital Dashboard"] },
            { heading: "COMPANY", links: ["About", "Blog", "Careers", "Contact"] },
            { heading: "LEGAL", links: ["Privacy Policy", "Terms of Service", "Cookie Policy"] },
          ].map(({ heading, links }) => (
            <div key={heading}>
              <p className="text-gray-400 text-[10px] font-bold tracking-widest mb-3">{heading}</p>
              <ul className="flex flex-col gap-2">
                {links.map((l) => (
                  <li key={l}><a href="#" className="text-gray-500 text-xs hover:text-white transition-colors">{l}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-5xl mx-auto mt-10 pt-6 border-t border-gray-800 text-center text-gray-600 text-xs">
          © {new Date().getFullYear()} Competen Healthcare. Built for East African nurses.
        </div>
      </footer>

    </div>
  );
}
