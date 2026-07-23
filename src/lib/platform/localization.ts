// Localization Resource Service (PFS-000 Localization). The i18n resource layer the
// conformance map called out as missing: a locale catalogue (name, native name, text
// direction, formats), namespaced resource bundles, and a resolver with base-locale
// fallback + {var} interpolation and coverage reporting. Bundles live in code (a
// growing seed set — no store, so no migration); tenant language/timezone/currency
// selection already exists and this service is what resolves strings against it.

export type Locale = { code: string; name: string; native: string; dir: "ltr" | "rtl"; base?: boolean };

export const LOCALES: Locale[] = [
  { code: "en", name: "English", native: "English", dir: "ltr", base: true },
  { code: "en-GB", name: "English (UK)", native: "English (UK)", dir: "ltr" },
  { code: "fr", name: "French", native: "Français", dir: "ltr" },
  { code: "es", name: "Spanish", native: "Español", dir: "ltr" },
  { code: "ar", name: "Arabic", native: "العربية", dir: "rtl" },
];

export const NAMESPACES = ["common", "nav", "status", "action", "greeting"];

// Base bundle (English) — the source of truth every other locale falls back to.
const BASE: Record<string, string> = {
  "common.save": "Save", "common.cancel": "Cancel", "common.delete": "Delete", "common.edit": "Edit",
  "common.search": "Search", "common.loading": "Loading…", "common.confirm": "Confirm", "common.close": "Close",
  "nav.dashboard": "Dashboard", "nav.settings": "Settings", "nav.signOut": "Sign out", "nav.reports": "Reports",
  "status.active": "Active", "status.pending": "Pending", "status.completed": "Completed", "status.overdue": "Overdue",
  "action.approve": "Approve", "action.reject": "Reject", "action.submit": "Submit",
  "greeting.welcome": "Welcome, {name}",
};

// Translation overlays. Partial by design → coverage is measured, not assumed.
const BUNDLES: Record<string, Record<string, string>> = {
  en: BASE,
  "en-GB": { "common.loading": "Loading…", "nav.signOut": "Sign out" }, // spelling-identical here; overlay illustrates the mechanism
  fr: {
    "common.save": "Enregistrer", "common.cancel": "Annuler", "common.delete": "Supprimer", "common.edit": "Modifier",
    "common.search": "Rechercher", "common.loading": "Chargement…", "common.confirm": "Confirmer", "common.close": "Fermer",
    "nav.dashboard": "Tableau de bord", "nav.settings": "Paramètres", "nav.signOut": "Se déconnecter", "nav.reports": "Rapports",
    "status.active": "Actif", "status.pending": "En attente", "status.completed": "Terminé", "status.overdue": "En retard",
    "action.approve": "Approuver", "action.reject": "Rejeter", "action.submit": "Soumettre",
    "greeting.welcome": "Bienvenue, {name}",
  },
  es: {
    "common.save": "Guardar", "common.cancel": "Cancelar", "common.delete": "Eliminar", "common.edit": "Editar",
    "common.search": "Buscar", "common.loading": "Cargando…", "common.confirm": "Confirmar", "common.close": "Cerrar",
    "nav.dashboard": "Panel", "nav.settings": "Ajustes", "nav.signOut": "Cerrar sesión", "nav.reports": "Informes",
    "status.active": "Activo", "status.pending": "Pendiente", "status.completed": "Completado", "status.overdue": "Atrasado",
  },
  ar: {
    "common.save": "حفظ", "common.cancel": "إلغاء", "common.delete": "حذف", "common.edit": "تعديل",
    "common.search": "بحث", "common.confirm": "تأكيد",
    "nav.dashboard": "لوحة القيادة", "nav.settings": "الإعدادات", "nav.signOut": "تسجيل الخروج",
    "status.active": "نشط", "status.pending": "قيد الانتظار",
  },
};

const BASE_KEYS = Object.keys(BASE);

// Resolve a requested locale to the best-matching supported one (exact → language → base).
export function resolveLocale(requested?: string | null): Locale {
  if (!requested) return LOCALES[0];
  const r = requested.toLowerCase();
  return LOCALES.find(l => l.code.toLowerCase() === r)
    ?? LOCALES.find(l => l.code.toLowerCase().split("-")[0] === r.split("-")[0])
    ?? LOCALES[0];
}

// Translate a key for a locale, falling back to the base bundle, then the key itself.
export function translate(locale: string, key: string, vars?: Record<string, string | number>): string {
  const bundle = BUNDLES[locale] ?? {};
  const raw = bundle[key] ?? BASE[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_m, v) => (vars[v] != null ? String(vars[v]) : `{${v}}`)) : raw;
}

// Percentage of base keys a locale actually translates (base counts as 100%).
export function coverage(localeCode: string): number {
  if (localeCode === "en") return 100;
  const bundle = BUNDLES[localeCode] ?? {};
  const translated = BASE_KEYS.filter(k => bundle[k] != null && bundle[k] !== "").length;
  return BASE_KEYS.length ? Math.round((translated / BASE_KEYS.length) * 100) : 0;
}

// Whole-catalogue view for the console / API.
export function localizationCatalogue() {
  return {
    baseLocale: "en",
    totalKeys: BASE_KEYS.length,
    namespaces: NAMESPACES,
    locales: LOCALES.map(l => ({ ...l, coverage: coverage(l.code), translatedKeys: l.code === "en" ? BASE_KEYS.length : BASE_KEYS.filter(k => (BUNDLES[l.code] ?? {})[k]).length })),
  };
}

// Full resolved bundle for a locale (every base key, filled or fallen back).
export function localeBundle(localeCode: string) {
  const loc = resolveLocale(localeCode);
  const entries = BASE_KEYS.map(k => ({ key: k, value: translate(loc.code, k), translated: (BUNDLES[loc.code] ?? {})[k] != null }));
  return { locale: loc, entries };
}
