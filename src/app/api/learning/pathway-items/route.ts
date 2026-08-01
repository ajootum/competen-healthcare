import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { currentTraceId } from "@/lib/trace";
import { getCaller, isResponse, requireRole, EDUCATOR_ROLES, assertProfileScope, badRequest } from "@/lib/api-auth";

// Learning pathway items (XWI P2-8).
//
// PATCH — the learner moves their OWN item. Self-attested completion stays allowed: reading a policy or
// watching a video genuinely is self-attested, and refusing to record it would push people outside the
// system rather than raise the standard. What changes is that the record now says WHICH it was, because
// gov-compliance publishes this column as a compliance percentage and could not previously tell a ticked
// box from a checked one.
//
// PUT — an educator verifies someone else's completed item. Deliberately a separate fact from the method:
// "the learner filed evidence" and "a second party checked" are different claims and are stored apart.

const METHODS = new Set(["self_attested", "evidence", "course", "assessment"]);

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, status, evidence_id, method } = await req.json();
  if (!id || !["pending", "in_progress", "completed"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }
  if (method && !METHODS.has(method)) return badRequest("Unknown completion method");

  const admin = createAdminClient();
  // Verify ownership: item's pathway must belong to this user
  const { data: item } = await admin
    .from("pathway_items")
    .select("id, pathway_id, competency_id, status, learning_pathways(nurse_id)")
    .eq("id", id)
    .single();
  const owner = (item?.learning_pathways as unknown as { nurse_id: string } | null)?.nurse_id;
  if (!item || owner !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = { status };

  if (status === "completed") {
    let resolved = method ?? "self_attested";
    let evId: string | null = null;
    if (evidence_id) {
      // The evidence must be the learner's own. Accepting an arbitrary id would let anyone dress a
      // self-attested tick as evidence-backed by quoting someone else's file -- which is worse than no
      // evidence at all, because the compliance number would then count it as assured.
      const { data: ev } = await admin.from("evidence").select("id, owner_id").eq("id", evidence_id).maybeSingle();
      if (!ev || ev.owner_id !== user.id) return NextResponse.json({ error: "Evidence not found for this user" }, { status: 404 });
      evId = ev.id as string;
      resolved = "evidence";
    }
    patch.completed_at = new Date().toISOString();
    patch.completion_method = resolved;
    patch.evidence_id = evId;
  } else {
    // Un-completing clears the provenance AND the verification. A stale "verified" on an item that is no
    // longer complete would be a standing false attestation, which is the failure this whole change is about.
    patch.completed_at = null;
    patch.completion_method = null;
    patch.evidence_id = null;
    patch.verified_by = null;
    patch.verified_at = null;
    patch.verification_note = null;
  }

  const { error } = await admin.from("pathway_items").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({
      error: /completion_method|completed_at|evidence_id|schema cache/i.test(error.message)
        ? "Run migration 183 to record learning completion provenance"
        : error.message,
    }, { status: 409 });
  }

  await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: user.id,
    action: status === "completed" ? "learning_item_completed" : "learning_item_reopened",
    entity_type: "pathway_item", entity_id: id,
    old_value: { status: item.status },
    new_value: { status, completion_method: patch.completion_method ?? null, evidence_id: patch.evidence_id ?? null },
  });

  return NextResponse.json({ ok: true, completion_method: patch.completion_method ?? null });
}

// PUT — educator/assessor verification of a completed item.
export async function PUT(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const denied = requireRole(c, EDUCATOR_ROLES);
  if (denied) return denied;

  const { id, note, revoke } = await req.json();
  if (!id) return badRequest("id required");

  const { data: item } = await c.admin
    .from("pathway_items")
    .select("id, status, learning_pathways(nurse_id)")
    .eq("id", id)
    .single();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const learner = (item.learning_pathways as unknown as { nurse_id: string } | null)?.nurse_id;
  const scoped = await assertProfileScope(c, learner ?? "");
  if (scoped) return scoped;

  // Verifying an item that is not complete would attest to something that has not happened.
  if (!revoke && item.status !== "completed") {
    return NextResponse.json({ error: "Only a completed item can be verified" }, { status: 409 });
  }

  const patch = revoke
    ? { verified_by: null, verified_at: null, verification_note: null }
    : { verified_by: c.userId, verified_at: new Date().toISOString(), verification_note: typeof note === "string" ? note.slice(0, 500) : null };

  const { error } = await c.admin.from("pathway_items").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json({
      error: /verified_by|verified_at|schema cache/i.test(error.message)
        ? "Run migration 183 to record learning verification"
        : error.message,
    }, { status: 409 });
  }

  await c.admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId,
    action: revoke ? "learning_item_verification_revoked" : "learning_item_verified",
    entity_type: "pathway_item", entity_id: id, new_value: { learner, note: patch.verification_note ?? null },
  });

  return NextResponse.json({ ok: true });
}
