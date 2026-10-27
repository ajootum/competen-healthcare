// ── COMPETEN-DESIGN-SYSTEM-01 s4: THE GOVERNED PART OF PRODUCT PRESENTATION ────────────────────────────────
//
// One CONFIG-002 document in the Individual policy scope (platform / individual), drafted, published as a version
// and rolled back through the existing Workspace Configuration Engine (src/lib/config/workspace-config-write.ts)
// behind /api/hq/individual/config (hq.individual.config.manage), exactly as the LCPD and Documents documents are.
// No new engine, capability or migration. Unpublished or unreadable means the code defaults (product-themes.ts).
//
// ⚠ WHAT AN ADMINISTRATOR MAY CHANGE, AND WHAT THEY MAY NOT. Per Individual destination (Individual, Scholar,
// Professional): the role line, the one-sentence description, the action label, and the icon from a fixed set.
// NOT the product NAME (it is bound to the operating entity, the terms and the legal pages, which this door cannot
// reach) and NOT the COLOUR (the approved palette is tokens.ts productTheme, pinned for AA contrast by
// scripts/design-system-themes-harness.ts and changed only through review). Platform and Practice presentation
// are outside this door's remit and stay as code defaults.
//
// ⚠ PRESENTATION ONLY. Nothing here can add, remove, order or select a destination; the server resolver
// (COMP-ID-ROUTE-001) alone decides those.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { PRODUCT_PRESENTATION, type ProductIcon, type ProductPresentation } from "./product-themes";

export const PRESENTATION_PATH = "individual.presentation";
export const EDITABLE_PRODUCTS = ["individual", "scholar", "professional"] as const;
export type EditableProduct = (typeof EDITABLE_PRODUCTS)[number];
export const PRODUCT_ICONS: readonly ProductIcon[] = ["building", "person", "stethoscope", "book", "briefcase"];

export type PresentationEdit = { role: string; description: string; action: string; icon: ProductIcon };
export type PresentationConfig = Record<EditableProduct, PresentationEdit>;

const LIMITS = { role: [3, 60], description: [10, 200], action: [3, 40] } as const;

export const DEFAULT_PRESENTATION: PresentationConfig = Object.fromEntries(
  EDITABLE_PRODUCTS.map(k => {
    const p = PRODUCT_PRESENTATION[k];
    return [k, { role: p.role, description: p.description, action: p.action, icon: p.icon }];
  }),
) as PresentationConfig;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Pure: a draft from HQ, validated whole. Unknown products and fields are refused, not ignored. */
export function checkPresentationDraft(input: any): { ok: true; settings: PresentationConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "The presentation draft is not readable." };
  const extra = Object.keys(input).filter(k => !(EDITABLE_PRODUCTS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `Only Competen Individual, Scholar and Professional can be presented here (not ${extra.join(", ")}).` };
  const out = {} as PresentationConfig;
  for (const k of EDITABLE_PRODUCTS) {
    const e = input[k] ?? DEFAULT_PRESENTATION[k];
    if (!e || typeof e !== "object") return { ok: false, error: `${PRODUCT_PRESENTATION[k].name}: the entry is not readable.` };
    const unknown = Object.keys(e).filter(f => !["role", "description", "action", "icon"].includes(f));
    if (unknown.length) return { ok: false, error: `${PRODUCT_PRESENTATION[k].name}: ${unknown.join(", ")} cannot be configured here (names and colours are fixed).` };
    const row = { role: clean(e.role), description: clean(e.description), action: clean(e.action), icon: e.icon };
    for (const f of ["role", "description", "action"] as const) {
      const [min, max] = LIMITS[f];
      if (row[f].length < min || row[f].length > max) return { ok: false, error: `${PRODUCT_PRESENTATION[k].name}: the ${f} must be ${min} to ${max} characters.` };
      if (/[<>]/.test(row[f])) return { ok: false, error: `${PRODUCT_PRESENTATION[k].name}: the ${f} cannot contain < or >.` };
    }
    if (!PRODUCT_ICONS.includes(row.icon)) return { ok: false, error: `${PRODUCT_PRESENTATION[k].name}: choose an icon from the approved set.` };
    out[k] = row as PresentationEdit;
  }
  return { ok: true, settings: out };
}

/** Pure: a stored value, with anything unreadable falling back to the default for that product. Never throws. */
export function resolvePresentation(raw: any): PresentationConfig {
  const out = { ...DEFAULT_PRESENTATION };
  if (!raw || typeof raw !== "object") return out;
  for (const k of EDITABLE_PRODUCTS) {
    const one = checkPresentationDraft({ ...DEFAULT_PRESENTATION, [k]: raw[k] ?? DEFAULT_PRESENTATION[k] });
    if (one.ok) out[k] = one.settings[k];
  }
  return out;
}

/** The PUBLISHED presentation. Unreadable or unpublished: the defaults. Never throws. */
export async function loadPresentationConfig(admin: any): Promise<PresentationConfig> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", PRESENTATION_PATH).maybeSingle();
    return error ? DEFAULT_PRESENTATION : resolvePresentation(data?.published ?? null);
  } catch { return DEFAULT_PRESENTATION; }
}

/** A destination's presentation with the published edits laid over the code default. Name and theme never change. */
export function presentWith(code: string, cfg: Partial<PresentationConfig> | null | undefined, base: ProductPresentation): ProductPresentation {
  const edit = cfg && (EDITABLE_PRODUCTS as readonly string[]).includes(code) ? cfg[code as EditableProduct] : undefined;
  return edit ? { ...base, role: edit.role, description: edit.description, action: edit.action, icon: edit.icon } : base;
}
