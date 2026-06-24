"use client";
import { useState } from "react";

const individualPlans = [
  {
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["3 CPD courses", "Basic question bank", "Progress tracking", "Certificate preview"],
    current: true,
    cta: "Current Plan",
    ctaDisabled: true,
  },
  {
    name: "Pro",
    monthlyPrice: 4,
    annualPrice: 35,
    badge: "MOST POPULAR",
    features: ["All CPD courses", "Full question bank", "Competency tracking", "CPD certificates", "Knowledge Hub"],
    cta: "Upgrade to Pro",
    highlight: true,
  },
  {
    name: "Premium",
    monthlyPrice: 12,
    annualPrice: 99,
    features: ["Everything in Pro", "AI Clinical Copilot", "Simulation previews", "Clinical portfolio", "Priority support"],
    cta: "Upgrade to Premium",
  },
];

const hospitalTiers = [
  { tier: "Starter",    nurses: "1–25 nurses",    pricePerSeat: 8 },
  { tier: "Growth",     nurses: "26–100 nurses",   pricePerSeat: 6 },
  { tier: "Scale",      nurses: "101–500 nurses",  pricePerSeat: 4 },
  { tier: "Enterprise", nurses: "500+ nurses",     pricePerSeat: null },
];

export default function BillingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Billing &amp; Plan</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage your subscription and payment options.</p>
      </div>

      {/* Current plan banner */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 text-lg">💳</div>
          <div>
            <p className="text-sm font-semibold text-gray-900">You are on the <span className="text-teal-600">Free plan</span></p>
            <p className="text-xs text-gray-400 mt-0.5">Upgrade to unlock all courses, AI Copilot, and more.</p>
          </div>
        </div>
        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2.5 py-1 rounded uppercase tracking-wider shrink-0">Free</span>
      </div>

      {/* Individual plans */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Individual Plans</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">Choose a plan that fits your learning goals</p>
          </div>
          {/* Monthly / Annual toggle */}
          <div className="flex items-center gap-2">
            <button onClick={() => setAnnual(false)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${!annual ? "bg-teal-600 text-white" : "text-gray-500 hover:text-gray-700"}`}>
              Monthly
            </button>
            <button onClick={() => setAnnual(true)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5 ${annual ? "bg-teal-600 text-white" : "text-gray-500 hover:text-gray-700"}`}>
              Annual
              {!annual && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">SAVE UP TO 31%</span>}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {individualPlans.map(({ name, monthlyPrice, annualPrice, badge, features, current, cta, ctaDisabled, highlight }) => {
            const price = annual ? annualPrice : monthlyPrice;
            const period = price === 0 ? "" : annual ? "/yr" : "/mo";
            const savings = annual && monthlyPrice > 0
              ? Math.round(100 - (annualPrice / (monthlyPrice * 12)) * 100)
              : null;

            return (
              <div key={name} className={`rounded-xl p-5 flex flex-col gap-4 ${
                highlight ? "bg-teal-600 text-white shadow-lg" : "bg-white border border-gray-100"
              } ${current ? "ring-2 ring-teal-500" : ""}`}>
                {badge && (
                  <span className={`self-start text-[10px] font-bold px-2 py-0.5 rounded ${
                    highlight ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                  }`}>{badge}</span>
                )}
                <div>
                  <p className={`text-xs font-semibold ${highlight ? "text-teal-100" : "text-gray-500"}`}>{name}</p>
                  <div className="flex items-end gap-1.5 mt-1">
                    <p className={`text-3xl font-bold ${highlight ? "text-white" : "text-gray-900"}`}>
                      {price === 0 ? "Free" : `$${price}`}
                    </p>
                    {price > 0 && (
                      <p className={`text-sm mb-0.5 ${highlight ? "text-teal-200" : "text-gray-400"}`}>{period}</p>
                    )}
                  </div>
                  {savings && (
                    <p className={`text-[11px] mt-0.5 ${highlight ? "text-teal-200" : "text-green-600"}`}>
                      You save {savings}% vs monthly
                    </p>
                  )}
                </div>
                <ul className="flex flex-col gap-2 flex-1">
                  {features.map(f => (
                    <li key={f} className={`text-xs flex gap-2 items-start ${highlight ? "text-teal-100" : "text-gray-500"}`}>
                      <span className={`mt-0.5 shrink-0 ${highlight ? "text-teal-300" : "text-teal-500"}`}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                <button
                  disabled={ctaDisabled}
                  className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                    ctaDisabled
                      ? "bg-gray-100 text-gray-400 cursor-default"
                      : highlight
                        ? "bg-white text-teal-600 hover:bg-teal-50"
                        : "border border-teal-200 text-teal-600 hover:bg-teal-50"
                  }`}>
                  {cta}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pay-per-course */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-5 mb-10 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-gray-900">Pay-per-course</p>
            <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded">M-PESA FRIENDLY</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">No subscription needed. Buy individual courses for <strong className="text-gray-700">$2 each</strong> and pay via M-Pesa, Airtel Money, or card. Certificate included with every course.</p>
        </div>
        <button className="shrink-0 rounded-lg bg-amber-400 text-amber-900 px-5 py-2.5 text-sm font-semibold hover:bg-amber-300 transition-colors">
          Browse Courses
        </button>
      </div>

      {/* Hospital / Institution section */}
      <div className="bg-[#0a2e38] rounded-2xl p-6 mb-10">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-[10px] font-bold text-teal-400 tracking-widest uppercase mb-1">Hospital &amp; Institution Plans</p>
            <h3 className="text-lg font-bold text-white">Per-seat pricing, billed annually</h3>
            <p className="text-teal-300/70 text-xs mt-1">The more nurses enrolled, the less you pay per seat.</p>
          </div>
          <a href="mailto:gabriel@semacast.com?subject=Hospital Plan Enquiry"
            className="shrink-0 rounded-lg bg-teal-500 px-4 py-2 text-white text-sm font-semibold hover:bg-teal-400 transition-colors text-center">
            Contact Sales
          </a>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {hospitalTiers.map(({ tier, nurses, pricePerSeat }) => (
            <div key={tier} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-teal-400 text-[10px] font-bold tracking-widest uppercase mb-2">{tier}</p>
              <p className="text-white text-xl font-bold">
                {pricePerSeat ? `$${pricePerSeat}` : "Custom"}
              </p>
              {pricePerSeat && <p className="text-teal-300/70 text-[11px]">/nurse/month</p>}
              <p className="text-gray-400 text-xs mt-2">{nurses}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {["Workforce dashboard", "Compliance reports", "Expiry alerts", "Bulk nurse onboarding"].map(f => (
            <div key={f} className="flex items-center gap-1.5 text-xs text-teal-300/70">
              <span className="text-teal-500 shrink-0">✓</span>{f}
            </div>
          ))}
        </div>
      </div>

      {/* Payment methods */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4">Accepted Payment Methods</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { name: "M-Pesa", flag: "🇰🇪", desc: "Kenya, Tanzania" },
            { name: "Airtel Money", flag: "📱", desc: "Uganda, Rwanda" },
            { name: "Credit / Debit Card", flag: "💳", desc: "Visa, Mastercard" },
            { name: "Bank Transfer", flag: "🏦", desc: "For institutions" },
          ].map(({ name, flag, desc }) => (
            <div key={name} className="bg-gray-50 rounded-lg p-3 flex items-start gap-3">
              <span className="text-xl mt-0.5">{flag}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{name}</p>
                <p className="text-[11px] text-gray-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          All prices in USD. Payment processing coming soon — contact <a href="mailto:gabriel@semacast.com" className="text-teal-600 hover:underline">gabriel@semacast.com</a> to upgrade manually.
        </p>
      </div>
    </div>
  );
}
