// Enterprise shell constants. ⚠ THIS FILE MUST NEVER IMPORT -- the sync-appliers/entity-types.ts rule.
//
// ⚠ IT EXISTS BECAUSE THE TRAP NEARLY RECURRED THE SAME DAY IT WAS RECORDED. These constants began life
// inside enterprise-shell.ts, which imports @/lib/supabase/server, which imports next/headers. The
// harness imported ONE constant from there -- and an import pulls the MODULE, not the binding, which is
// exactly how /practice/offline answered 500 this morning with tsc, eslint and every harness green. A
// value shared between server code and anything else lives in a file with no imports, so there is no
// graph to reason about.

/**
 * ⚠ THE ONLY SUB-PRODUCTS WITH A SURFACE TODAY. Everything else in the catalogue renders disabled WITH
 * A REASON -- the house rule, because an empty space reads as broken and a hidden entry reads as absent
 * from the product. The harness asserts every code here exists in the live catalogue, because a typo
 * would render a nav link labelled Read-only that lands on nothing.
 */
export const ENTERPRISE_BUILT_SUBPRODUCTS: readonly string[] = ["workforce"] as const;

export const ENTERPRISE_NOT_BUILT_REASON =
  "Not switched on yet. It is listed so you can see what Competen Enterprise includes, not because it can be opened.";
