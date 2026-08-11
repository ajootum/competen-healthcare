import type { WorkspaceContext } from "@/lib/practice/access";
import { CAP_RECORD } from "@/lib/practice/parameters-constants";
import { isMissingTable } from "@/lib/practice/investigations";
import {
  OFFLINE_PARAMETERS_MAX, projectOfflineParameter, projectOfflineParameterSet,
  type OfflineParameter, type OfflineParameterSet, type ParameterSource,
} from "@/lib/practice/offline-parameters";

// The SERVER half of the cached parameter definitions. See offline-parameters.ts for why this cache is
// the cheapest thing in the offline programme and why it is stored unsealed.
//
// ⚠ THE CAPABILITY IS `parameter.record`, NOT `parameter.view`, AND THAT IS DELIBERATELY STRICTER.
//
// The obvious choice is the read capability -- this is a list of definitions, and reading it is a read.
// But the ONLY reason a device holds this list is so somebody can record against it, and
// `recordMeasurement` demands `parameter.record`. Caching it for an account that cannot record would put
// a full, inviting picker on a device whose every capture is refused by the server DAYS LATER, with the
// patient long gone. A refusal at the point of caching costs nothing; a refusal after the trip costs the
// reading.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

const COLUMNS =
  "id, code, display_name, short_name, category, data_type, canonical_unit, permitted_units, "
  + "value_precision, min_plausible, max_plausible, options";

export type OfflineParametersResult =
  | { ok: true; set: OfflineParameterSet }
  | { ok: false; reason: string };

export async function offlineParametersPayload(
  admin: any, ctx: WorkspaceContext, opts: { at?: Date } = {},
): Promise<OfflineParametersResult> {
  if (!ctx.capabilities.includes(CAP_RECORD))
    return { ok: false, reason: "This account cannot record measurements, so the practice's measurement list is not stored on this device." };

  const at = opts.at ?? new Date();

  const { data, error } = await admin.from("practice_parameter_definition")
    .select(COLUMNS)
    // ⚠ BOTH SCOPES. A platform definition has a null workspace_id and `recordMeasurement` accepts it
    // (`def.workspace_id !== null && def.workspace_id !== ctx.workspaceId` is its refusal). Filtering to
    // the workspace alone would drop every shared definition -- which is most of them -- and the picker
    // would offer almost nothing.
    .or(`workspace_id.is.null,workspace_id.eq.${ctx.workspaceId}`)
    // ⚠ WELDED, BOTH OF THEM. See OFFLINE_PARAMETERS_ONLY_RECORDABLE: a retired parameter and a
    // calculated one are both REFUSED by recordMeasurement, so offering either offline means a reading
    // taken, believed recorded, and refused days later.
    .eq("status", "active")
    .neq("data_type", "calculated")
    .order("category", { ascending: true })
    .order("display_name", { ascending: true })
    .limit(OFFLINE_PARAMETERS_MAX + 1);

  if (isMissingTable(error))
    return { ok: false, reason: "Clinical parameters are not set up at this practice, so no measurement list is stored on this device." };
  // ⚠ A FAILED READ IS NEVER AN EMPTY LIST. An empty picker offline reads as "this practice measures
  // nothing", and the practitioner stops looking for the one they wanted.
  if (error || data == null)
    return { ok: false, reason: "The practice's measurement list could not be read just now, so it was not stored on this device." };

  const rows = data as ParameterSource[];
  const kept: OfflineParameter[] = rows.slice(0, OFFLINE_PARAMETERS_MAX).map(projectOfflineParameter);

  // ⚠ NO SILENT CAP. `+1` above is how we learn there were more without reading them all: a practitioner
  // who cannot find a parameter must be told the list is partial rather than concluding it does not exist.
  const dropped = rows.length > OFFLINE_PARAMETERS_MAX
    ? {
        count: rows.length - OFFLINE_PARAMETERS_MAX,
        reason: `This practice has more measurements than are held on this device. The first ${OFFLINE_PARAMETERS_MAX} are here; anything not listed can still be recorded once there is a connection.`,
      }
    : null;

  return {
    ok: true,
    set: projectOfflineParameterSet({
      workspaceId: ctx.workspaceId, asOf: at.toISOString(),
      parameters: kept, unavailable: false, dropped,
    }),
  };
}
