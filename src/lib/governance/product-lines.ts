// PLAT-GOV-001 section 2 - the frozen product taxonomy.
//
// ⚠ THIS IS NOT plat_products, AND THE DIFFERENCE IS THE WHOLE POINT OF THE SPEC. `plat_products` is the
// ENGINE catalogue - competency, mclip, lms, simulation, passport, coe, pce, practice - with eight rows and
// eleven readers across control-plane, licensing, feature flags and portfolio. GOV-001 section 2 lists that
// layer as "platform engines" and lists the four SaaS PRODUCT LINES separately. The word "practice" appears
// in both and means a module in one and a product line in the other.
//
// ⚠ AND "Competen Platform" IS A FOUNDATION, NOT A PRODUCT (section 2, restated by section 18 step 1). It
// is in this list so that the distinction is expressible rather than implied by absence.
//
// Pure module. Mirrored by migration 281, and the harness asserts the two agree in both directions - the
// same discipline HQ_CAPABILITIES follows against migration 264. If they disagree the database wins for
// storage and THIS list wins for behaviour, because code that has never heard of a row cannot act on it.

export const PRODUCT_LINES: {
  code: string;
  name: string;
  classification: "saas_product" | "foundation";
}[] = [
  { code: "platform",    name: "Competen Platform",    classification: "foundation" },
  { code: "enterprise",  name: "Competen Enterprise",  classification: "saas_product" },
  { code: "individual",  name: "Competen Individual",  classification: "saas_product" },
  { code: "practice",    name: "Competen Practice",    classification: "saas_product" },
  { code: "recruitment", name: "Competen Recruitment", classification: "saas_product" },
];

export const PRODUCT_LINE_CODES = PRODUCT_LINES.map(p => p.code);

/** The four SaaS lines, excluding the foundation. GOV-MC-001 section 15: HQ shows exactly these. */
export const SAAS_PRODUCT_LINES = PRODUCT_LINES.filter(p => p.classification === "saas_product");

export const productLine = (code: string | null | undefined) =>
  code ? PRODUCT_LINES.find(p => p.code === code) ?? null : null;

/**
 * ⚠ ROLES AND WORKSPACES ARE NOT PRODUCTS - GOV-001 section 2, and section 18 step 2 is the migration of
 * exactly this mistake. Healthcare Worker, Educator, Assessor, Nursing Director and Hospital Admin are
 * workspaces within a product, and HQ must not render them as if they were product lines
 * (GOV-MC-001 section 5). Kept as data so a harness can assert none of them leaks into the product list.
 */
export const NOT_PRODUCT_LINES = [
  "healthcare_worker", "educator", "assessor", "nursing_director", "hospital_admin",
  "unit_manager", "practice_administrator", "shift_supervisor",
];
