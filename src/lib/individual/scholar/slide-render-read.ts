import type { IndividualContext } from "../guard";
import { BUCKET } from "./config";
import { renderRowOf, type RenderRow } from "./slide-render";

// SCHOLAR-VISUAL-001 phase 2: reading what has been drawn. Owner-only, by the caller's own id. No engine, so every visuals read stays light.

const TABLE = "individual_scholar_material_render";

/** The record for a material. Null when there is none, the table is absent (1010 not applied), or it cannot be read. */
export async function readRender(ctx: Pick<IndividualContext, "admin" | "userId">, materialId: string): Promise<RenderRow | null> {
  const { data, error } = await ctx.admin.from(TABLE).select("*").eq("user_id", ctx.userId).eq("material_id", materialId).maybeSingle();
  if (error) return null;
  return renderRowOf(data);
}

/** One drawn slide's stored image, exactly as stored. Its path comes from the caller's own row, never from the request. */
export async function readDrawnSlide(ctx: Pick<IndividualContext, "admin" | "userId">, materialId: string, n: number, sha: string): Promise<Uint8Array | null> {
  const row = await readRender(ctx, materialId);
  const unit = row?.units.find(u => u.n === n && u.sha === sha);
  if (!unit || !unit.path.startsWith(`${ctx.userId}/`)) return null;
  const { data, error } = await ctx.admin.storage.from(BUCKET).download(unit.path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
