import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { loadDirectory } from "@/app/super-admin/users/load-directory";
import { parseDirectoryFilters, queryDirectory } from "@/lib/hq/user-directory-query";
import { usersCsv } from "@/lib/hq/users-csv";

// HQ-USERS-CLASSIFY-01: "Export all filtered users". The Users screen now holds one page, so the CSV is built here
// from the same rows (load-directory.ts) and the same query (user-directory-query.ts) as the screen, for everyone
// who may open the screen (hq.platform.users.view) -- the same people the browser export served before.
export async function GET(req: Request) {
  const ctx = await hqApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;

  const dir = await loadDirectory(ctx.admin);
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { matched } = queryDirectory(dir.users, parseDirectoryFilters(sp, dir.defaultView), Date.now());

  return new Response(usersCsv(matched), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="competen-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
