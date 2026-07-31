import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadTranslations } from "@/lib/studio/translations";
import TranslationManager from "./TranslationManager";

// CAP-012 — Translation & Localisation Engine. Tracks asset translations into non-English locales
// (cap_asset_translations, migration 137): register a translation, advance its status, and see locale
// coverage. English is the source language.

export const dynamic = "force-dynamic";

export default async function TranslationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const tr = await loadTranslations(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CAP-012 · Translation & Localisation</p>
          <h1 className="text-xl font-bold text-gray-900">Localisation Engine</h1>
          <p className="text-gray-400 text-sm mt-0.5">Track translations of competency assets into target locales — coverage, status and translators.</p>
        </div>
        <Link href="/super-admin/studio/assets" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Asset Repository</Link>
      </div>

      {!tr.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 137 (<code className="text-[11px]">cap_asset_translations</code>) to enable the Translation engine.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Translations", value: tr.kpis.total, tone: "text-gray-900" },
              { label: "Locales", value: tr.kpis.locales, tone: "text-gray-900" },
              { label: "Published", value: tr.kpis.published, tone: "text-teal-600" },
              { label: "In progress", value: tr.kpis.inProgress, tone: "text-[var(--cmp-text-warning)]" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {(tr.localeDist.length > 0 || tr.statusDist.length > 0) && (
            <div className="grid md:grid-cols-2 gap-5 mb-5">
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 text-sm mb-3">By locale</h2>
                {tr.localeDist.length === 0 ? <p className="text-xs text-gray-400">No translations yet.</p> : tr.localeDist.map(l => (
                  <div key={l.key} className="flex items-center gap-3 py-1.5 text-xs">
                    <span className="text-gray-600 w-24">{l.label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${tr.kpis.total ? Math.round((l.n / tr.kpis.total) * 100) : 0}%` }} /></div>
                    <span className="font-bold text-gray-700 w-8 text-right">{l.n}</span>
                    <span className="text-[10px] text-teal-600 w-20 text-right">{l.published} published</span>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="font-semibold text-gray-900 text-sm mb-3">By status</h2>
                {tr.statusDist.length === 0 ? <p className="text-xs text-gray-400">No translations yet.</p> : tr.statusDist.map(s => (
                  <div key={s.key} className="flex items-center gap-2.5 py-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-gray-600 flex-1">{s.label}</span>
                    <span className="font-bold text-gray-700">{s.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <TranslationManager translations={tr.translations} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Localisation tracking.</span> This records which assets are translated into which locales and their status. Storing the translated content itself, machine-translation drafting via the AI gateway and locale-aware asset delivery are the next-phase runtime.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
