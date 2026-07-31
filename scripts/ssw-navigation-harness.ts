// One-off harness for the config-driven SSW navigation (SSW-001-R2 Ch.3-13).
// Exercises the SHIPPED resolver (@/lib/ssw/navigation) against the REAL WCE
// override store, and audits the catalogue against the REAL route tree:
//   - every catalogue href resolves to a page that exists on disk (no dead links)
//   - every built supervisor page is reachable from the sidebar (no orphans)
//   - no two entries point at the same destination (no label-only duplicates)
//   - with no overrides the sidebar equals the shipped catalogue (fail-soft)
//   - a hospital-scope override HIDES a module without a deployment
//   - a role-scope override RENAMES and REORDERS a module
//   - disabling a SECTION removes its whole subtree
//   - the WCE Designer catalogue matches the nav catalogue exactly (no drift)
// Every override it writes is deleted afterwards.
//   npx --yes tsx scripts/ssw-navigation-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const APP = path.join(process.cwd(), "src", "app", "supervisor");

// Every static route segment under /supervisor that renders a page. Dynamic
// segments ([id], [section]) are excluded: they are not sidebar destinations.
function builtRoutes(): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(APP, "page.tsx"))) out.push("/supervisor");
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
      const child = path.join(dir, entry.name);
      const route = `${prefix}/${entry.name}`;
      if (fs.existsSync(path.join(child, "page.tsx"))) out.push(route);
      walk(child, route);
    }
  };
  walk(APP, "/supervisor");
  return out.sort();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { resolveSswNavigation, SSW_NAV_CATALOGUE, SSW_SECTIONS, SSW_CONFIG_PREFIX } = await import("../src/lib/ssw/navigation");
  const { WORKSPACE_CATALOG } = await import("../src/lib/config/workspace-catalog");

  const flat = (nav: any) => nav.sections.flatMap((s: any) => s.items);
  const find = (nav: any, k: string) => flat(nav).find((i: any) => i.key === k) ?? null;
  const ctx = { hospitalId: null as string | null, roles: ["assessor"], userId: null };

  // ── 1. Route audit: catalogue vs the real app tree ────────────────────────
  const routes = new Set(builtRoutes());
  const linked = SSW_NAV_CATALOGUE.filter(r => r.href).map(r => r.href!.split(/[?#]/)[0]);
  const dead = [...new Set(linked)].filter(h => !routes.has(h));
  check(dead.length === 0, "every catalogue href resolves to a built page", dead.length ? `dead: ${dead.join(", ")}` : `${linked.length} links`);

  const orphans = [...routes].filter(r => !linked.includes(r));
  check(orphans.length === 0, "every built supervisor page is reachable from the sidebar", orphans.length ? `orphaned: ${orphans.join(", ")}` : `${routes.size} routes`);

  const hrefs = SSW_NAV_CATALOGUE.filter(r => r.href).map(r => r.href!);
  const dupes = [...new Set(hrefs.filter((h, i) => hrefs.indexOf(h) !== i))];
  check(dupes.length === 0, "no two entries point at the same destination", dupes.length ? `duplicated: ${dupes.join(", ")}` : "all distinct");

  // An in-page anchor is only a distinct destination if the target id exists.
  // Search the whole route folder, not just page.tsx — most of these pages
  // render their sections from sibling client components.
  const badAnchors = hrefs.filter(h => h.includes("#")).filter(h => {
    const [route, hash] = h.split("#");
    const dir = path.join(process.cwd(), "src", "app", route.replace(/^\//, ""));
    if (!fs.existsSync(dir)) return true;
    return !fs.readdirSync(dir).filter(f => f.endsWith(".tsx"))
      .some(f => new RegExp(`id="${hash}"`).test(fs.readFileSync(path.join(dir, f), "utf8")));
  });
  check(badAnchors.length === 0, "every #anchor link targets a real id on that page",
    badAnchors.length ? badAnchors.join(", ") : `${hrefs.filter(h => h.includes("#")).length} anchors`);

  const soonWithHref = SSW_NAV_CATALOGUE.filter(r => r.soon && r.href);
  check(soonWithHref.length === 0, "'soon' entries carry no href (muted, never a dead link)", `${SSW_NAV_CATALOGUE.filter(r => r.soon).length} muted`);

  const badSection = SSW_NAV_CATALOGUE.filter(r => r.section && !SSW_SECTIONS.some(s => s.label === r.section));
  check(badSection.length === 0, "every entry belongs to a declared section", badSection.map(r => r.key).join(", "));

  const badKey = SSW_NAV_CATALOGUE.filter(r => r.section && !SSW_SECTIONS.some(s => r.key.startsWith(`${s.key}.`)));
  check(badKey.length === 0, "config keys are prefixed with their section key", badKey.map(r => r.key).join(", "));

  const dupKeys = SSW_NAV_CATALOGUE.map(r => r.key).filter((k, i, a) => a.indexOf(k) !== i);
  check(dupKeys.length === 0, "config keys are unique", dupKeys.join(", "));

  // ── 2. WCE Designer catalogue must not drift from the nav catalogue ───────
  const ws = WORKSPACE_CATALOG.find((w: any) => w.key === "supervisor");
  check(!!ws && ws.wired === true, "supervisor workspace is marked WIRED in the Designer catalogue");
  const designerPaths = (ws?.sections ?? []).flatMap((s: any) => s.modules.map((m: any) => m.path)).sort();
  const navPaths = SSW_NAV_CATALOGUE.filter(r => r.section).map(r => `${SSW_CONFIG_PREFIX}.${r.key}`).sort();
  check(JSON.stringify(designerPaths) === JSON.stringify(navPaths), "Designer module paths == nav catalogue paths", `${designerPaths.length} modules`);
  const designerSections = (ws?.sections ?? []).map((s: any) => s.path).sort();
  const navSections = SSW_SECTIONS.map(s => `${SSW_CONFIG_PREFIX}.${s.key}`).sort();
  check(JSON.stringify(designerSections) === JSON.stringify(navSections), "Designer sections == nav sections", `${designerSections.length} sections`);

  // ── 3. Live resolution against the real override store ───────────────────
  const { data: hosp } = await admin.from("hospitals").select("id").limit(1).maybeSingle();
  const hid = hosp?.id ?? null;
  const written: { scope_type: string; scope_ref: string | null; config_path: string }[] = [];
  const putOverride = async (scope_type: string, scope_ref: string | null, cfgPath: string, published: any) => {
    const row = { hospital_id: scope_type === "hospital" ? scope_ref : null, scope_type, scope_ref, config_path: cfgPath, draft: published, published };
    const { error } = await admin.from("workspace_config_overrides").upsert(row, { onConflict: "scope_type,scope_ref,config_path" });
    if (error) throw new Error(`${cfgPath}: ${error.message}`);
    written.push({ scope_type, scope_ref, config_path: cfgPath });
  };

  try {
    const base = await resolveSswNavigation(admin, ctx);
    check(base.provisioned, "WCE override store answered (workspace_config_overrides present)");
    check(flat(base).length === SSW_NAV_CATALOGUE.length, "no overrides -> sidebar equals the shipped catalogue",
      `${flat(base).length} of ${SSW_NAV_CATALOGUE.length}`);
    check(base.sections[0]?.section === null && base.sections[0].items[0]?.href === "/supervisor", "Dashboard renders above the first section header");
    const orderedLabels = base.sections.slice(1).map((s: any) => s.section);
    const expectedLabels = SSW_SECTIONS.slice().sort((a, b) => a.order - b.order).map(s => s.label);
    check(JSON.stringify(orderedLabels) === JSON.stringify(expectedLabels), "sections render in declared order", orderedLabels.join(" > "));

    // Hospital-scope HIDE.
    if (hid) {
      await putOverride("hospital", hid, `${SSW_CONFIG_PREFIX}.resource-capacity.resources`, { enabled: false });
      const hidden = await resolveSswNavigation(admin, { ...ctx, hospitalId: hid });
      check(find(hidden, "resource-capacity.resources") === null, "hospital-scope override HIDES a module without a deployment");
      check(hidden.hidden.includes(`${SSW_CONFIG_PREFIX}.resource-capacity.resources`), "hidden module is reported in `hidden[]` (auditable, not silent)");
      const other = await resolveSswNavigation(admin, { ...ctx, hospitalId: "00000000-0000-0000-0000-000000000000" });
      check(find(other, "resource-capacity.resources") !== null, "the override does NOT leak to another hospital");
    } else {
      console.log("SKIP  hospital-scope override — no hospital rows");
    }

    // Role-scope RENAME + REORDER.
    await putOverride("role", "assessor", `${SSW_CONFIG_PREFIX}.clinical-coordination.concerns`, { enabled: true, label: "Raised Concerns", order: 601 });
    const renamed = await resolveSswNavigation(admin, ctx);
    check(find(renamed, "clinical-coordination.concerns")?.label === "Raised Concerns", "role-scope override RENAMES a module");
    const cc = renamed.sections.find((s: any) => s.section === "Clinical Coordination");
    check(cc?.items[0]?.key === "clinical-coordination.escalations" && cc?.items[1]?.key === "clinical-coordination.concerns",
      "role-scope `order` reorders within the section", cc?.items.map((i: any) => i.key).join(" > "));
    const otherRole = await resolveSswNavigation(admin, { ...ctx, roles: ["hospital_admin"] });
    check(find(otherRole, "clinical-coordination.concerns")?.label === "Nurse Concerns", "the rename does NOT leak to another role");

    // SECTION disable removes the whole subtree.
    await putOverride("role", "assessor", `${SSW_CONFIG_PREFIX}.ai-copilot`, { enabled: false });
    const noAi = await resolveSswNavigation(admin, ctx);
    check(!noAi.sections.some((s: any) => s.section === "AI Operational Copilot"), "disabling a SECTION removes its whole subtree");
    check(find(noAi, "ai-copilot.command-centre") === null, "the section's modules disappear with it");
    check(noAi.hidden.includes(`${SSW_CONFIG_PREFIX}.ai-copilot`), "the disabled section is reported in `hidden[]`");

    // Badge wiring: every badge key an entry references must exist in the layout.
    const layout = fs.readFileSync(path.join(APP, "layout.tsx"), "utf8");
    const badgeKeys = [...new Set(SSW_NAV_CATALOGUE.map(r => r.badge).filter(Boolean) as string[])];
    const unwired = badgeKeys.filter(k => !new RegExp(`\\b${k}:`).test(layout));
    check(unwired.length === 0, "every badge key an entry references is computed by the layout", unwired.length ? unwired.join(", ") : badgeKeys.join(", "));
  } finally {
    for (const w of written) {
      await admin.from("workspace_config_overrides").delete()
        .eq("scope_type", w.scope_type).eq("config_path", w.config_path)
        .filter("scope_ref", w.scope_ref === null ? "is" : "eq", w.scope_ref as any);
    }
    const { data: leftover } = await admin.from("workspace_config_overrides").select("config_path")
      .like("config_path", `${SSW_CONFIG_PREFIX}.%`);
    const stray = (leftover ?? []).filter((r: any) => written.some(w => w.config_path === r.config_path));
    check(stray.length === 0, "harness overrides cleaned up", stray.length ? `${stray.length} left` : `${written.length} removed`);
  }

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
