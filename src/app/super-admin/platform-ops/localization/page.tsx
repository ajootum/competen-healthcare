import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { localizationCatalogue, localeBundle } from "@/lib/platform/localization";

export const dynamic = "force-dynamic";

// Localization Resource Service console (PFS-000 Localization) — the locale catalogue
// with coverage, and a live preview of any locale's resolved resource bundle (with
// base-locale fallback + RTL handling).

const card = "bg-white rounded-xl border border-gray-200";

export default async function LocalizationConsole({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const preview = typeof sp.locale === "string" ? sp.locale : "fr";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const cat = localizationCatalogue();
  const bundle = localeBundle(preview);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🌐</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Localization Service</h1><p className="text-sm text-gray-500">Locale catalogue, resource bundles and translation coverage across the platform.</p></div></div>
        <Link href="/super-admin/platform-ops" className="text-xs text-teal-700 hover:underline shrink-0">← Platform Operations</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">Locales</p><p className="text-2xl font-bold text-gray-900 mt-0.5">{cat.locales.length}</p><p className="text-[10px] text-gray-400">Supported</p></div>
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">Base Keys</p><p className="text-2xl font-bold text-gray-900 mt-0.5">{cat.totalKeys}</p><p className="text-[10px] text-gray-400">In {cat.namespaces.length} namespaces</p></div>
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">Base Locale</p><p className="text-2xl font-bold text-gray-900 mt-0.5 uppercase">{cat.baseLocale}</p><p className="text-[10px] text-gray-400">Fallback source</p></div>
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">RTL Locales</p><p className="text-2xl font-bold text-gray-900 mt-0.5">{cat.locales.filter(l => l.dir === "rtl").length}</p><p className="text-[10px] text-gray-400">Right-to-left</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Locale Coverage</h3>
          <div className="space-y-2.5">{cat.locales.map(l => (
            <div key={l.code} className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-gray-700 flex items-center gap-1.5"><span className="font-mono text-[10px] bg-gray-100 rounded px-1">{l.code}</span>{l.native}{l.dir === "rtl" && <span className="text-[9px] text-violet-600">RTL</span>}{l.base && <span className="text-[9px] text-teal-600">base</span>}</span>
                <span className="text-gray-400">{l.translatedKeys}/{cat.totalKeys} · {l.coverage}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${l.coverage >= 100 ? "bg-green-500" : l.coverage >= 60 ? "bg-teal-500" : l.coverage >= 30 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${l.coverage}%` }} /></div>
            </div>
          ))}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900">Resource Bundle Preview</h3>
            <div className="flex gap-1 flex-wrap">{cat.locales.map(l => <Link key={l.code} href={`/super-admin/platform-ops/localization?locale=${l.code}`} className={`text-[10px] px-2 py-0.5 rounded-full ${bundle.locale.code === l.code ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{l.code}</Link>)}</div>
          </div>
          <div className="overflow-x-auto" dir={bundle.locale.dir}>
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 pr-3 font-medium" dir="ltr">Key</th><th className="py-1.5 pr-3 font-medium">{bundle.locale.native}</th><th className="py-1.5 font-medium" dir="ltr">Source</th></tr></thead>
              <tbody>
                {bundle.entries.map(e => (
                  <tr key={e.key} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-500" dir="ltr">{e.key}</td>
                    <td className="py-1.5 pr-3 text-gray-800">{e.value}</td>
                    <td className="py-1.5" dir="ltr">{e.translated ? <span className="text-green-600 text-[10px]">translated</span> : <span className="text-amber-500 text-[10px]">fallback</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Localization Resource Service (PFS-000 Localization) provides the i18n layer the conformance map flagged as missing: a locale catalogue (name, native name, text direction, formats), namespaced resource bundles, and a resolver with base-locale fallback and <code>{"{var}"}</code> interpolation, plus measured coverage per locale. Bundles are a code-defined seed set that grows; a translation-management workflow (import/export, professional translation, per-tenant overrides) is an honest next-phase gap. Tenant language/timezone/currency selection already exists and resolves through this service.</p>
    </div>
  );
}
