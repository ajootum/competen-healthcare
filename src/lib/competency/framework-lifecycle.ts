import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Governed framework lifecycle transition — the single source of truth for moving a framework through its
// pub_status lifecycle. Sets pub_status, snapshots full content into framework_versions on publish (with a
// version bump), opens a content_approvals record on submit-for-review, and audits every move. Shared by the
// framework lifecycle route (api/content/lifecycle) and the CAP-001 asset write-back (W3) so both go through
// exactly the same governed path — no raw pub_status pokes, no divergent copies.
//
// ⚠ HOLDINGS-GOVERNED FRAMEWORKS (migration 467, owner CENTRAL GOVERNANCE 26 Oct). A shared framework with a CFCA
// layer -- the 466 guard's own predicate -- is a centrally governed platform resource. It moves only through the
// Holdings Framework Publication path (framework-publication.ts: an independent hq.quality.competency.publish holder),
// which passes { holdings: true }. Every other caller is refused here, so the legacy estate routes cannot publish it.

export type FrameworkAction = "submit_review" | "publish" | "archive" | "revert";

export const FRAMEWORK_ACTION_STATUS: Record<FrameworkAction, string> = {
  submit_review: "in_review",
  publish: "published",
  archive: "archived",
  revert: "draft",
};

export type VersionLabel = { major: number; minor: number; revision: number };
export type TransitionOptions = {
  /** Set only by the Holdings publication path. */
  holdings?: boolean;
  /** Publish only: the governed major.minor.revision this publication carries (null keeps the current one). */
  nextVersion?: VersionLabel | null;
  /** The decision note: kept on the audit row, and on the version when publishing. */
  note?: string | null;
};

/** Pure: a shared framework with a CFCA layer, governed in Holdings. The same predicate as the 466 guard. */
export const isHoldingsGoverned = (fw: { hospital_id?: string | null; competency_layer?: string | null } | null | undefined): boolean =>
  !!fw && fw.hospital_id === null && typeof fw.competency_layer === "string" && fw.competency_layer.length > 0;

export const HOLDINGS_ONLY = "This is a centrally governed competency framework. It is put forward and published in Competen HQ, Competency Frameworks, Framework Publication, by an independent publisher.";

/** Pure: the governed version label consumers bind to (the same composition as competency/foundation.ts). */
export const versionLabel = (v: Partial<VersionLabel> | null | undefined) => `${v?.major ?? 1}.${v?.minor ?? 0}.${v?.revision ?? 0}`;

/** The 395 approval each competency was published under: its current content hash and the approved version of it. */
async function approvalRefs(admin: any, ids: string[]): Promise<Record<string, { content_hash: string; clinical_version_id: string | null }> | null> {
  const { data: hashes, error } = await admin.rpc("competency_content_hashes", { p_ids: ids });
  if (error) return null;
  const { data: versions, error: vErr } = await admin.from("clinical_content_version").select("id, competency_id, content_hash").in("competency_id", ids);
  if (vErr) return null;
  const out: Record<string, { content_hash: string; clinical_version_id: string | null }> = {};
  for (const h of hashes ?? []) {
    const v = (versions ?? []).find((x: any) => x.competency_id === h.competency_id && x.content_hash === h.content_hash);
    out[h.competency_id] = { content_hash: h.content_hash, clinical_version_id: v?.id ?? null };
  }
  return out;
}

const SNAPSHOT_COLS_BEFORE_750 = `
        name, library, description, code, competency_layer, profession_term_id, specialty_term_id, parent_framework_id,
        version_major, version_minor, version_revision, review_date,
        framework_domains(
          name, code, sort_order,
          framework_competencies(
            id, code, name, description, sort_order, learning_outcomes, expected_level_id, risk_category, practice_id, cpu_id,
            competency_skills(name, sort_order)
          )
        )
      `;
const SNAPSHOT_COLS = `
        name, library, description, code, competency_layer, profession_term_id, specialty_term_id, parent_framework_id,
        version_major, version_minor, version_revision, review_date, component_order,
        framework_domains(
          id, name, code, sort_order,
          framework_competencies(
            id, code, name, description, sort_order, learning_outcomes, learning_outcome_ids, expected_level_id, risk_category, practice_id, cpu_id,
            competency_skills(id, name, sort_order, component_code)
          )
        )
      `;

// FRAMEWORK-DESIGN-STUDIO-02 (760): a version also records its Areas and each domain's Area, so the organisation of a
// version can be rebuilt. Before 760 the select falls back to SNAPSHOT_COLS, exactly as before.
const SNAPSHOT_COLS_760 = SNAPSHOT_COLS
  .replace("framework_domains(\n          id, name, code, sort_order,", "framework_areas(id, name, description, sort_order),\n        framework_domains(\n          id, name, code, sort_order, area_id,");

export async function transitionFramework(
  admin: any,
  frameworkId: string,
  action: FrameworkAction,
  actor: { id: string; name: string | null },
  opts: TransitionOptions = {}
): Promise<{ ok: boolean; status?: string; warning?: string; error?: string; code?: number }> {
  const newStatus = FRAMEWORK_ACTION_STATUS[action];
  if (!newStatus) return { ok: false, error: "Invalid action", code: 400 };

  const { data: framework } = await admin
    .from("frameworks").select("id, name, pub_status, version_num, hospital_id, competency_layer").eq("id", frameworkId).maybeSingle();
  if (!framework) return { ok: false, error: "Framework not found", code: 404 };
  if (isHoldingsGoverned(framework) && !opts.holdings) return { ok: false, error: HOLDINGS_ONLY, code: 409 };

  const oldStatus = framework.pub_status ?? "published";
  const bump = action === "publish" && opts.nextVersion
    ? { version_major: opts.nextVersion.major, version_minor: opts.nextVersion.minor, version_revision: opts.nextVersion.revision } : {};
  // One statement: the 466 guard refuses the status and the version label together, so a refused publication
  // never advances the label.
  // HQ-SOD-CROSSCUT-01: a publication records its publisher on the row, in the same statement, so the database
  // (migration 640) can refuse a publisher who put the framework forward or contributed to it. Before 640 the
  // column is absent and the write goes without it, exactly as before.
  const write = (withPublisher: boolean) => admin.from("frameworks")
    .update({ pub_status: newStatus, ...bump, ...(withPublisher && action === "publish" ? { published_by: actor.id } : {}) }).eq("id", frameworkId);
  let { error: updateErr } = await write(true);
  if (updateErr && /published_by/.test(updateErr.message ?? "") && !/not independent/i.test(updateErr.message ?? "")) ({ error: updateErr } = await write(false));
  if (updateErr && /not independent/i.test(updateErr.message ?? "")) {
    return { ok: false, code: 403, error: /put the framework forward/i.test(updateErr.message) ? "You put this framework forward, so a different publisher must decide it."
      : /authored or curated/i.test(updateErr.message) ? "You authored or curated content in this framework, so a different publisher must decide it."
      : /clinical approvers/i.test(updateErr.message) ? "For frameworks, the publisher may not be one of the clinical approvers of its competencies."
      : "The publication must record an independent publisher." };
  }
  // Migration 466: a shared CFCA framework is published only when every competency it owns is clinically approved (395)
  // at its current content. The database refuses; this says why, in words.
  if (updateErr && /cfca publication/i.test(updateErr.message ?? "")) {
    const m = /(\d+) of (\d+)/.exec(updateErr.message);
    return { ok: false, code: 409, error: `This framework cannot be published yet: ${m ? `${m[1]} of its ${m[2]} competencies are` : "some of its competencies are"} not clinically approved at their current content. Each needs an independent clinical review of that exact content first.` };
  }
  // Migration 752: a pending layout that went stale (an id it names was deleted or moved) refuses the publication whole.
  if (updateErr && /framework layout at publication/i.test(updateErr.message ?? "")) {
    const m = /out of date, (.*?)\. Nothing/.exec(updateErr.message);
    return { ok: false, code: 409, error: `The pending layout is out of date${m ? ` (${m[1]})` : ""}, so nothing was published. Discard it or save the layout again, then put the framework forward again.` };
  }
  // Migration 770: an open revision draft that can no longer be applied refuses the publication whole.
  if (updateErr && /framework revision at publication|framework revision: it was applied/i.test(updateErr.message ?? "")) {
    const m = /can no longer be applied, (.*?)\. Nothing/.exec(updateErr.message);
    return { ok: false, code: 409, error: `The revision draft can no longer be applied${m ? ` (${m[1]})` : ""}, so nothing was published. Discard it and start again, then put the framework forward again.` };
  }
  if (updateErr) return { ok: false, error: updateErr.message, code: 500 };

  let warning: string | undefined;
  if (action === "publish") {
    // The version records what was published and on what authority: identity, the governed version label, every field
    // the 395 hash covers, and (for a CFCA framework) the content hash and approved 395 version of each competency.
    // FRAMEWORK-DESIGN-STUDIO-01 (750/751): the snapshot also carries the domain and criterion ids, each criterion's
    // section, the framework's section order and the stable outcome ids, so a version's exact order can be rebuilt.
    // Additive: before 750/751 those columns are absent and the snapshot is exactly what it was. Old snapshots are
    // never touched.
    const snap = (cols: string) => admin.from("frameworks").select(cols).eq("id", frameworkId).single();
    let { data: fullFw, error: snapErr } = await snap(SNAPSHOT_COLS_760);
    if (snapErr) ({ data: fullFw, error: snapErr } = await snap(SNAPSHOT_COLS));
    if (snapErr) ({ data: fullFw, error: snapErr } = await snap(SNAPSHOT_COLS_BEFORE_750));

    if (fullFw) {
      // A controlled catalogue (migration 394) publishes what it NAMES, with each content status, so the
      // version records what the approver saw. Where 394 is absent, or the framework names nothing, the
      // snapshot is exactly what it was before.
      // CFCA-STUDIO-P1 (660): the programme overlay and component requirements are part of what was published.
      // Before 660 those columns are absent, and the entries are recorded as they were.
      const OVERLAY = "competency_id, content_status, status_note, sort_order, requirement, expected_level_id, competency_catalogue_entry_component(component_code, pass_level_id, is_mandatory, is_safety_critical, weight)";
      let { data: entries, error: entErr } = await admin.from("competency_catalogue_entry")
        .select(OVERLAY).eq("catalogue_id", frameworkId).order("sort_order");
      if (entErr) ({ data: entries, error: entErr } = await admin.from("competency_catalogue_entry")
        .select("competency_id, content_status, status_note, sort_order").eq("catalogue_id", frameworkId).order("sort_order"));
      const ids: string[] = (fullFw.framework_domains ?? []).flatMap((d: any) => (d.framework_competencies ?? []).map((c: any) => c.id));
      const refs = fullFw.competency_layer && ids.length ? await approvalRefs(admin, ids) : null;
      const snapshot = {
        ...fullFw,
        version_label: versionLabel({ major: fullFw.version_major, minor: fullFw.version_minor, revision: fullFw.version_revision }),
        published_by: actor.id,
        ...(!entErr && entries?.length ? { catalogue_entries: entries } : {}),
        ...(refs ? { clinical_approvals: refs } : {}),
      };
      const nextVersion = (framework.version_num ?? 0) + 1;
      const { error: insErr } = await admin.from("framework_versions").insert({
        framework_id: frameworkId, version_num: nextVersion, snapshot, published_by_name: actor.name, notes: opts.note ?? null,
      });
      if (insErr) warning = "Published, but the version snapshot failed — republish to retry it.";
      else await admin.from("frameworks").update({ version_num: nextVersion }).eq("id", frameworkId);
    } else {
      warning = `Published, but the version snapshot failed${snapErr ? ` (${snapErr.message})` : ""} — republish to retry it.`;
    }
  }

  if (action === "submit_review") {
    await admin.from("content_approvals").update({ status: "superseded" }).eq("framework_id", frameworkId).eq("status", "pending");
    await admin.from("content_approvals").insert({
      framework_id: frameworkId, framework_name: framework.name,
      submitted_by: actor.id, submitted_by_name: actor.name, status: "pending",
    });
  }

  await admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: actor.id, actor_name: actor.name, action,
    entity_type: "framework", entity_id: frameworkId, entity_name: framework.name,
    old_value: { pub_status: oldStatus },
    new_value: { pub_status: newStatus, ...(action === "publish" && opts.nextVersion ? { version: versionLabel(opts.nextVersion) } : {}), ...(opts.note ? { note: opts.note } : {}) },
  });

  return { ok: true, status: newStatus, warning };
}
