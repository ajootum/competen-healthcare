import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// QIE-003 — record whether an indicator is LEADING (a predictive signal) or LAGGING (an outcome measure).
//
// This is a governance judgement, not a calculation, which is why it is a write endpoint rather than an
// inference. Whether "PEWS Compliance" is predictive of deterioration or a record of process adherence
// changes which board the number appears on, and no amount of reading its name settles it.
//
// Admin-gated for the same reason: the classification determines how a hospital reads its own safety
// data, so it is not something any staff member should be able to flip.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CLASSES = ["leading", "lagging"];

// QIE-011 — no-code configuration, over the thresholds that ALREADY EXIST.
//
// The spec asks for a rule registry: indicator definitions, thresholds, escalation rules, scoring models.
// On this platform `target`, `threshold_amber` and `threshold_red` are columns on pa_kpis and they drive
// live dashboards today. A qie_rules table would be a second set of thresholds for the same indicators,
// and the day the two disagreed a hospital would have two answers about whether it was in breach.
//
// So the configuration is not rebuilt, it is EXPOSED. What was missing was never the storage; it was a
// surface a quality manager could use without a developer, which is what "no-code" actually means.
const numOrNull = (v: unknown): number | null | undefined => {
  if (v === null) return null;                         // explicit clear
  if (v === undefined) return undefined;               // not being changed
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export async function PUT(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const admin = c.admin as any;

  const { data: row } = await admin.from("pa_kpis")
    .select("id, hospital_id, name, direction, target, threshold_amber, threshold_red").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const patch: any = {};
  for (const k of ["target", "threshold_amber", "threshold_red"] as const) {
    const v = numOrNull(b[k]);
    if (v !== undefined) patch[k] = v;
  }
  if (!Object.keys(patch).length) return badRequest("nothing to change");

  // THRESHOLDS MUST ORDER THE WAY THE INDICATOR READS, or the status calculation silently inverts.
  // For lower_better, red is the HIGHER number (worse); for higher_better, red is the LOWER one. Saving a
  // pair the wrong way round would not error -- it would just quietly stop reporting breaches.
  const merged = { ...row, ...patch };
  const amber = merged.threshold_amber, red = merged.threshold_red;
  if (typeof amber === "number" && typeof red === "number") {
    const lowerBetter = row.direction === "lower_better";
    const ordered = lowerBetter ? red >= amber : red <= amber;
    if (!ordered) {
      return NextResponse.json({
        error: lowerBetter
          ? "For a lower-is-better indicator the red threshold must be at or above amber — otherwise a breach can never be reached."
          : "For a higher-is-better indicator the red threshold must be at or below amber — otherwise a breach can never be reached.",
        thresholdOrder: true,
      }, { status: 422 });
    }
  }

  const { data, error } = await admin.from("pa_kpis").update(patch).eq("id", id)
    .select("id, name, target, threshold_amber, threshold_red").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: "indicator_thresholds_changed",
    entity_type: "pa_kpis", entity_id: id, entity_name: row.name, hospital_id: row.hospital_id,
    old_value: { target: row.target, threshold_amber: row.threshold_amber, threshold_red: row.threshold_red },
    new_value: patch,
  });
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  // null is a legitimate value: un-classifying is how you say "we got that wrong" without inventing the
  // opposite answer.
  if (b.indicator_class !== null && !CLASSES.includes(b.indicator_class)) {
    return badRequest(`indicator_class must be null, ${CLASSES.join(" or ")}`);
  }
  const admin = c.admin as any;

  const { data: row } = await admin.from("pa_kpis").select("id, hospital_id, name, indicator_class").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await admin.from("pa_kpis").update({
    indicator_class: b.indicator_class,
    classified_by: b.indicator_class ? c.userId : null,
    classified_at: b.indicator_class ? new Date().toISOString() : null,
  }).eq("id", id).select("id, name, indicator_class").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: "indicator_classified",
    entity_type: "pa_kpis", entity_id: id, entity_name: row.name, hospital_id: row.hospital_id,
    old_value: { indicator_class: row.indicator_class }, new_value: { indicator_class: b.indicator_class },
  });
  return NextResponse.json(data);
}
