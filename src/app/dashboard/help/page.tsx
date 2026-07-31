import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SHORTCUTS } from "@/lib/platform/shortcuts";
import tokens from "@/lib/design/tokens";

// Help & Support (PUI-002 "User Menu Standard", PUI-005 s2 keyboard navigation).
//
// This exists because the user menu links to it — an entry that opened nothing would be exactly the kind of
// dead nav the platform work has been removing. It documents what is REAL: the shortcuts the platform
// actually binds, the accessibility commitments actually implemented, and where to go for the things this
// page cannot answer. Nothing here describes a capability that does not exist.

export const dynamic = "force-dynamic";

const card = "bg-white rounded-xl border border-gray-200 p-5";

function Kbd({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {combo.split("+").map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center px-1.5 h-5 rounded border border-gray-300 bg-gray-50 text-[11px] font-medium text-gray-700 tabular-nums">
          {k.trim()}
        </span>
      ))}
    </span>
  );
}

export default async function HelpPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help &amp; Support</h1>
        <p className="text-sm text-gray-500 mt-0.5">Keyboard shortcuts, accessibility, and where to get help.</p>
      </div>

      {/* ── Keyboard shortcuts (PUI-005 s2) ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-1">Keyboard Shortcuts</h2>
        <p className="text-[11px] text-gray-400 mb-3">
          These are the shortcuts the platform binds. They work from anywhere except while you are typing in a
          field, so a <Kbd combo="/" /> inside a note stays a slash.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Action</th>
                <th className="pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map(s => (
                <tr key={s.combo} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-gray-700">{s.action}</td>
                  <td className="py-2"><Kbd combo={s.display} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Accessibility (PUI-005) ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-1">Accessibility</h2>
        <p className="text-[11px] text-gray-400 mb-3">Competen targets WCAG 2.1 AA. What that means in practice here:</p>
        <ul className="space-y-1.5 text-sm text-gray-700">
          <li>• Every interactive element is reachable by keyboard and shows a visible {tokens.a11y.focusRingWidth}px focus outline.</li>
          <li>• Press <Kbd combo="Tab" /> on any page to reveal a <span className="font-medium">Skip to main content</span> link as the first stop.</li>
          <li>• Text scales to 200% without losing content, from a {tokens.a11y.baseFontSize}px base.</li>
          <li>• Status is never carried by colour alone — every coloured indicator is paired with text or an icon.</li>
          <li>• Touch targets are at least {tokens.a11y.minTouchTarget}px, except in dense data grids, which WCAG exempts.</li>
          <li>• If your system is set to reduce motion, all animation and transitions are switched off.</li>
        </ul>
        <p className="text-[11px] text-gray-400 mt-3">
          Set your own display, language and notification preferences in{" "}
          <Link href="/dashboard/preferences" className="text-teal-700 hover:underline">Preferences</Link>.
        </p>
      </div>

      {/* ── Where to go ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Where to go</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { label: "Your notifications", href: "/dashboard/notifications", sub: "Alerts, reminders and clinical updates" },
            { label: "Your messages", href: "/dashboard/messages", sub: "Conversations and announcements" },
            { label: "Competency Passport", href: "/dashboard/passport", sub: "Your competencies and evidence" },
            { label: "Learning", href: "/dashboard/learning", sub: "Courses, CPD and assessments" },
            { label: "Profile", href: "/dashboard/profile", sub: "Your details and credentials" },
            { label: "Preferences", href: "/dashboard/preferences", sub: "Display, language and notifications" },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="block border border-gray-100 rounded-lg p-3 hover:border-gray-300 hover:bg-gray-50 transition-colors">
              <p className="text-sm font-medium text-gray-900">{l.label}</p>
              <p className="text-[11px] text-gray-500">{l.sub}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Something not working?</h2>
        <p className="text-sm text-gray-600">
          Report it to your organisation&apos;s Competen administrator — they can see the audit trail for your
          account and raise it onward. Include the page address and what you expected to happen.
        </p>
        <p className="text-[11px] text-gray-400 mt-2">
          This page deliberately does not list a support phone number or ticket portal: those are configured
          per organisation and none is recorded for yours, so anything shown here would be invented.
        </p>
      </div>
    </div>
  );
}
