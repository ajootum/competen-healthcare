import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import PreferencesForm from "./PreferencesForm";

const COOKIE = "pw_prefs"; // keep in sync with /api/preferences

// PW-012 Preferences & Personal Configuration — tabbed personal settings backed by a per-browser cookie
// (pw_prefs) via /api/preferences (genuinely persistent). General tab shows real profile values; the rest are
// functional saved preferences. Cross-device sync + full theming are honestly labelled progressive.
export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, role, email, specialization").eq("id", user.id).single();

  const store = await cookies();
  let prefs: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { prefs = JSON.parse(store.get(COOKIE)?.value ?? "{}"); } catch { prefs = {}; }

  const summary = [
    { label: "Theme", value: prefs.theme ?? "system" },
    { label: "Density", value: prefs.density ?? "standard" },
    { label: "Email digest", value: prefs.emailDigest ?? "daily" },
    { label: "Time zone", value: prefs.timezone ?? "Africa/Nairobi" },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold text-[var(--cmp-text-information)] uppercase tracking-wide">Personal Workspace</p>
        <h1 className="text-2xl font-bold text-gray-900">Preferences &amp; Personal Configuration</h1>
        <p className="text-sm text-gray-500 mt-0.5">Customise your experience, notifications, themes, language and workspace preferences.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <PreferencesForm initial={prefs} profile={{ name: profile?.full_name ?? "User", role: (profile?.role ?? "nurse").replace(/_/g, " "), email: profile?.email ?? user.email ?? "—", specialization: profile?.specialization ?? null }} />

        {/* Right rail */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Configuration</h3>
            <div className="space-y-1.5 text-[13px]">
              <Link href="/dashboard/billing" className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-gray-700 hover:bg-gray-50">👤 Edit profile</Link>
              <Link href="/dashboard/launcher" className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-gray-700 hover:bg-gray-50">🧭 Default workspace</Link>
              <Link href="/dashboard/notifications" className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-gray-700 hover:bg-gray-50">🔔 Notification centre</Link>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Your Configuration</h3>
            <dl className="space-y-2 text-[12px]">
              {summary.map(s => (
                <div key={s.label} className="flex items-center justify-between"><dt className="text-gray-400">{s.label}</dt><dd className="text-gray-800 font-medium capitalize">{s.value}</dd></div>
              ))}
              <div className="flex items-center justify-between pt-1 border-t border-gray-100"><dt className="text-gray-400">Profile</dt><dd><Link href="/dashboard/profile" className="text-[var(--cmp-text-information)] font-medium hover:underline">View →</Link></dd></div>
            </dl>
          </div>

          <div className="bg-[var(--cmp-surface-information)]/60 rounded-xl border border-[var(--cmp-color-information)] p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Need Help?</h3>
            <p className="text-[12px] text-gray-600 mb-2">Learn more about customising your workspace.</p>
            <a href="mailto:gabriel@semacast.com?subject=Competen preferences help" className="text-[12px] font-medium text-[var(--cmp-text-information)] hover:underline">Contact support →</a>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Preferences persist in this browser. Cross-device sync, import/export, full theming and accessibility application require a server-side preference store (progressive).</p>
    </div>
  );
}
