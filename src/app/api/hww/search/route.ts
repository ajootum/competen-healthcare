import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { commandSearch } from "@/lib/hww/command-search";
import { resolveHwwNavigation } from "@/lib/hww/navigation";
import { orgRolesOf } from "@/lib/roles";

// Command palette search (HWW-UI-005 s18).
//
// Scope is the caller's own, always: commandSearch resolves their active patient assignments and
// constrains every record query to that list. This route adds no widening of its own -- there is
// deliberately no ?hospital= or ?all= parameter, because the moment one exists it will be passed.
//
// Modules are resolved through the SAME navigation engine as the sidebar, so a module a hospital has
// disabled through the WCE is not findable here either.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  const q = new URL(req.url).searchParams.get("q") ?? "";
  // Below two characters the result set is noise, and every keystroke would run five queries.
  if (q.trim().length < 2) return NextResponse.json({ hits: [], scopedPatients: 0, truncated: false });

  // org_role AND org_roles: orgRolesOf reads both, and selecting only one would silently narrow the
  // professions a nurse resolves to, hiding modules from the palette that their sidebar shows.
  const { data: profile } = await c.admin.from("profiles").select("role, roles, org_role, org_roles").eq("id", c.userId).maybeSingle();
  const nav = await resolveHwwNavigation(c.admin, {
    roles: c.roles,
    professions: orgRolesOf(profile as any).filter(Boolean) as string[],
  }).catch(() => ({ sections: [] as any[] }));

  const modules = (nav.sections ?? []).flatMap((s: any) =>
    s.entries.flatMap((e: any) => ("item" in e ? [e.item] : e.items)));

  const results = await commandSearch(c.admin, c.userId, q, modules);
  return NextResponse.json(results);
}
