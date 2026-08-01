import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { RCA_CATEGORIES } from "@/lib/qie/root-cause";

// QIE-005/006 — root-cause investigations, and the handoff that makes them worth doing.
//
// An investigation that ends in a document is a document. The spec's whole architecture is
// event -> analysis -> RECOMMENDATION -> action -> learning, and the link that was missing on this
// platform is the one from a finding to something anybody has to do. So completing an investigation with
// a root cause OPENS A CAPA and records the link both ways: the CAPA cites the analysis that justified
// it, and the analysis names the action it produced.
//
// It is not automatic and not silent. Completing WITHOUT a root cause is allowed -- some investigations
// legitimately conclude "no single cause" -- and that case creates nothing rather than manufacturing an
// action to look productive.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const METHODS = ["fishbone", "five_whys", "swiss_cheese", "mixed"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("rca_investigations")
    .select("*, rca_factors(*), op_incidents!incident_id(incident_type, severity, description)")
    .order("opened_at", { ascending: false }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? NONE);
  const status = new URL(req.url).searchParams.get("status");
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ investigations: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.title?.trim()) return badRequest("title required");
  if (b.method && !METHODS.includes(b.method)) return badRequest(`method must be one of ${METHODS.join(", ")}`);
  const admin = c.admin as any;

  // The INCIDENT decides the tenant when there is one — the subject-vs-caller rule, which for a
  // super_admin with no hospital would otherwise file the analysis under no tenant at all.
  let hospitalId = c.hospitalId ?? null;
  if (b.incident_id) {
    const { data: inc } = await admin.from("op_incidents").select("hospital_id").eq("id", b.incident_id).maybeSingle();
    if (!inc) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    if (!isSuper(c) && inc.hospital_id !== c.hospitalId) return forbidden("Incident out of scope");
    hospitalId = inc.hospital_id ?? hospitalId;
  }

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const { data, error } = await admin.from("rca_investigations").insert({
    hospital_id: hospitalId, incident_id: b.incident_id ?? null,
    title: b.title.trim(), method: b.method ?? "fishbone",
    whys: Array.isArray(b.whys) ? b.whys.filter((w: unknown) => typeof w === "string").slice(0, 10) : [],
    opened_by: c.userId, opened_by_name: me?.full_name ?? null,
  }).select("id, incident_id").single();

  // The partial unique index refuses a second OPEN investigation for the same incident: two people
  // analysing one event in parallel produce two partial answers.
  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "An investigation for this incident is already open.", duplicate: true }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: "rca_opened", entity_type: "rca_investigations",
    entity_id: data.id, entity_name: b.title.trim(), hospital_id: hospitalId,
    new_value: { incident_id: data.incident_id, method: b.method ?? "fishbone" },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));

  const { data: row } = await admin.from("rca_investigations")
    .select("id, hospital_id, status, title, incident_id, capa_action_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const update: any = {};
  if (["open", "in_progress", "completed", "closed"].includes(b.status)) update.status = b.status;
  if (typeof b.root_cause_summary === "string") update.root_cause_summary = b.root_cause_summary.trim() || null;
  if (["high", "medium", "low"].includes(b.confidence)) update.confidence = b.confidence;
  if (Array.isArray(b.whys)) update.whys = b.whys.filter((w: unknown) => typeof w === "string").slice(0, 10);
  if (!Object.keys(update).length) return badRequest("no valid fields");

  // Completing is a claim that the analysis is done, so it has to have found something. An investigation
  // marked complete with no root-cause factor and no summary is a form somebody closed.
  if (update.status === "completed") {
    const { data: roots } = await admin.from("rca_factors").select("id, description, category").eq("investigation_id", id).eq("is_root_cause", true);
    const summary = update.root_cause_summary ?? (await admin.from("rca_investigations").select("root_cause_summary").eq("id", id).maybeSingle()).data?.root_cause_summary;
    if (!(roots ?? []).length && !summary) {
      return NextResponse.json({
        error: "Mark at least one contributing factor as a root cause, or write a summary, before completing.",
        needsFinding: true,
      }, { status: 422 });
    }
    update.completed_at = new Date().toISOString();
  }

  const { data, error } = await admin.from("rca_investigations").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── QIE-006 handoff: a finding becomes something somebody has to do ──────────
  let capa: { id: string } | null = null;
  if (update.status === "completed" && !row.capa_action_id) {
    const { data: roots } = await admin.from("rca_factors").select("description, category").eq("investigation_id", id).eq("is_root_cause", true);
    const causes = (roots ?? []) as any[];
    // No root cause found is a legitimate conclusion. It creates nothing rather than manufacturing an
    // action so the loop looks productive.
    if (causes.length) {
      const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
      const created = await admin.from("capa_actions").insert({
        hospital_id: row.hospital_id,
        title: `Corrective action: ${row.title}`.slice(0, 200),
        description: `Root cause${causes.length === 1 ? "" : "s"} identified by investigation "${row.title}": ${causes.map(f => `${f.category} — ${f.description}`).join("; ")}.`,
        priority: causes.length > 2 ? "high" : "medium",
        evidence_note: `Opened from root-cause investigation ${id}.`,
        created_by: c.userId, owner_id: c.userId, owner_name: me?.full_name ?? null,
      }).select("id").single();
      if (!created.error) {
        capa = created.data;
        await admin.from("rca_investigations").update({ capa_action_id: created.data.id }).eq("id", id);
      }
    }
  }

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: `rca_${update.status ?? "updated"}`,
    entity_type: "rca_investigations", entity_id: id, entity_name: row.title, hospital_id: row.hospital_id,
    new_value: { from: row.status, to: update.status ?? row.status, capa_created: capa?.id ?? null },
  });

  return NextResponse.json({ ...data, capa_action_id: capa?.id ?? data.capa_action_id ?? null, capa_created: !!capa });
}

// Contributing factors. Separate from the investigation because they are added throughout it, not at the
// end, and because a factor is the unit the fishbone and the category rollup are both built from.
export async function PUT(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.investigation_id || !b.description?.trim()) return badRequest("investigation_id and description required");
  if (!RCA_CATEGORIES.includes(b.category)) return badRequest(`category must be one of ${RCA_CATEGORIES.join(", ")}`);
  const admin = c.admin as any;

  const { data: inv } = await admin.from("rca_investigations").select("id, hospital_id").eq("id", b.investigation_id).maybeSingle();
  if (!inv) return NextResponse.json({ error: "Investigation not found" }, { status: 404 });
  if (!isSuper(c) && inv.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data, error } = await admin.from("rca_factors").insert({
    investigation_id: b.investigation_id, category: b.category, description: b.description.trim(),
    is_root_cause: !!b.is_root_cause, impact_rank: Number.isFinite(b.impact_rank) ? b.impact_rank : null,
    evidence_note: b.evidence_note?.trim() || null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
