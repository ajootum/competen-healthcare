/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-012 Translation & Localisation Engine — tracks asset translations into non-English locales
// (cap_asset_translations, migration 137). Computes locale coverage and status distribution on read.
// English is the source; a record marks an asset's translation into a target locale and its status.

const NONE = "00000000-0000-0000-0000-000000000000";

export const LOCALES = [
  { key: "fr", label: "French" }, { key: "es", label: "Spanish" }, { key: "ar", label: "Arabic" }, { key: "sw", label: "Swahili" },
  { key: "pt", label: "Portuguese" }, { key: "zh", label: "Chinese" }, { key: "hi", label: "Hindi" }, { key: "de", label: "German" }, { key: "other", label: "Other" },
];
export const LOCALE_LABEL: Record<string, string> = Object.fromEntries(LOCALES.map(l => [l.key, l.label]));
export const TR_ASSET_TYPES = [
  { key: "framework", label: "Framework" }, { key: "competency", label: "Competency" }, { key: "skill", label: "Skill" }, { key: "blueprint", label: "Blueprint" },
  { key: "question_bank", label: "Question bank" }, { key: "osce", label: "OSCE" }, { key: "simulation", label: "Simulation" },
  { key: "learning_resource", label: "Learning resource" }, { key: "policy", label: "Policy" }, { key: "guideline", label: "Guideline" }, { key: "other", label: "Other" },
];
export const TR_TYPE_LABEL: Record<string, string> = Object.fromEntries(TR_ASSET_TYPES.map(t => [t.key, t.label]));
export const TR_STATUS = [
  { key: "not_started", label: "Not started", color: "#cbd5e1" }, { key: "in_progress", label: "In progress", color: "#f59e0b" },
  { key: "review", label: "Review", color: "#8b5cf6" }, { key: "published", label: "Published", color: "#10b981" },
];
export const TR_STATUS_LABEL: Record<string, string> = Object.fromEntries(TR_STATUS.map(s => [s.key, s.label]));
export const TR_STATUS_COLOR: Record<string, string> = Object.fromEntries(TR_STATUS.map(s => [s.key, s.color]));

export type Translation = { id: string; assetType: string; typeLabel: string; assetLabel: string; locale: string; localeLabel: string; status: string; translator: string | null };

export async function loadTranslations(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cap_asset_translations").select("id, asset_type, asset_label, locale, status, translator_name, created_at").order("created_at", { ascending: false }).limit(5000));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];

  const translations: Translation[] = rows.map(r => ({
    id: r.id, assetType: r.asset_type, typeLabel: TR_TYPE_LABEL[r.asset_type] ?? r.asset_type,
    assetLabel: r.asset_label, locale: r.locale, localeLabel: LOCALE_LABEL[r.locale] ?? r.locale,
    status: r.status, translator: r.translator_name,
  }));

  const localeDist = LOCALES.map(l => ({ key: l.key, label: l.label, n: rows.filter(r => r.locale === l.key).length, published: rows.filter(r => r.locale === l.key && r.status === "published").length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const statusDist = TR_STATUS.map(s => ({ key: s.key, label: s.label, color: s.color, n: rows.filter(r => r.status === s.key).length })).filter(x => x.n > 0);

  return {
    provisioned: true as const,
    empty: rows.length === 0,
    kpis: {
      total: rows.length,
      locales: localeDist.length,
      published: rows.filter(r => r.status === "published").length,
      inProgress: rows.filter(r => r.status === "in_progress" || r.status === "review").length,
    },
    localeDist, statusDist, translations,
  };
}
